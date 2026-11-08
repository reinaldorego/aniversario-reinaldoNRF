import { createHash } from 'node:crypto';
import { DriveError, requireDrive, safeDriveError, readPrivateJson } from './drive-token-store.mjs';

export const SYNTHETIC_TAG = '04B3B-synthetic-v1';
export const MANIFEST_KIND = 'LEVEL_XVIII_SYNTHETIC_DRIVE_TEST_V1';
const ID = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_SYNTHETIC_BYTES = 1024 * 1024;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,mimeType,parents,trashed,size,version,appProperties,isAppAuthorized';

export function validateSyntheticManifest(manifest) {
  requireDrive(manifest?.kind === MANIFEST_KIND && typeof manifest.folderId === 'string' && ID.test(manifest.folderId) &&
    Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 3, 'SYNTHETIC_MANIFEST_INVALID');
  const ids = new Set([manifest.folderId]);
  for (const entry of manifest.files) {
    requireDrive(typeof entry?.id === 'string' && ID.test(entry.id) && !ids.has(entry.id) &&
      typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256) &&
      Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= MAX_SYNTHETIC_BYTES, 'SYNTHETIC_MANIFEST_INVALID');
    ids.add(entry.id);
  }
  return { kind: MANIFEST_KIND, folderId: manifest.folderId,
    files: manifest.files.map(({ id, bytes, sha256 }) => ({ id, bytes, sha256 })) };
}
export async function loadSyntheticManifest(filename) { return validateSyntheticManifest(await readPrivateJson(filename)); }

async function deadline(action, timeoutMs) {
  requireDrive(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'DRIVE_TIMEOUT_CONFIGURATION');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => action(controller.signal)),
      new Promise((_, reject) => { timer = setTimeout(() => {
        reject(new DriveError('DRIVE_TIMEOUT')); controller.abort();
      }, timeoutMs); })
    ]);
  } catch (error) { throw safeDriveError(error); }
  finally { clearTimeout(timer); }
}

export async function testConnectivity(client, { timeoutMs = 15000 } = {}) {
  return deadline(async signal => {
    const response = await client.files.list({ spaces: 'drive', pageSize: 1,
      q: "trashed = false and appProperties has { key='levelXVIIITest' and value='" + SYNTHETIC_TAG + "' }",
      fields: 'files(id),nextPageToken,incompleteSearch'
    }, { signal, timeout: timeoutMs, retry: false });
    requireDrive(response?.data && Array.isArray(response.data.files) && response.data.incompleteSearch === false &&
      response.data.files.length <= 1 && response.data.files.every(file => typeof file?.id === 'string' && ID.test(file.id)),
    'DRIVE_PARTIAL_RESPONSE');
    return { status: response.data.files.length ? 'AUTHORIZED_SYNTHETIC_RESOURCE_FOUND' : 'NO_AUTHORIZED_SYNTHETIC_FILES',
      connectivity: 'API_RESPONDED', editorialAccess: 'NOT_PROVEN', publicationChanged: false };
  }, timeoutMs);
}

export async function readSyntheticFiles(client, rawManifest, { timeoutMs = 15000 } = {}) {
  const manifest = validateSyntheticManifest(rawManifest);
  const metadata = id => deadline(async signal => {
    const response = await client.files.get({ fileId: id, fields: FIELDS }, { signal, timeout: timeoutMs, retry: false });
    const file = response?.data;
    requireDrive(file?.id === id && file.trashed === false && file.isAppAuthorized === true &&
      file.appProperties?.levelXVIIITest === SYNTHETIC_TAG, 'SYNTHETIC_RESOURCE_NOT_AUTHORIZED');
    return file;
  }, timeoutMs);
  const folder = await metadata(manifest.folderId);
  requireDrive(folder.mimeType === FOLDER_MIME, 'SYNTHETIC_FOLDER_REQUIRED');
  for (const entry of manifest.files) {
    const before = await metadata(entry.id);
    requireDrive(before.mimeType === 'image/png' && Array.isArray(before.parents) && before.parents.length === 1 &&
      before.parents[0] === manifest.folderId && before.size === String(entry.bytes) &&
      typeof before.version === 'string' && /^[1-9][0-9]*$/.test(before.version), 'SYNTHETIC_FILE_METADATA_REJECTED');
    await deadline(async signal => {
      let stream;
      const bytes = Buffer.alloc(entry.bytes);
      const abortStream = () => { if (stream?.destroy) stream.destroy(); };
      signal.addEventListener('abort', abortStream, { once: true });
      try {
        const response = await client.files.get({ fileId: entry.id, alt: 'media' },
          { signal, timeout: timeoutMs, retry: false, responseType: 'stream' });
        stream = response?.data;
        requireDrive(stream && typeof stream[Symbol.asyncIterator] === 'function' && typeof stream.destroy === 'function', 'DRIVE_STREAM_REQUIRED');
        requireDrive(!signal.aborted, 'DRIVE_TIMEOUT');
        let total = 0;
        const digest = createHash('sha256');
        for await (const chunk of stream) {
          requireDrive(Buffer.isBuffer(chunk) || chunk instanceof Uint8Array, 'SYNTHETIC_CONTENT_REJECTED');
          requireDrive(total + chunk.byteLength <= entry.bytes, 'SYNTHETIC_DOWNLOAD_LIMIT');
          bytes.set(chunk, total); total += chunk.byteLength; digest.update(chunk);
        }
        requireDrive(total === entry.bytes && digest.digest('hex') === entry.sha256 &&
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
          bytes.includes(Buffer.from('Description\0LEVEL XVIII SYNTHETIC TEST ONLY')), 'SYNTHETIC_CONTENT_REJECTED');
      } finally { signal.removeEventListener('abort', abortStream); if (stream?.destroy) stream.destroy(); bytes.fill(0); }
    }, timeoutMs);
    const after = await metadata(entry.id);
    requireDrive(JSON.stringify(before) === JSON.stringify(after), 'SYNTHETIC_FILE_CHANGED');
  }
  return { status: 'SYNTHETIC_READ_VERIFIED', verifiedFiles: manifest.files.length,
    persistedContent: false, editorialAccess: 'NOT_PROVEN', publicationChanged: false };
}
