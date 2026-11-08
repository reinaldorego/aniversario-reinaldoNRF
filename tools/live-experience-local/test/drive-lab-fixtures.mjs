import { createHash } from 'node:crypto';
import { DRIVE_SCOPE } from '../src/drive-auth.mjs';
import { DriveError, requireDrive } from '../src/drive-token-store.mjs';
import { LAB_APPROVAL_KIND, LAB_STATE_KIND, validateLabState } from '../src/drive-lab-state.mjs';
import { LAB_TAG, LAB_FOLDER_NAME, LAB_FOLDER_MIME, labProperties, performLabOperation } from '../src/drive-lab.mjs';
import { FAKE_CREDENTIALS, OAUTH_NOW, oauthHarness, fakeEnvelope } from './drive-oauth-fixtures.mjs';
import { syntheticPng } from '../src/fixtures.mjs';

// All identities, state, checksums and transports below are invented. No environment credentials or network.
export const LAB_NOW = OAUTH_NOW;
export const SYNTHETIC_STATE_BINDING = 'e'.repeat(64);
export const syntheticApproval = (action = 'lab-create', extra = {}) => ({ kind: LAB_APPROVAL_KIND, action,
  approvalId: (action === 'lab-create' ? 'b' : 'c').repeat(64), operationId: 'a'.repeat(32), expiresAt: LAB_NOW + 600000,
  scope: DRIVE_SCOPE, clientBinding: createHash('sha256').update(FAKE_CREDENTIALS.client_id).digest('hex'),
  stateBinding: SYNTHETIC_STATE_BINDING, ownerPermissionId: 'synthetic-lab-owner', files: [], ...extra });

export class MemoryLabState {
  constructor() { this.state = { kind: LAB_STATE_KIND, usedApprovals: [], creation: null }; this.locked = false; this.writes = 0; this.claims = 0; }
  binding() { return SYNTHETIC_STATE_BINDING; }
  async withLock(action) {
    requireDrive(!this.locked, 'LAB_LOCKED_OR_UNAVAILABLE'); this.locked = true;
    const save = async state => {
      this.writes++; if (this.failSave?.(state, this.writes)) throw new DriveError('LAB_STATE_IO_FAILED');
      validateLabState(state); this.state = structuredClone(state);
    };
    try { return await action({ load: () => structuredClone(this.state), save,
      claimCreate: async state => { requireDrive(this.claims === 0, 'LAB_CREATE_ALREADY_RESERVED'); this.claims++; await save(state); } }); }
    finally { this.locked = false; }
  }
}

export function labHarness() {
  const approval = syntheticApproval(), owner = approval.ownerPermissionId, stateStore = new MemoryLabState();
  const acl = () => [{ id: owner, type: 'user', role: 'owner', deleted: false }];
  const privateFields = () => ({ trashed: false, ownedByMe: true, owners: [{ permissionId: owner, me: true }],
    shared: false, capabilities: { canShare: true }, permissionIds: [owner], permissions: acl(), version: '1' });
  const root = { id: 'synthetic-lab-root', name: 'SYNTHETIC ROOT', mimeType: LAB_FOLDER_MIME, ...privateFields() };
  const resources = new Map([[root.id, root]]);
  const h = { approval, root, resources, stateStore, calls: [], creates: 0, factoryCalls: 0, hidden: new Set() };
  h.folder = () => resources.get('synthetic-lab-folder');
  h.addFixture = (number = 1) => {
    const bytes = syntheticPng(number, 24, 24), id = 'synthetic-lab-fixture-' + number;
    const entry = { id, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    resources.set(id, { id, name: 'SYNTHETIC-LAB-' + number + '.png', mimeType: 'image/png',
      parents: [h.folder().id], isAppAuthorized: true, appProperties: labProperties(approval.operationId, 'fixture'),
      size: String(entry.bytes), sha256Checksum: entry.sha256, ...privateFields() });
    return entry;
  };
  const invoke = async (group, method, params, options) => {
    h.calls.push({ group, method, params: structuredClone(params), options });
    if (h.override) { const result = await h.override(group, method, params, options); if (result !== undefined) return result; }
    if (group === 'files' && method === 'create') {
      h.creates++;
      const folder = { id: h.creates === 1 ? 'synthetic-lab-folder' : 'synthetic-lab-folder-' + h.creates,
        ...structuredClone(params.requestBody), parents: [root.id], isAppAuthorized: true, ...privateFields() };
      resources.set(folder.id, folder);
      return h.afterCreate ? h.afterCreate(folder, options) : { data: structuredClone(folder) };
    }
    if (group === 'files' && method === 'get') {
      requireDrive(!params.alt, 'SYNTHETIC_MEDIA_TRANSFER_FORBIDDEN');
      return { data: structuredClone(resources.get(params.fileId === 'root' ? root.id : params.fileId)) };
    }
    if (group === 'permissions' && method === 'list') return { data: { permissions: structuredClone(resources.get(params.fileId)?.permissions) } };
    if (group === 'files' && method === 'list') {
      const parent = params.q.match(/^'([A-Za-z0-9_-]+)' in parents/);
      const selected = [...resources.values()].filter(file => !h.hidden.has(file.id) && file.trashed === false && (parent ?
        file.parents?.includes(parent[1]) : file.appProperties?.levelXVIIILab === LAB_TAG &&
        (!params.q.includes('levelXVIIILabOperation') || file.appProperties.levelXVIIILabOperation === approval.operationId) &&
        (!params.q.includes('levelXVIIILabKind') || file.appProperties.levelXVIIILabKind === 'folder')));
      return { data: { files: structuredClone(parent ? selected.map(({ id }) => ({ id })) : selected), incompleteSearch: false } };
    }
    throw new DriveError('SYNTHETIC_TRANSPORT_METHOD_FORBIDDEN');
  };
  h.client = { files: {}, permissions: {} };
  for (const [group, methods] of [['files', ['create', 'get', 'list']], ['permissions', ['list']]]) {
    for (const method of methods) h.client[group][method] = (params, options) => invoke(group, method, params, options);
  }
  h.run = (action = 'lab-create', extra = {}) => performLabOperation({ action,
    approval: action === 'lab-create' ? h.approval : syntheticApproval('lab-inspect'), stateStore, now: () => LAB_NOW,
    clientFactory: async () => { h.factoryCalls++; return h.client; }, ...extra });
  h.cli = () => {
    const oauth = oauthHarness({ envelope: fakeEnvelope() }); oauth.sdk.drive = () => h.client;
    return { ...oauth, loadApproval: async () => h.approval, makeState: () => stateStore,
      loadCredentials: async () => FAKE_CREDENTIALS, loadSdk: async () => oauth.sdk, makeTokenStore: () => oauth.store };
  };
  return h;
}
