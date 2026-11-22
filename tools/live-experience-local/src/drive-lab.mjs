import { DRIVE_SCOPE } from './drive-auth.mjs';
import { DriveError, requireDrive, safeDriveError } from './drive-token-store.mjs';
import { LAB_ID, validateLabApproval, consumeLabApproval } from './drive-lab-state.mjs';

export const LAB_TAG = '04B3B11-synthetic-lab-v1';
export const LAB_FOLDER_NAME = 'LEVEL_XVIII_SYNTHETIC_LAB_04B3B11';
export const LAB_FOLDER_MIME = 'application/vnd.google-apps.folder';
const PERMISSION_FIELDS = 'id,type,role,deleted,pendingOwner,view,permissionDetails(inherited,inheritedFrom,permissionType,role)';
export const LAB_METADATA_FIELDS = 'id,name,mimeType,parents,trashed,driveId,shortcutDetails,version,size,sha256Checksum,appProperties,isAppAuthorized,' +
  'ownedByMe,owners(permissionId,me),shared,capabilities(canShare),permissionIds,permissions(' + PERMISSION_FIELDS + ')';
export const labProperties = (operationId, kind = 'folder') => ({ levelXVIIILab: LAB_TAG, levelXVIIILabOperation: operationId, levelXVIIILabKind: kind });
const canonical = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});

function transport(client, timeoutMs) {
  requireDrive(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000, 'LAB_TIMEOUT_CONFIGURATION');
  return async (group, method, params) => {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => client[group][method](params, { signal: controller.signal, timeout: timeoutMs, retry: false })),
        new Promise((_, reject) => { timer = setTimeout(() => { reject(new DriveError('LAB_TIMEOUT')); controller.abort(); }, timeoutMs); })
      ]);
    } catch (error) { throw safeDriveError(error); }
    finally { clearTimeout(timer); }
  };
}

function ownerOnly(permission, ownerId, ancestors) {
  requireDrive(permission?.id === ownerId && permission.type === 'user' && permission.role === 'owner' && permission.deleted === false &&
    (permission.pendingOwner === undefined || permission.pendingOwner === false) && permission.view === undefined,
  'LAB_UNSAFE_PERMISSIONS');
  if (permission.permissionDetails !== undefined) {
    requireDrive(Array.isArray(permission.permissionDetails) && permission.permissionDetails.length > 0, 'LAB_PERMISSIONS_INCOMPLETE');
    for (const detail of permission.permissionDetails) {
      requireDrive(typeof detail.inherited === 'boolean' && detail.role === 'owner' && ['file', 'member'].includes(detail.permissionType) &&
        (detail.inheritedFrom === undefined || ancestors.includes(detail.inheritedFrom)), 'LAB_UNSAFE_PERMISSIONS');
    }
  }
  return permission;
}

function privateMetadata(file, approval, ancestors) {
  requireDrive(file && typeof file.id === 'string' && LAB_ID.test(file.id) && file.trashed === false && file.ownedByMe === true &&
    file.driveId === undefined && file.shortcutDetails === undefined && file.shared === false && file.capabilities?.canShare === true &&
    typeof file.version === 'string' && /^[1-9][0-9]*$/.test(file.version) &&
    Array.isArray(file.owners) && file.owners.length === 1 && file.owners[0].permissionId === approval.ownerPermissionId && file.owners[0].me === true,
  'LAB_METADATA_REJECTED');
  requireDrive(Array.isArray(file.permissionIds) && file.permissionIds.length === 1 && file.permissionIds[0] === approval.ownerPermissionId &&
    Array.isArray(file.permissions) && file.permissions.length === 1, 'LAB_PERMISSIONS_INCOMPLETE');
  ownerOnly(file.permissions[0], approval.ownerPermissionId, ancestors);
  return file;
}

function rootMetadata(file, approval) {
  privateMetadata(file, approval, []);
  requireDrive(file.mimeType === LAB_FOLDER_MIME && (file.parents === undefined || Array.isArray(file.parents) && file.parents.length === 0),
    'LAB_MY_DRIVE_ROOT_REQUIRED');
  return file;
}

