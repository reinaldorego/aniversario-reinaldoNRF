import { createHash } from 'node:crypto';
import { syntheticPng } from '../src/fixtures.mjs';

export const EDITORIAL = 'mock-editorial-folder';
export const ROOT = 'mock-private-root';
export const PUBLISHERS = ['mock-organizer-permission', 'mock-photographer-permission'];
export const userPermission = (id, role = 'writer', extra = {}) => ({ id, type: 'user', role, ...extra });
export function fixtureFile(id = 'mock-image-a', seed = 1) {
  const bytes = syntheticPng(seed, 320, 200);
  return {
    bytes, metadata: {
      id, name: 'SYNTHETIC-PRIVATE-NAME.png', mimeType: 'image/png', parents: [EDITORIAL], trashed: false,
      version: '1', size: String(bytes.length), md5Checksum: createHash('md5').update(bytes).digest('hex'),
      modifiedTime: '2026-11-07T12:00:00Z', description: 'SYNTHETIC-PRIVATE-DESCRIPTION',
      owners: [{ emailAddress: 'synthetic-only@example.invalid' }],
      lastModifyingUser: { displayName: 'NOT_A_PROOF_OF_EDITORIAL_AUTHOR' }
    }
  };
}
const clone = value => structuredClone(value);
function httpError(status) {
  return Object.assign(new Error('SYNTHETIC-PRIVATE-PROVIDER-MESSAGE'), { response: { status, headers: { authorization: 'SYNTHETIC-NOT-A-CREDENTIAL' } } });
}

// No SDK, transport, URLs, login or network. Mutable in-memory model only.
export class MockDriveClient {
  constructor() {
    this.mode = 'synthetic-drive-v3'; this.aclVisibility = 'complete'; this.calls = [];
    this.records = new Map([
      [ROOT, { metadata: { id: ROOT, name: 'PRIVATE ROOT', mimeType: 'application/vnd.google-apps.folder', parents: [], trashed: false } }],
      [EDITORIAL, { metadata: { id: EDITORIAL, name: 'EDITORIAL', mimeType: 'application/vnd.google-apps.folder', parents: [ROOT], trashed: false } }]
    ]);
    this.acls = new Map([
      [ROOT, [userPermission(PUBLISHERS[0], 'owner')]],
      [EDITORIAL, [userPermission(PUBLISHERS[0], 'owner'), userPermission(PUBLISHERS[1])]]
    ]);
    this.responses = new Map(); this.pageSize = 1; this.aclPageSize = 100; this.injectedRows = [];
    this.files = { list: (p, o) => this.dispatch('files.list', p, o), get: (p, o) => this.dispatch(p.alt === 'media' ? 'files.media' : 'files.get', p, o) };
    this.permissions = { list: (p, o) => this.dispatch('permissions.list', p, o) };
  }
  add(id = 'mock-image-a', seed = 1) {
    this.records.set(id, fixtureFile(id, seed));
    this.acls.set(id, [
      userPermission(PUBLISHERS[0], 'owner', { permissionDetails: [{ inherited: false, role: 'owner', permissionType: 'file' }] }),
      userPermission(PUBLISHERS[1], 'writer', { permissionDetails: [{ inherited: true, inheritedFrom: EDITORIAL, role: 'writer', permissionType: 'file' }] })
    ]);
    return this.records.get(id);
  }
  replace(id, seed, version) {
    const old = this.records.get(id), next = fixtureFile(id, seed);
    next.metadata.version = String(version); next.metadata.modifiedTime = old.metadata.modifiedTime;
    this.records.set(id, next);
  }
  enqueue(operation, ...responses) {
    const queue = this.responses.get(operation) ?? [];
    queue.push(...responses); this.responses.set(operation, queue);
  }
  async dispatch(operation, params, options) {
    this.calls.push({ operation, params: clone(params) });
    if (this.hook) await this.hook(operation, params, this);
    const queue = this.responses.get(operation);
    if (queue?.length) {
      const answer = queue.shift();
      if (typeof answer === 'number') throw httpError(answer);
      if (answer === 'timeout') return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      return { data: clone(answer) };
    }
    if (operation === 'files.get' || operation === 'files.media') {
      const record = this.records.get(params.fileId);
      if (!record) throw httpError(404);
      return { data: operation === 'files.media' ? Buffer.from(record.bytes) : clone(record.metadata) };
    }
    const pageToken = params.pageToken ?? '0';
    if (!/^\d+$/.test(pageToken)) throw httpError(400);
    const offset = Number(pageToken);
    if (operation === 'files.list') {
      if (params.q !== "'" + EDITORIAL + "' in parents and trashed = false") throw new Error('MOCK_EXPECTS_EXACT_PARENT_QUERY');
      const rows = [...this.records.values()].map(r => r.metadata)
        .filter(m => m.parents.includes(EDITORIAL) && !m.trashed).concat(this.injectedRows).sort((a, b) => a.id.localeCompare(b.id));
      const data = { files: clone(rows.slice(offset, offset + this.pageSize)), incompleteSearch: false };
      if (offset + this.pageSize < rows.length) data.nextPageToken = String(offset + this.pageSize);
      return { data };
    }
    const permissions = this.acls.get(params.fileId);
    if (!permissions) throw httpError(403);
    const data = { permissions: clone(permissions.slice(offset, offset + this.aclPageSize)) };
    if (offset + this.aclPageSize < permissions.length) data.nextPageToken = String(offset + this.aclPageSize);
    return { data };
  }
}
