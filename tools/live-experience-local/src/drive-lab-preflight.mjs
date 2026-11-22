import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRIVE_SCOPE, loadDesktopCredentials, loadGoogleSdk, validateTokenEnvelope } from './drive-auth.mjs';
import { DriveError, DriveTokenStore, requireDrive, assertQuietRuntime, safeDriveError } from './drive-token-store.mjs';
import { LAB_TAG, LAB_METADATA_FIELDS, LAB_FOLDER_MIME } from './drive-lab.mjs';

export const ACCESS_MARGIN_MS = 6 * 60 * 1000;
const PERMISSIONS = 'id,type,role,deleted,pendingOwner,view,permissionDetails(inherited,inheritedFrom,permissionType,role)';
const SAFE = new Set(['ACCESS_TOKEN_NOT_USABLE', 'OAUTH_TESTING_REFRESH_EXPIRED', 'OAUTH_CLIENT_MISMATCH',
  'OAUTH_SCOPE_REJECTED', 'REFRESH_FORBIDDEN', 'TRANSPORT_FORBIDDEN', 'INCOMPLETE_RESPONSE', 'TIMEOUT',
  'DRIVE_HTTP_401', 'DRIVE_HTTP_403', 'DRIVE_HTTP_404', 'DRIVE_HTTP_429', 'GOOGLE_SERVICE_UNAVAILABLE']);
const report = (mode, stage, code, contacted = false) => ({ mode, stage, code, scope: DRIVE_SCOPE,
  googleContacted: contacted, localWrites: false, creationAllowed: false });
const usable = (envelope, now) => {
  requireDrive(envelope.tokens.expiry_date > now + ACCESS_MARGIN_MS, 'ACCESS_TOKEN_NOT_USABLE');
  requireDrive(envelope.refreshTokenExpiresAt > now + 60000, 'OAUTH_TESTING_REFRESH_EXPIRED');
};

export function parsePreflightArguments(args) {
  requireDrive(Array.isArray(args) && args.length <= 1 && args.every(arg => ['--dry-run', '--execute'].includes(arg)), 'ARGUMENTS_REJECTED');
  return { execute: args[0] === '--execute' };
}

// No authorizedSession(), persist(), store.save(), refresh token or client secret reaches this client.
export function accessOnlyClient(sdk, envelope, now = Date.now) {
  usable(envelope, now());
  const auth = sdk.oauth();
  requireDrive(typeof auth.setCredentials === 'function' && typeof auth.getRequestHeaders === 'function' &&
    typeof auth.transporter?.interceptors?.request?.add === 'function', 'TRANSPORT_FORBIDDEN');
  auth.setCredentials({ access_token: envelope.tokens.access_token, expiry_date: envelope.tokens.expiry_date, token_type: 'Bearer' });
  auth.forceRefreshOnFailure = false;
  auth.eagerRefreshThresholdMillis = 300000;
  auth.refreshToken = async () => { throw new DriveError('REFRESH_FORBIDDEN'); };
  auth.refreshAccessToken = auth.refreshToken;
  auth.transporter.interceptors.request.add({ resolved: async options => {
    usable(envelope, now());
    const url = new URL(String(options.url));
    requireDrive(url.origin === 'https://www.googleapis.com' && !url.username && !url.password && !url.hash &&
      /^\/drive\/v3\/files(?:\/[A-Za-z0-9_-]+(?:\/permissions)?)?$/.test(url.pathname) &&
      String(options.method ?? 'GET').toUpperCase() === 'GET' && !url.searchParams.has('alt'), 'TRANSPORT_FORBIDDEN');
    // Gaxios passes this Fetch option to node-fetch; redirects must fail before another request.
    return { ...options, retry: false, timeout: 15000, redirect: 'error' };
  } });
  return { auth, client: sdk.drive(auth), assertUsable: () => usable(envelope, now()) };
}

async function requestOnce(invoke, timeoutMs) {
  const controller = new AbortController(); let timer;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => invoke({ signal: controller.signal, timeout: timeoutMs, retry: false })),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new DriveError('TIMEOUT')); }, timeoutMs); })
    ]);
    requireDrive(response?.status === 200 && response.data && typeof response.data === 'object', 'INCOMPLETE_RESPONSE');
    return response.data;
  } finally { clearTimeout(timer); }
}