function labMetadata(file, approval, parentId, kind) {
  privateMetadata(file, approval, [parentId]);
  const tag = labProperties(approval.operationId, kind);
  requireDrive(file.isAppAuthorized === true && Object.entries(tag).every(([key, value]) => file.appProperties?.[key] === value) &&
    Array.isArray(file.parents) && file.parents.length === 1 && file.parents[0] === parentId && file.id !== parentId,
  'LAB_PROVENANCE_REJECTED');
  if (kind === 'folder') requireDrive(file.mimeType === LAB_FOLDER_MIME && file.name === LAB_FOLDER_NAME, 'LAB_FOLDER_REJECTED');
  else requireDrive(file.mimeType === 'image/png', 'LAB_SYNTHETIC_FILE_REJECTED');
  return file;
}

async function allPages(call, group, method, params, key, limit) {
  const items = [], tokens = new Set(); let pageToken;
  for (let page = 0; page < 4; page++) {
    const response = await call(group, method, { ...params, ...(pageToken ? { pageToken } : {}) });
    const data = response?.data;
    requireDrive(data && Array.isArray(data[key]) && (group !== 'files' || data.incompleteSearch === false), 'LAB_VISIBILITY_INCOMPLETE');
    items.push(...data[key]);
    requireDrive(items.length <= limit, 'LAB_VISIBILITY_INCOMPLETE');
    if (data.nextPageToken === undefined) return items;
    requireDrive(typeof data.nextPageToken === 'string' && data.nextPageToken.length > 0 && data.nextPageToken.length <= 2048 &&
      !tokens.has(data.nextPageToken), 'LAB_PAGINATION_REJECTED');
    tokens.add(data.nextPageToken); pageToken = data.nextPageToken;
  }
  throw new DriveError('LAB_PAGINATION_REJECTED');
}

async function verifyPermissions(call, file, approval, ancestors) {
  const permissions = await allPages(call, 'permissions', 'list', { fileId: file.id, pageSize: 100,
    fields: 'permissions(' + PERMISSION_FIELDS + '),nextPageToken' }, 'permissions', 3);
  requireDrive(permissions.length === 1, 'LAB_PERMISSIONS_INCOMPLETE');
  ownerOnly(permissions[0], approval.ownerPermissionId, ancestors);
  requireDrive(canonical(permissions) === canonical(file.permissions), 'LAB_PERMISSIONS_INCOMPLETE');
}

const tagQuery = operation => "trashed = false and appProperties has { key='levelXVIIILab' and value='" + LAB_TAG + "' }" +
  (operation ? " and appProperties has { key='levelXVIIILabOperation' and value='" + operation + "' }" +
    " and appProperties has { key='levelXVIIILabKind' and value='folder' }" : '');
const listLab = (call, operation) => allPages(call, 'files', 'list', { spaces: 'drive', corpora: 'user', pageSize: 3,
  q: tagQuery(operation), fields: 'files(' + LAB_METADATA_FIELDS + '),nextPageToken,incompleteSearch' }, 'files', 3);

async function observe(call, approval, creation) {
  const root = rootMetadata((await call('files', 'get', { fileId: 'root', fields: LAB_METADATA_FIELDS })).data, approval);
  requireDrive(creation.rootId === null || creation.rootId === root.id, 'LAB_ROOT_CHANGED');
  await verifyPermissions(call, root, approval, []);
  const candidates = await listLab(call, approval.operationId);
  requireDrive(candidates.length === 1, 'LAB_RECONCILIATION_REQUIRED');
  labMetadata(candidates[0], approval, root.id, 'folder');
  requireDrive(creation.folderId === null || creation.folderId === candidates[0].id, 'LAB_PROVENANCE_REJECTED');
  const folder = labMetadata((await call('files', 'get', { fileId: candidates[0].id, fields: LAB_METADATA_FIELDS })).data, approval, root.id, 'folder');
  requireDrive(folder.id === candidates[0].id && !approval.files.some(file => [root.id, folder.id].includes(file.id)), 'LAB_PROVENANCE_REJECTED');
  await verifyPermissions(call, folder, approval, [root.id]);
  const visible = await allPages(call, 'files', 'list', { spaces: 'drive', corpora: 'user', pageSize: 3,
    q: "'" + folder.id + "' in parents and trashed = false", fields: 'files(id),nextPageToken,incompleteSearch' }, 'files', 2);
  const ids = visible.map(file => file?.id);
  requireDrive(ids.length === approval.files.length && new Set(ids).size === ids.length &&
    ids.every(id => typeof id === 'string' && LAB_ID.test(id) && approval.files.some(file => file.id === id)), 'LAB_VISIBILITY_INCOMPLETE');
  const files = [];
  for (const expected of approval.files) {
    const file = labMetadata((await call('files', 'get', { fileId: expected.id, fields: LAB_METADATA_FIELDS })).data, approval, folder.id, 'fixture');
    requireDrive(file.id === expected.id && file.size === String(expected.bytes) && file.sha256Checksum === expected.sha256,
      'LAB_SYNTHETIC_FILE_REJECTED');
    await verifyPermissions(call, file, approval, [folder.id, root.id]); files.push(file);
  }
  // Only the selected metadata and ACLs are evidence. A drive.file list is never a complete descendant inventory.
  return { root, folder, files, visibleIds: ids.sort() };
}

