import { createHash } from 'node:crypto';
import { MAX_BYTES, sha256 } from './png.mjs';

const FOLDER = 'application/vnd.google-apps.folder';
const ID = /^[A-Za-z0-9_-]{1,256}$/;
const ROLES = new Set(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader']);
const WRITE = new Set(['owner', 'organizer', 'fileOrganizer', 'writer']);
export const FILE_FIELDS = 'id,name,mimeType,parents,trashed,version,size,md5Checksum,modifiedTime';
export const ACL_FIELDS = 'nextPageToken,permissions(id,type,role,deleted,permissionDetails(inherited,inheritedFrom,role,permissionType))';

export class DriveSourceError extends Error {
  constructor(code, status = 'indeterminate') { super(code); this.code = code; this.authorizationStatus = status; }
}
function ensure(condition, code = 'DRIVE_PARTIAL_RESPONSE') { if (!condition) throw new DriveSourceError(code); }
function parentsOf(raw) {
  ensure(Array.isArray(raw.parents) && raw.parents.length <= 1 && raw.parents.every(id => typeof id === 'string' && ID.test(id)));
  return [...raw.parents].sort();
}
const fingerprint = metadata => sha256(Buffer.from(JSON.stringify(metadata)));
const keyFor = id => sha256(Buffer.from('synthetic-drive-key:' + id)) + '.png';
const sorted = entries => [...entries].sort((a, b) => a.id.localeCompare(b.id));

export function normalizeDriveFile(raw, folderId) {
  ensure(raw && typeof raw.id === 'string' && ID.test(raw.id) && typeof raw.trashed === 'boolean');
  const parents = parentsOf(raw);
  if (raw.trashed || !parents.includes(folderId)) return null;
  ensure(raw.mimeType === 'image/png' && typeof raw.name === 'string' && raw.name.toLowerCase().endsWith('.png'), 'DRIVE_FILE_PROFILE');
  ensure(typeof raw.version === 'string' && /^[1-9][0-9]*$/.test(raw.version));
  ensure(typeof raw.size === 'string' && /^[1-9][0-9]*$/.test(raw.size));
  const size = Number(raw.size);
  ensure(Number.isSafeInteger(size) && size <= MAX_BYTES, 'DRIVE_BYTE_LIMIT');
  ensure(typeof raw.md5Checksum === 'string' && /^[a-f0-9]{32}$/.test(raw.md5Checksum));
  ensure(typeof raw.modifiedTime === 'string' && /^\d{4}-\d\d-\d\dT/.test(raw.modifiedTime) && Number.isFinite(Date.parse(raw.modifiedTime)));
  // All extra fields, including names, owners, email and lastModifyingUser, are dropped.
  return { id: raw.id, parents, version: raw.version, size, md5Checksum: raw.md5Checksum, modifiedTime: raw.modifiedTime, mimeType: raw.mimeType };
}

export class DriveSource {
  constructor({ client, folderId, publisherPermissionIds, driveId = null, timeoutMs = 1000, maxPages = 20 }) {
    ensure(client?.mode === 'synthetic-drive-v3', 'ONLY_SYNTHETIC_CLIENT_SUPPORTED');
    ensure(typeof folderId === 'string' && ID.test(folderId) &&
      (driveId === null || typeof driveId === 'string' && ID.test(driveId)), 'INVALID_FOLDER_CONFIGURATION');
    ensure(Array.isArray(publisherPermissionIds) && publisherPermissionIds.length === 2 &&
      new Set(publisherPermissionIds).size === 2 && publisherPermissionIds.every(id => typeof id === 'string' && ID.test(id)), 'TWO_PUBLISHERS_REQUIRED');
    ensure(Number.isInteger(timeoutMs) && timeoutMs > 0 && Number.isInteger(maxPages) && maxPages > 0 && maxPages <= 100);
    Object.assign(this, { client, folderId, driveId, timeoutMs, maxPages });
    this.publishers = new Set(publisherPermissionIds);
    this.identity = 'synthetic-drive-v3:' + fingerprint({ folderId, driveId, publishers: [...this.publishers].sort() });
    this.known = new Map(); this.readAllowed = false;
    this.authorization = { status: 'indeterminate', code: 'NOT_VERIFIED' };
  }
  async init(checkpoint) {
    if (!checkpoint) return;
    ensure(checkpoint.identity === this.identity && checkpoint.strategy === 'double-files-list-v1' &&
      Number.isSafeInteger(checkpoint.sequence) && checkpoint.sequence > 0 &&
      Array.isArray(checkpoint.inventory) && checkpoint.inventory.length <= 200, 'CHECKPOINT_CONTEXT');
    ensure(checkpoint.digest === fingerprint(sorted(checkpoint.inventory)), 'CHECKPOINT_DIGEST');
    for (const entry of checkpoint.inventory) {
      const normalized = normalizeDriveFile({ ...entry, size: String(entry.size), name: 'SYNTHETIC.png', trashed: false }, this.folderId);
      ensure(normalized, 'CHECKPOINT_MEMBERSHIP');
      this.known.set(keyFor(entry.id), normalized);
    }
  }
  blocked(error) {
    this.readAllowed = false;
    const clean = error instanceof DriveSourceError ? error : new DriveSourceError('DRIVE_UNAVAILABLE');
    this.authorization = { status: clean.authorizationStatus, code: clean.code };
    return clean;
  }
  async call(resource, method, params, options = {}) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => this.client[resource][method](params, { ...options, signal: controller.signal })),
        new Promise((_, reject) => { timer = setTimeout(() => { reject(new DriveSourceError('DRIVE_TIMEOUT')); controller.abort(); }, this.timeoutMs); })
      ]);
    } catch (error) {
      if (error instanceof DriveSourceError) throw error;
      const status = Number(error?.response?.status ?? error?.status ?? error?.code);
      // Never propagate provider messages, request configuration or token-bearing headers.
      throw new DriveSourceError([400, 403, 404, 429].includes(status) || status >= 500 && status <= 599 ? 'DRIVE_HTTP_' + status : 'DRIVE_UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
  async pages(resource, params, property) {
    const output = [], tokens = new Set();
    let pageToken;
    for (let page = 0; page < this.maxPages; page++) {
      const response = await this.call(resource, 'list', { ...params, ...(pageToken ? { pageToken } : {}) });
      const data = response?.data;
      ensure(data && Array.isArray(data[property]));
      if (resource === 'files') ensure(data.incompleteSearch === false, 'DRIVE_INCOMPLETE_SEARCH');
      ensure(output.length + data[property].length <= (property === 'files' ? 200 : 500), 'DRIVE_RESULT_LIMIT');
      output.push(...data[property]);
      if (!Object.hasOwn(data, 'nextPageToken')) return output;
      ensure(typeof data.nextPageToken === 'string' && data.nextPageToken.length > 0 && data.nextPageToken.length <= 4096, 'DRIVE_PAGE_TOKEN_INVALID');
      ensure(!tokens.has(data.nextPageToken), 'DRIVE_PAGE_TOKEN_REPEATED');
      tokens.add(data.nextPageToken); pageToken = data.nextPageToken;
    }
    throw new DriveSourceError('DRIVE_PAGE_LIMIT');
  }
  async metadata(id) {
    const response = await this.call('files', 'get', { fileId: id, fields: FILE_FIELDS, supportsAllDrives: true });
    ensure(response?.data?.id === id);
    return response.data;
  }
  async folderChain() {
    const chain = [], seen = new Set();
    let id = this.folderId;
    while (id) {
      ensure(!seen.has(id) && chain.length < 16, 'DRIVE_ANCESTRY_AMBIGUOUS');
      seen.add(id);
      const raw = await this.metadata(id);
      ensure(raw.mimeType === FOLDER && raw.trashed === false, 'DRIVE_FOLDER_UNAVAILABLE');
      const parents = parentsOf(raw);
      chain.push({ id, parents }); id = parents[0];
    }
    return chain;
  }
  async acl(id, ancestors) {
    ensure(this.client.aclVisibility === 'complete', 'MOCK_ACL_VISIBILITY_UNPROVEN');
    const permissions = await this.pages('permissions', { fileId: id, fields: ACL_FIELDS, pageSize: 100, supportsAllDrives: true }, 'permissions');
    ensure(permissions.length > 0, 'DRIVE_EMPTY_ACL');
    const normalized = [], seen = new Set();
    for (const permission of permissions) {
      ensure(permission && ['user', 'group', 'domain', 'anyone'].includes(permission.type) && ROLES.has(permission.role), 'DRIVE_ACL_AMBIGUOUS');
      if (permission.type !== 'user') throw new DriveSourceError('DRIVE_NON_USER_PERMISSION', 'denied');
      ensure(typeof permission.id === 'string' && !seen.has(permission.id) && permission.deleted !== true, 'DRIVE_ACL_AMBIGUOUS');
      seen.add(permission.id);
      if (!this.publishers.has(permission.id)) throw new DriveSourceError('DRIVE_UNAUTHORIZED_PRINCIPAL', 'denied');
      const details = [];
      if (Object.hasOwn(permission, 'permissionDetails')) {
        ensure(Array.isArray(permission.permissionDetails) && permission.permissionDetails.length > 0, 'DRIVE_INHERITANCE_AMBIGUOUS');
        for (const detail of permission.permissionDetails) {
          ensure(typeof detail.inherited === 'boolean' && ROLES.has(detail.role) && ['file', 'member'].includes(detail.permissionType), 'DRIVE_INHERITANCE_AMBIGUOUS');
          if (detail.inheritedFrom !== undefined) ensure(detail.inherited && ancestors.includes(detail.inheritedFrom), 'DRIVE_INHERITANCE_AMBIGUOUS');
          details.push({ inherited: detail.inherited, inheritedFrom: detail.inheritedFrom ?? null, role: detail.role, permissionType: detail.permissionType });
        }
      }
      normalized.push({ id: permission.id, type: permission.type, role: permission.role, details: details.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
    }
    return normalized.sort((a, b) => a.id.localeCompare(b.id));
  }
  async checkFolder() {
    const chain = await this.folderChain(), evidence = [];
    for (let index = 0; index < chain.length; index++) {
      const item = chain[index], acl = await this.acl(item.id, chain.slice(index + 1).map(parent => parent.id));
      if (index === 0) ensure([...this.publishers].every(id => acl.some(p => p.id === id && WRITE.has(p.role))), 'DRIVE_WRITERS_UNPROVEN');
      evidence.push({ ...item, acl });
    }
    return { chain, certificate: fingerprint(evidence) };
  }
  async authorize() {
    try {
      const proof = await this.checkFolder();
      this.authorization = { status: 'allowed', code: 'MOCK_FOLDER_ACL_VERIFIED' };
      return { ...this.authorization, certificate: proof.certificate };
    } catch (error) { this.blocked(error); return { ...this.authorization }; }
  }
  async discover() {
    const raw = await this.pages('files', {
      q: "'" + this.folderId + "' in parents and trashed = false", spaces: 'drive',
      fields: 'nextPageToken,incompleteSearch,files(' + FILE_FIELDS + ')', pageSize: 1000,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
      corpora: this.driveId ? 'drive' : 'user', ...(this.driveId ? { driveId: this.driveId } : {})
    }, 'files');
    const ids = new Set(), entries = [];
    for (const file of raw) {
      ensure(!ids.has(file.id), 'DRIVE_DUPLICATE_FILE_ID'); ids.add(file.id);
      const item = normalizeDriveFile(file, this.folderId);
      if (item) entries.push(item);
    }
    return sorted(entries);
  }
  async fileProof(id) {
    const folder = await this.checkFolder();
    const raw = await this.metadata(id);
    const file = normalizeDriveFile(raw, this.folderId);
    if (!file) {
      const error = new DriveSourceError('CONFIRMED_OUTSIDE_EDITORIAL');
      error.code = 'ENOENT'; throw error; // Only explicit membership/trashed proof maps to absence.
    }
    const acl = await this.acl(id, folder.chain.map(item => item.id));
    return { file, certificate: fingerprint({ folder: folder.certificate, acl }) };
  }
  async read(name) {
    try {
      const known = this.known.get(name);
      ensure(known, 'DRIVE_KEY_UNKNOWN');
      const before = await this.fileProof(known.id);
      const response = await this.call('files', 'get', { fileId: known.id, alt: 'media' }, { responseType: 'arraybuffer' });
      ensure(Buffer.isBuffer(response?.data) || response?.data instanceof Uint8Array, 'DRIVE_CONTENT_PARTIAL');
      ensure(response.data.byteLength <= MAX_BYTES && response.data.byteLength === before.file.size, 'DRIVE_CONTENT_SIZE');
      const data = Buffer.from(response.data);
      ensure(data.length <= MAX_BYTES && data.length === before.file.size, 'DRIVE_CONTENT_SIZE');
      ensure(createHash('md5').update(data).digest('hex') === before.file.md5Checksum, 'DRIVE_CONTENT_CHECKSUM');
      const after = await this.fileProof(known.id);
      ensure(fingerprint(before.file) === fingerprint(after.file), 'DRIVE_SOURCE_CHANGED');
      ensure(before.certificate === after.certificate, 'DRIVE_ACL_CHANGED');
      return { name, hash: sha256(data), fingerprint: fingerprint(after.file), size: data.length, data };
    } catch (error) {
      if (error.code === 'ENOENT') throw error;
      throw this.blocked(error);
    }
  }
  async revalidate(name, expectedFingerprint) {
    try {
      const known = this.known.get(name); ensure(known, 'DRIVE_KEY_UNKNOWN');
      const proof = await this.fileProof(known.id);
      ensure(fingerprint(proof.file) === expectedFingerprint, 'DRIVE_SOURCE_CHANGED');
    } catch (error) { throw this.blocked(error); }
  }
  async list(mode = 'complete', checkpoint = null) {
    try {
      ensure(mode === 'complete', 'SIMULATED_LIST_INCOMPLETE');
      const folderBefore = await this.checkFolder();
      const first = await this.discover();
      for (const file of first) this.known.set(keyFor(file.id), file);
      const entries = [];
      for (const file of first) {
        const observed = await this.read(keyFor(file.id));
        ensure(observed.fingerprint === fingerprint(file), 'DRIVE_INVENTORY_CHANGED');
        entries.push(observed);
      }
      const second = await this.discover();
      ensure(fingerprint(first) === fingerprint(second), 'DRIVE_INVENTORY_CHANGED');
      const folderAfter = await this.checkFolder();
      ensure(folderBefore.certificate === folderAfter.certificate, 'DRIVE_ACL_CHANGED');
      this.authorization = { status: 'allowed', code: 'MOCK_INVENTORY_VERIFIED' };
      this.readAllowed = true;
      return { complete: true, entries, checkpoint: {
        identity: this.identity, strategy: 'double-files-list-v1',
        sequence: (checkpoint?.sequence ?? 0) + 1, digest: fingerprint(first), inventory: first
      } };
    } catch (error) {
      // Membership changed while listing is an inconsistent scan, not a completed removal.
      throw this.blocked(error.code === 'ENOENT' ? new DriveSourceError('DRIVE_INVENTORY_CHANGED') : error);
    }
  }
}
