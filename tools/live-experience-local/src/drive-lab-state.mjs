import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DriveError, requireDrive, validateExternalPath, assertPrivatePermissions, readPrivateJson } from './drive-token-store.mjs';

export const LAB_APPROVAL_KIND = 'LEVEL_XVIII_DRIVE_LAB_APPROVAL_V1';
export const LAB_STATE_KIND = 'LEVEL_XVIII_DRIVE_LAB_STATE_V1';
export const LAB_STATE_FILE = 'drive-lab-state.json';
export const LAB_CLAIM_FILE = 'drive-lab-create-consumed.json';
export const LAB_LOCK_FILE = 'drive-lab.lock';
export const LAB_ID = /^[A-Za-z0-9_-]{1,256}$/;
const HEX = /^[a-f0-9]{64}$/;
const OPERATION = /^[a-f0-9]{32}$/;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const labDirectoryBinding = directory => createHash('sha256').update(process.platform === 'win32' ?
  path.resolve(directory).toLowerCase() : path.resolve(directory)).digest('hex');
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

export function validateLabApproval(value, action, scope, now = Date.now()) {
  requireDrive(exactKeys(value, ['kind', 'action', 'approvalId', 'operationId', 'expiresAt', 'scope', 'clientBinding', 'stateBinding', 'ownerPermissionId', 'files']) &&
    value.kind === LAB_APPROVAL_KIND && ['lab-create', 'lab-inspect'].includes(action) && value.action === action &&
    typeof value.approvalId === 'string' && HEX.test(value.approvalId) && typeof value.operationId === 'string' && OPERATION.test(value.operationId) &&
    typeof value.clientBinding === 'string' && HEX.test(value.clientBinding) && typeof value.stateBinding === 'string' && HEX.test(value.stateBinding) && value.scope === scope &&
    typeof value.ownerPermissionId === 'string' && LAB_ID.test(value.ownerPermissionId) &&
    Number.isSafeInteger(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + 60 * 60 * 1000 &&
    Array.isArray(value.files) && value.files.length <= 2 && (action !== 'lab-create' || value.files.length === 0), 'LAB_APPROVAL_REJECTED');
  const ids = new Set();
  for (const file of value.files) {
    requireDrive(exactKeys(file, ['id', 'bytes', 'sha256']) && typeof file.id === 'string' && LAB_ID.test(file.id) && !ids.has(file.id) &&
      Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 64 * 1024 &&
      typeof file.sha256 === 'string' && HEX.test(file.sha256), 'LAB_APPROVAL_REJECTED');
    ids.add(file.id);
  }
  // Canonical field order binds the payload; approvalId is separately consumed even if the payload changes.
  return { kind: value.kind, action, approvalId: value.approvalId, operationId: value.operationId, expiresAt: value.expiresAt,
    scope, clientBinding: value.clientBinding, stateBinding: value.stateBinding, ownerPermissionId: value.ownerPermissionId,
    files: value.files.map(({ id, bytes, sha256 }) => ({ id, bytes, sha256 })) };
}

export function validateLabState(state) {
  requireDrive(exactKeys(state, ['kind', 'usedApprovals', 'creation']) && state.kind === LAB_STATE_KIND &&
    Array.isArray(state.usedApprovals) && state.usedApprovals.length <= 64 &&
    state.usedApprovals.every(id => typeof id === 'string' && HEX.test(id)) && new Set(state.usedApprovals).size === state.usedApprovals.length,
  'LAB_STATE_INVALID');
  if (state.creation !== null) {
    const c = state.creation;
    requireDrive(exactKeys(c, ['operationId', 'clientBinding', 'ownerPermissionId', 'phase', 'createAttempted', 'rootId', 'folderId']) &&
      typeof c.operationId === 'string' && OPERATION.test(c.operationId) && typeof c.clientBinding === 'string' && HEX.test(c.clientBinding) &&
      typeof c.ownerPermissionId === 'string' && LAB_ID.test(c.ownerPermissionId) &&
      ['RESERVED', 'UNCERTAIN', 'CREATED', 'BLOCKED'].includes(c.phase) && typeof c.createAttempted === 'boolean' &&
      [c.rootId, c.folderId].every(id => id === null || typeof id === 'string' && LAB_ID.test(id)) &&
      (c.folderId === null || c.folderId !== c.rootId) &&
      (c.phase !== 'CREATED' || c.createAttempted && c.rootId !== null && c.folderId !== null), 'LAB_STATE_INVALID');
  }
  return state;
}

export function consumeLabApproval(state, approval) {
  validateLabState(state);
  requireDrive(!state.usedApprovals.includes(approval.approvalId) && state.usedApprovals.length < 64, 'LAB_APPROVAL_CONSUMED');
  state.usedApprovals.push(approval.approvalId);
}

// One dedicated external directory, one lifetime create claim. No automatic lock recovery or reset.
export class DriveLabState {
  constructor(directory) { this.directory = directory; }
  binding() {
    requireDrive(typeof this.directory === 'string' && path.isAbsolute(this.directory), 'EXTERNAL_ABSOLUTE_PATH_REQUIRED');
    return labDirectoryBinding(this.directory);
  }
  async ready() {
    const entry = await validateExternalPath(this.directory, { directory: true });
    await assertPrivatePermissions(entry.filename);
    const names = await fs.readdir(entry.filename);
    requireDrive(names.every(name => [LAB_STATE_FILE, LAB_CLAIM_FILE, LAB_LOCK_FILE].includes(name)), 'LAB_DIRECTORY_NOT_DEDICATED');
    return entry.filename;
  }
  async withLock(action) {
    const directory = await this.ready(), filename = path.join(directory, LAB_LOCK_FILE);
    let lock, identity;
    try {
      try { lock = await fs.open(filename, 'wx', 0o600); }
      catch { throw new DriveError('LAB_LOCKED_OR_UNAVAILABLE'); }
      identity = await lock.stat();
      await validateExternalPath(filename); await assertPrivatePermissions(filename);
      await lock.writeFile('LEVEL_XVIII_LAB_LOCK_V1\n'); await lock.sync();
      const stateFile = path.join(directory, LAB_STATE_FILE), claimFile = path.join(directory, LAB_CLAIM_FILE);
      const claimEntry = await validateExternalPath(claimFile, { allowMissing: true });
      const stateEntry = await validateExternalPath(stateFile, { allowMissing: true });
      let state = stateEntry.exists ? await this.read(stateFile) : { kind: LAB_STATE_KIND, usedApprovals: [], creation: null };
      requireDrive(!claimEntry.exists || state.creation !== null, 'LAB_RECONCILIATION_REQUIRED');
      if (claimEntry.exists) {
        const claim = await readPrivateJson(claimFile);
        requireDrive(exactKeys(claim, ['kind', 'operationId', 'clientBinding', 'ownerPermissionId']) &&
          claim.kind === 'LEVEL_XVIII_LAB_CREATE_CONSUMED_V1' &&
          ['operationId', 'clientBinding', 'ownerPermissionId'].every(key => claim[key] === state.creation[key]), 'LAB_STATE_INVALID');
      }
      requireDrive(state.creation === null || claimEntry.exists, 'LAB_RECONCILIATION_REQUIRED');
      const transaction = {
        load: () => structuredClone(state),
        save: async value => { validateLabState(value); await this.write(stateFile, value); state = structuredClone(value); },
        claimCreate: async value => {
          requireDrive(state.creation === null && !claimEntry.exists, 'LAB_CREATE_ALREADY_RESERVED');
          validateLabState(value);
          requireDrive(value.creation !== null, 'LAB_STATE_INVALID');
          // The independent non-overwritable claim survives a missing/corrupt journal. Either partial write blocks.
          await this.write(claimFile, { kind: 'LEVEL_XVIII_LAB_CREATE_CONSUMED_V1', operationId: value.creation.operationId,
            clientBinding: value.creation.clientBinding, ownerPermissionId: value.creation.ownerPermissionId }, true);
          await this.write(stateFile, value); state = structuredClone(value);
        }
      };
      return await action(transaction);
    } catch (error) { throw error instanceof DriveError ? error : new DriveError('LAB_STATE_IO_FAILED'); }
    finally {
      if (lock) {
        await lock.close();
        const current = await validateExternalPath(filename);
        requireDrive(current.stat.ino === identity.ino && current.stat.dev === identity.dev, 'LAB_LOCK_CHANGED');
        await fs.unlink(filename);
      }
    }
  }
  async read(filename) {
    const envelope = await readPrivateJson(filename);
    requireDrive(exactKeys(envelope, ['payload', 'sha256']) && envelope.sha256 === digest(envelope.payload), 'LAB_STATE_INVALID');
    return validateLabState(envelope.payload);
  }
  async write(filename, value, exclusive = false) {
    await this.ready();
    const bytes = Buffer.from(JSON.stringify(exclusive ? value : { payload: value, sha256: digest(value) }) + '\n');
    requireDrive(bytes.length <= 64 * 1024, 'LAB_STATE_INVALID');
    const temporary = exclusive ? filename : filename + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await validateExternalPath(temporary); await assertPrivatePermissions(temporary);
      await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
      if (!exclusive) {
        const previous = await validateExternalPath(filename, { allowMissing: true });
        if (previous.exists) await this.read(filename);
        await fs.rename(temporary, filename);
      }
    } finally {
      bytes.fill(0);
      if (handle) await handle.close();
      // Never discard a partial exclusive claim or failed temporary. The next ready() fails closed for review.
    }
  }
}
