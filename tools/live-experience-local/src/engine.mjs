import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StateStore, atomicWrite } from './storage.mjs';
import { LocalSource } from './local-source.mjs';
import { decodePng, processSyntheticPng, sha256 } from './png.mjs';

export class Simulator {
  static async open({ root, stableMs = 1000, freshMs = 15000, clock = Date.now, processor = processSyntheticPng } = {}) {
    if (!Number.isFinite(stableMs) || stableMs < 1 || !Number.isFinite(freshMs) || freshMs < stableMs) throw new Error('INVALID_TIMING');
    const store = new StateStore(root);
    const state = await store.open(kind => ({
      schemaVersion: 1, kind, paused: true, permissions: 'indeterminate', listingMode: 'complete',
      securityEpoch: 1, controlVersion: 1, revision: 0, everPublished: false,
      sources: [], jobs: [], hashClaims: [], changes: [], audit: [], processed: 0, lastCompleteScanAt: null
    }));
    const engine = new Simulator(store, state, { stableMs, freshMs, clock, processor });
    try {
      await engine.source.init();
      state.lastCompleteScanAt = null; // Restart always requires a fresh complete reconciliation.
      for (const job of state.jobs) if (job.status === 'RUNNING') {
        job.status = 'QUEUED';
        const entry = state.sources.find(item => item.id === job.sourceId);
        if (entry?.state === 'PROCESSING') entry.state = 'RECEIVED';
      }
      await store.save(state);
      return engine;
    } catch (error) { await store.close(); throw error; }
  }
  constructor(store, state, options) {
    Object.assign(this, options);
    this.store = store; this.state = state; this.source = new LocalSource(store.root);
    this.tail = Promise.resolve(); this.draining = false; this.fatal = false;
  }
  mutate(action) {
    const result = this.tail.then(async () => {
      if (this.fatal) throw new Error('STORAGE_FAILED_CLOSED');
      const value = await action();
      try { await this.store.save(this.state); }
      catch (error) { this.fatal = true; throw error; }
      return value;
    });
    this.tail = result.catch(() => {});
    return result;
  }
  audit(action, detail = {}) {
    this.state.audit.push({ at: this.clock(), actor: 'local-simulator', action, ...detail });
  }
  transition(entry, state, reason = null) {
    const from = entry.state;
    entry.state = state; entry.error = reason;
    this.audit('STATE', { sourceId: entry.id, generation: entry.generation, from, to: state, reason });
  }
  change(entry, action) {
    this.state.revision++;
    this.state.changes.push({ revision: this.state.revision, id: entry.id, generation: entry.generation, action, at: this.clock() });
  }
  invalidate(entry) {
    for (const job of this.state.jobs) if (job.sourceId === entry.id && ['RUNNING', 'QUEUED'].includes(job.status)) job.status = 'STALE';
  }
  withdraw(entry, reason) {
    if (entry.state === 'PUBLISHED') this.change(entry, 'withdraw');
    this.invalidate(entry);
    entry.present = false; entry.generation++;
    for (const claim of this.state.hashClaims) if (claim.sourceId === entry.id) claim.retired = true;
    this.transition(entry, 'WITHDRAWN', reason);
  }
  async setPermissions(status) {
    if (!['allowed', 'denied', 'indeterminate'].includes(status)) throw new Error('INVALID_PERMISSION_SCENARIO');
    return this.mutate(() => {
      if (this.state.permissions !== status) {
        this.state.permissions = status; this.state.securityEpoch++;
        this.state.lastCompleteScanAt = null;
        if (status !== 'allowed') { this.state.paused = true; this.state.controlVersion++; }
        for (const job of this.state.jobs) if (['RUNNING', 'QUEUED'].includes(job.status)) job.status = 'STALE';
        for (const entry of this.state.sources) if (entry.state === 'PROCESSING') this.transition(entry, 'RECEIVED', 'PERMISSION_EPOCH_CHANGED');
        this.audit('SIMULATED_PERMISSIONS', { status });
      }
    });
  }
  async pause(paused) {
    return this.mutate(() => {
      if (!paused && this.state.permissions !== 'allowed') throw new Error('PERMISSION_NOT_ALLOWED');
      this.state.paused = paused; this.state.controlVersion++;
      this.audit(paused ? 'PAUSE' : 'RESUME_AND_REENDORSE_SYNTHETIC_SET');
    });
  }
  async setListingMode(mode) {
    if (!['complete', 'incomplete', 'error'].includes(mode)) throw new Error('INVALID_LISTING_SCENARIO');
    return this.mutate(() => { this.state.listingMode = mode; this.state.lastCompleteScanAt = null; });
  }
  async retryFailed() {
    return this.mutate(() => {
      for (const entry of this.state.sources) if (entry.present && entry.state === 'FAILED' && entry.attempts < 3) {
        this.transition(entry, 'RECEIVED', 'MANUAL_RETRY');
      }
    });
  }
  async scan() {
    return this.mutate(async () => {
      let snapshot;
      try { snapshot = await this.source.list(this.state.listingMode); }
      catch {
        this.state.lastScanError = 'LIST_READ_FAILED';
        this.audit('SCAN_FAILED');
        return { complete: false };
      }
      if (!snapshot.complete) {
        this.state.lastScanError = 'LIST_INCOMPLETE';
        this.audit('SCAN_INCOMPLETE');
        return { complete: false };
      }
      const seen = new Set(snapshot.entries.map(item => item.name));
      for (const entry of this.state.sources) if (entry.present && !seen.has(entry.name)) {
        // A full scan plus individual absence prevents partial inventory mass removal.
        try { await this.source.read(entry.name); this.state.lastScanError = 'LIST_CHANGED'; return { complete: false }; }
        catch (error) {
          if (error.code !== 'ENOENT') { this.state.lastScanError = 'ABSENCE_UNCERTAIN'; return { complete: false }; }
        }
      }
      for (const entry of this.state.sources) if (entry.present && !seen.has(entry.name)) this.withdraw(entry, 'LEFT_EDITORIAL_FOLDER');
      for (const observed of snapshot.entries) {
        let entry = this.state.sources.find(item => item.name === observed.name);
        if (!entry) {
          entry = { id: randomUUID(), name: observed.name, generation: 1, present: true, state: null, attempts: 0 };
          this.state.sources.push(entry);
          this.transition(entry, 'RECEIVED');
        } else if (!entry.present || entry.fingerprint !== observed.fingerprint) {
          if (entry.present && entry.state === 'PUBLISHED' && entry.hash === observed.hash) {
            entry.fingerprint = observed.fingerprint; continue; // Metadata-only touch is not a new photo.
          }
          if (entry.state === 'PUBLISHED') this.change(entry, 'withdraw');
          this.invalidate(entry);
          entry.generation++; entry.present = true; entry.attempts = 0;
          entry.derivatives = null;
          this.transition(entry, 'RECEIVED', 'NEW_SOURCE_GENERATION');
          entry.observations = 0;
        }
        if (entry.fingerprint !== observed.fingerprint || !entry.observations) {
          entry.stableSince = this.clock(); entry.observations = 1;
        } else entry.observations++;
        entry.fingerprint = observed.fingerprint; entry.hash = observed.hash; entry.invalid = observed.invalid;
        if (entry.state === 'PUBLISHED' || entry.state === 'FAILED' || entry.state === 'PROCESSING') continue;
        if (entry.observations < 2 || this.clock() - entry.stableSince < this.stableMs) continue;
        if (path.extname(entry.name).toLowerCase() !== '.png') {
          this.transition(entry, 'FAILED', 'FORMAT_NOT_ALLOWED');
          continue;
        }
        const claim = this.state.hashClaims.find(item => item.hash === entry.hash);
        if (claim && (claim.sourceId !== entry.id || claim.retired)) {
          entry.duplicateOf = claim.sourceId; entry.error = 'DUPLICATE_SUPPRESSED';
          continue;
        }
        if (this.state.paused || this.state.permissions !== 'allowed') continue;
        if (!this.state.jobs.some(job => job.sourceId === entry.id && job.generation === entry.generation && ['QUEUED', 'RUNNING'].includes(job.status))) {
          this.state.jobs.push({
            id: randomUUID(), sourceId: entry.id, generation: entry.generation, hash: entry.hash,
            fingerprint: entry.fingerprint, securityEpoch: this.state.securityEpoch,
            controlVersion: this.state.controlVersion, status: 'QUEUED'
          });
        }
      }
      // A retired hash cannot be promoted through a duplicate or stale replay.
      for (const claim of this.state.hashClaims) {
        const canonical = this.state.sources.find(item => item.id === claim.sourceId);
        if (!canonical?.present || canonical.hash !== claim.hash || canonical.state === 'WITHDRAWN') claim.retired = true;
      }
      this.state.lastCompleteScanAt = this.clock();
      this.state.lastScanError = null;
      this.audit('SCAN_COMPLETE', { count: snapshot.entries.length });
      return { complete: true };
    });
  }
  isFresh() {
    return !this.fatal && this.state.permissions === 'allowed' && this.state.lastCompleteScanAt !== null &&
      this.clock() - this.state.lastCompleteScanAt <= this.freshMs;
  }
  async claim() {
    return this.mutate(() => {
      if (this.state.paused || !this.isFresh() || this.state.listingMode !== 'complete' || this.state.lastScanError) return null;
      const job = this.state.jobs.find(item => item.status === 'QUEUED');
      if (!job) return null;
      const entry = this.state.sources.find(item => item.id === job.sourceId);
      if (!entry?.present || entry.generation !== job.generation || job.securityEpoch !== this.state.securityEpoch || job.controlVersion !== this.state.controlVersion) {
        job.status = 'STALE'; return null;
      }
      const existing = this.state.hashClaims.find(item => item.hash === job.hash);
      if (existing && (existing.sourceId !== entry.id || existing.retired)) {
        job.status = 'STALE'; entry.duplicateOf = existing.sourceId; return null;
      }
      if (!existing && job.hash) this.state.hashClaims.push({ hash: job.hash, sourceId: entry.id, retired: false });
      job.status = 'RUNNING'; entry.attempts++;
      const cached = entry.state === 'READY' ? entry.derivatives : null;
      this.transition(entry, 'PROCESSING');
      return { ...job, name: entry.name, cached };
    });
  }
  async writeDerivatives(job, variants) {
    const records = {};
    for (const variant of ['thumbnail', 'display']) {
      const item = variants[variant];
      if (!item?.data || sha256(item.data) !== item.sha256) throw new Error('DERIVATIVE_INTEGRITY');
      const image = decodePng(item.data);
      if (image.chunks.join(',') !== 'IHDR,IDAT,IEND') throw new Error('DERIVATIVE_METADATA');
      const filename = job.sourceId + '.' + job.generation + '.' + variant + '.' + item.sha256 + '.png';
      const target = path.join(this.store.root, 'derivatives', filename);
      let existing;
      try { existing = await fs.readFile(target); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!existing || sha256(existing) !== item.sha256) await atomicWrite(target, item.data);
      records[variant] = { filename, sha256: item.sha256, width: image.width, height: image.height };
    }
    return records;
  }
  async completeJob(job, derivatives) {
    return this.mutate(async () => {
      const stored = this.state.jobs.find(item => item.id === job.id);
      const entry = this.state.sources.find(item => item.id === job.sourceId);
      if (stored?.status !== 'RUNNING' || !entry?.present || entry.generation !== job.generation || entry.hash !== job.hash) {
        if (stored && stored.status === 'RUNNING') stored.status = 'STALE';
        return 'STALE';
      }
      let current;
      try { current = await this.source.read(entry.name); }
      catch (error) {
        if (error.code === 'ENOENT') this.withdraw(entry, 'ABSENT_BEFORE_COMMIT');
        stored.status = 'STALE'; return 'STALE';
      }
      if (current.fingerprint !== job.fingerprint) { stored.status = 'STALE'; return 'STALE'; }
      // Always verify on-disk artifacts, including READY reused after pause/restart.
      for (const variant of ['thumbnail', 'display']) {
        const record = derivatives?.[variant];
        if (!record || record.filename !== path.basename(record.filename)) throw new Error('DERIVATIVE_MISSING');
        const bytes = await fs.readFile(path.join(this.store.root, 'derivatives', record.filename));
        if (sha256(bytes) !== record.sha256 || decodePng(bytes).chunks.join(',') !== 'IHDR,IDAT,IEND') throw new Error('DERIVATIVE_INTEGRITY');
      }
      entry.derivatives = derivatives;
      this.transition(entry, 'READY');
      stored.status = 'DONE';
      if (this.state.paused || !this.isFresh() || this.state.listingMode !== 'complete' || this.state.lastScanError ||
          job.securityEpoch !== this.state.securityEpoch || job.controlVersion !== this.state.controlVersion) return 'HELD';
      this.transition(entry, 'PUBLISHED');
      entry.publishedAt ??= new Date(this.clock()).toISOString();
      this.state.everPublished = true;
      this.change(entry, 'upsert');
      this.audit('AUTO_PUBLICATION', { sourceId: entry.id, editorialBasis: 'simulated-controlled-folder-presence', humanActor: null });
      return 'PUBLISHED';
    });
  }
  async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (true) {
        const job = await this.claim();
        if (!job) break;
        try {
          let derivatives = job.cached;
          if (!derivatives) {
            const original = await this.source.read(job.name);
            if (original.fingerprint !== job.fingerprint) throw new Error('SOURCE_CHANGED');
            if (original.invalid) throw new Error(original.invalid);
            if (path.extname(job.name).toLowerCase() !== '.png') throw new Error('FORMAT_NOT_ALLOWED');
            const variants = await this.processor(original.data);
            derivatives = await this.writeDerivatives(job, variants);
            await this.mutate(() => { this.state.processed++; });
          }
          await this.completeJob(job, derivatives);
        } catch {
          await this.mutate(() => {
            const stored = this.state.jobs.find(item => item.id === job.id);
            const entry = this.state.sources.find(item => item.id === job.sourceId);
            if (stored?.status === 'RUNNING' && entry?.present && entry.generation === job.generation) {
              stored.status = 'FAILED'; this.transition(entry, 'FAILED', 'VALIDATION_OR_PROCESSING_FAILED');
            }
          });
        }
      }
    } finally { this.draining = false; }
  }
  async cycle() { await this.scan(); await this.drain(); }
  snapshot() {
    return {
      isDemo: true, mode: 'SYNTHETIC_LOCAL_ONLY',
      phase: this.state.everPublished ? 'open' : 'coming-soon',
      version: this.state.revision,
      photos: this.isFresh() ? this.state.sources.filter(entry => entry.present && entry.state === 'PUBLISHED').map(entry => ({
        id: entry.id, status: 'published', isDemo: true, alt: 'TESTE SINTÉTICO — padrão geométrico, não é foto da festa',
        publishedAt: entry.publishedAt,
        thumbnailUrl: '/v1/media/' + entry.id + '/thumbnail', imageUrl: '/v1/media/' + entry.id + '/display',
        width: entry.derivatives.display.width, height: entry.derivatives.display.height
      })).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id)) : []
    };
  }
  async media(id, variant) {
    if (!['thumbnail', 'display'].includes(variant) || !this.isFresh()) return null;
    const entry = this.state.sources.find(item => item.id === id && item.present && item.state === 'PUBLISHED');
    if (!entry) return null;
    const record = entry.derivatives[variant];
    try {
      const bytes = await fs.readFile(path.join(this.store.root, 'derivatives', record.filename));
      return sha256(bytes) === record.sha256 ? bytes : null;
    } catch { return null; }
  }
  status() {
    return { mode: 'SYNTHETIC_LOCAL_ONLY', permissions: this.state.permissions, paused: this.state.paused,
      fresh: this.isFresh(), revision: this.state.revision, processed: this.state.processed,
      states: Object.fromEntries(['RECEIVED', 'PROCESSING', 'READY', 'PUBLISHED', 'WITHDRAWN', 'FAILED'].map(state => [state, this.state.sources.filter(entry => entry.state === state).length])),
      lastScanError: this.state.lastScanError ?? null };
  }
  async close() {
    if (this.draining) throw new Error('PROCESSING_IN_PROGRESS');
    await this.tail; await this.store.close();
  }
}