async function inspect(call, approval, creation) {
  const before = await observe(call, approval, creation), after = await observe(call, approval, creation);
  requireDrive(canonical(before) === canonical(after), 'LAB_RESOURCE_CHANGED');
  return after;
}

export async function performLabOperation({ action, approval: rawApproval, stateStore, clientFactory, now = Date.now, timeoutMs = 15000 }) {
  const approval = validateLabApproval(rawApproval, action, DRIVE_SCOPE, now());
  requireDrive(stateStore.binding() === approval.stateBinding, 'LAB_STATE_BINDING_REJECTED');
  return stateStore.withLock(async transaction => {
    let state = transaction.load();
    if (action === 'lab-create') requireDrive(state.creation === null, 'LAB_CREATE_ALREADY_RESERVED');
    else requireDrive(state.creation?.createAttempted === true &&
      ['operationId', 'clientBinding', 'ownerPermissionId'].every(key => state.creation[key] === approval[key]), 'LAB_RECONCILIATION_REQUIRED');
    consumeLabApproval(state, approval);
    if (action === 'lab-create') {
      state.creation = { operationId: approval.operationId, clientBinding: approval.clientBinding, ownerPermissionId: approval.ownerPermissionId,
        phase: 'RESERVED', createAttempted: false, rootId: null, folderId: null };
      await transaction.claimCreate(state);
    } else await transaction.save(state);
    try {
      const call = transport(await clientFactory(approval), timeoutMs);
      if (action === 'lab-create') {
        const root = rootMetadata((await call('files', 'get', { fileId: 'root', fields: LAB_METADATA_FIELDS })).data, approval);
        await verifyPermissions(call, root, approval, []);
        requireDrive((await listLab(call)).length === 0, 'LAB_EXISTING_RESOURCE');
        const checkedRoot = rootMetadata((await call('files', 'get', { fileId: 'root', fields: LAB_METADATA_FIELDS })).data, approval);
        requireDrive(canonical(root) === canonical(checkedRoot), 'LAB_ROOT_CHANGED');
        await verifyPermissions(call, checkedRoot, approval, []);
        validateLabApproval(approval, action, DRIVE_SCOPE, now());
        state.creation.rootId = root.id; state.creation.phase = 'UNCERTAIN'; state.creation.createAttempted = true;
        await transaction.save(state); // Durable intent BEFORE the only create call, including a lost response or crash.
        validateLabApproval(approval, action, DRIVE_SCOPE, now());
        const response = await call('files', 'create', { requestBody: { name: LAB_FOLDER_NAME, mimeType: LAB_FOLDER_MIME,
          parents: ['root'], appProperties: labProperties(approval.operationId) }, fields: LAB_METADATA_FIELDS });
        const folder = labMetadata(response?.data, approval, root.id, 'folder');
        state.creation.folderId = folder.id; await transaction.save(state);
      }
      const observed = await inspect(call, approval, state.creation);
      validateLabApproval(approval, action, DRIVE_SCOPE, now());
      state.creation.rootId = observed.root.id; state.creation.folderId = observed.folder.id; state.creation.phase = 'CREATED';
      await transaction.save(state);
      return { status: action === 'lab-create' ? 'LAB_FOLDER_CREATED_AND_INSPECTED' : 'LAB_METADATA_INSPECTED', scope: DRIVE_SCOPE,
        verifiedSyntheticFiles: approval.files.length, descendantVisibility: 'NOT_PROVEN', editorialAccess: 'NOT_PROVEN',
        permissionChanges: false, mediaTransferred: false, publicationChanged: false };
    } catch (error) {
      // A failed final save also leaves durable RESERVED/UNCERTAIN intent. Never clear it or retry creation.
      state = transaction.load();
      state.creation.phase = state.creation.createAttempted ? 'UNCERTAIN' : 'BLOCKED';
      await transaction.save(state);
      throw safeDriveError(error);
    }
  });
}