export async function runPreflightCommand({ execute = false, env = process.env } = {}, injected = {}) {
  let stage = 'CONFIG', contacted = false;
  try {
    requireDrive(typeof execute === 'boolean', 'ARGUMENTS_REJECTED');
    if (!execute) return report('DRY_RUN', 'NONE', 'NO_EFFECTS');
    assertQuietRuntime(env);
    requireDrive(env.LEVEL_DRIVE_LAB_PREFLIGHT_CONFIRMED === 'true', 'CONFIRMATION_REQUIRED');
    const timeoutMs = injected.timeoutMs ?? 15000;
    requireDrive(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000, 'CONFIGURATION_REJECTED');
    const now = injected.now ?? Date.now;
    stage = 'AUTH';
    const credentials = await (injected.loadCredentials ?? loadDesktopCredentials)(env.LEVEL_DRIVE_CREDENTIALS_FILE);
    const store = (injected.makeTokenStore ?? (directory => new DriveTokenStore(directory)))(env.LEVEL_DRIVE_TOKEN_DIR);
    const envelope = validateTokenEnvelope(await store.load(), { credentials, now: now() });
    usable(envelope, now());
    const sdk = await (injected.loadSdk ?? loadGoogleSdk)();
    const session = accessOnlyClient(sdk, envelope, now);
    // Header preparation is local and is not a remote verification of the account or token.
    await session.auth.getRequestHeaders();
    const call = async (group, method, params) => {
      session.assertUsable(); contacted = true;
      return requestOnce(options => session.client[group][method](params, options), timeoutMs);
    };
    stage = 'ROOT_GET';
    const root = await call('files', 'get', { fileId: 'root', fields: LAB_METADATA_FIELDS });
    requireDrive(typeof root.id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(root.id) && root.mimeType === LAB_FOLDER_MIME &&
      (root.parents === undefined || Array.isArray(root.parents) && root.parents.length === 0), 'INCOMPLETE_RESPONSE');
    stage = 'ROOT_PERMISSIONS';
    const permissions = await call('permissions', 'list', { fileId: root.id, pageSize: 100, fields: 'permissions(' + PERMISSIONS + '),nextPageToken' });
    requireDrive(Array.isArray(permissions.permissions) && permissions.permissions.length > 0 && permissions.nextPageToken === undefined &&
      permissions.permissions.every(p => p && typeof p.id === 'string' && typeof p.type === 'string' && typeof p.role === 'string'), 'INCOMPLETE_RESPONSE');
    stage = 'LAB_LIST';
    const files = await call('files', 'list', { spaces: 'drive', corpora: 'user', pageSize: 3,
      q: "trashed = false and appProperties has { key='levelXVIIILab' and value='" + LAB_TAG + "' }",
      fields: 'files(' + LAB_METADATA_FIELDS + '),nextPageToken,incompleteSearch' });
    requireDrive(Array.isArray(files.files) && files.files.length <= 3 && files.incompleteSearch === false &&
      files.nextPageToken === undefined && files.files.every(f => f && typeof f.id === 'string'), 'INCOMPLETE_RESPONSE');
    return report('READ_ONLY', 'COMPLETE', 'PREFLIGHT_READS_COMPLETED', contacted);
  } catch (error) {
    const code = safeDriveError(error).code;
    return report('BLOCKED', stage, SAFE.has(code) ? code : 'VALIDATION_OR_ACCESS_FAILED', contacted);
  }
}

export async function main(args = process.argv.slice(2), env = process.env, output = console, injected = {}) {
  let result;
  try { result = await runPreflightCommand({ ...parsePreflightArguments(args), env }, injected); }
  catch { result = report('BLOCKED', 'ARGUMENTS', 'ARGUMENTS_REJECTED'); }
  const failed = result.mode === 'BLOCKED';
  output[failed ? 'error' : 'log'](JSON.stringify(result)); return failed ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
