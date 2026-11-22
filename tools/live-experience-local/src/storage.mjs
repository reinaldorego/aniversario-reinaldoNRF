import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256 } from './png.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_ROOT = path.join(os.tmpdir(), 'level-xviii-local-' + sha256(Buffer.from(REPO_ROOT)).slice(0, 12));
const MARK = 'LEVEL-XVIII-SYNTHETIC-LOCAL-V1';

export async function atomicWrite(filename, bytes) {
  const temporary = filename + '.' + randomUUID() + '.tmp';
  const file = await fs.open(temporary, 'wx', 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  await fs.rename(temporary, filename);
}

export class StateStore {
  constructor(root = DEFAULT_ROOT) {
    this.root = path.resolve(root);
    const relative = path.relative(REPO_ROOT, this.root);
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('DATA_MUST_BE_OUTSIDE_REPOSITORY');
  }
  async open(initial) {
    await fs.mkdir(this.root, { recursive: true });
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw new Error('SYMLINK_ROOT');
    const marker = path.join(this.root, '.synthetic-local');
    const entries = await fs.readdir(this.root);
    if (!entries.includes('.synthetic-local')) {
      if (entries.length) throw new Error('DATA_DIRECTORY_NOT_OWNED');
      await fs.writeFile(marker, MARK, { flag: 'wx', mode: 0o600 });
    }
    if (await fs.readFile(marker, 'utf8') !== MARK) throw new Error('DATA_DIRECTORY_NOT_OWNED');
    this.lockPath = path.join(this.root, 'service.lock');
    try { this.lock = await fs.open(this.lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Serialize stale-lock recovery so two newcomers cannot unlink each other's lock.
      const recoveryPath = path.join(this.root, 'recovery.lock');
      const recovery = await fs.open(recoveryPath, 'wx', 0o600);
      try {
        const old = JSON.parse(await fs.readFile(this.lockPath, 'utf8'));
        if (!Number.isInteger(old.pid) || old.pid < 1) throw new Error('INVALID_LOCK_REQUIRES_REVIEW');
        try { process.kill(old.pid, 0); throw new Error('SERVICE_ALREADY_RUNNING'); }
        catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
        await fs.unlink(this.lockPath);
        this.lock = await fs.open(this.lockPath, 'wx', 0o600);
      } finally { await recovery.close(); await fs.unlink(recoveryPath); }
    }
    await this.lock.writeFile(JSON.stringify({ pid: process.pid }));
    this.filename = path.join(this.root, 'state.json');
    try {
      const envelope = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (sha256(Buffer.from(envelope.payload)) !== envelope.sha256) throw new Error('STATE_CHECKSUM');
      const state = JSON.parse(envelope.payload);
      if (state.schemaVersion !== 1 || state.kind !== MARK) throw new Error('STATE_SCHEMA');
      return state;
    } catch (error) {
      if (error.code !== 'ENOENT') { await this.close(); throw error; }
      // Leftover files with no state indicate damage, not a new empty gallery.
      if (entries.some(name => name !== '.synthetic-local' && name !== 'service.lock')) {
        await this.close(); throw new Error('STATE_MISSING');
      }
      const state = initial(MARK);
      await this.save(state);
      return state;
    }
  }
  async save(state) {
    const payload = JSON.stringify(state);
    await atomicWrite(this.filename, JSON.stringify({ sha256: sha256(Buffer.from(payload)), payload }) + '\n');
  }
  async close() {
    if (!this.lock) return;
    await this.lock.close(); this.lock = null;
    await fs.unlink(this.lockPath);
  }
}
