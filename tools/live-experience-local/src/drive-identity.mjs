import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRIVE_SCOPE, loadGoogleSdk, loadDesktopCredentials, authorizedSession, validateTokenEnvelope } from './drive-auth.mjs';
import { DriveTokenStore, DriveError, requireDrive, safeDriveError, validateExternalPath, assertPrivatePermissions,
  readPrivateJson, assertQuietRuntime } from './drive-token-store.mjs';

export const IDENTITY_FIELDS = 'user(permissionId,me)';
export const IDENTITY_KIND = 'LEVEL_XVIII_DRIVE_IDENTITY_V1';
export const IDENTITY_FILE = 'drive-identity.json';
export const IDENTITY_LOCK = 'drive-identity.lock';
export const IDENTITY_TTL_MS = 60 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{1,256}$/;
const HEX = /^[a-f0-9]{64}$/;
const RECORD_KEYS = ['kind', 'scope', 'clientBinding', 'authorizedAt', 'refreshTokenExpiresAt', 'observedAt', 'expiresAt', 'ownerPermissionId', 'me'];
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const GRANT_KEYS = ['clientBinding', 'authorizedAt', 'refreshTokenExpiresAt'];
const SAFE_CODES = new Set([
  'IDENTITY_ARGUMENTS_REJECTED', 'IDENTITY_ACCOUNT_CONFIRMATION_REQUIRED', 'IDENTITY_RESPONSE_REJECTED', 'IDENTITY_TIMEOUT',
  'IDENTITY_TIMEOUT_CONFIGURATION', 'IDENTITY_RECORD_INVALID', 'IDENTITY_RECORD_EXPIRED', 'IDENTITY_CLIENT_MISMATCH',
  'IDENTITY_AUTHORIZATION_MISMATCH', 'IDENTITY_ACCOUNT_MISMATCH', 'IDENTITY_PATH_CONFIGURATION_REQUIRED',
  'IDENTITY_DIRECTORIES_OVERLAP', 'IDENTITY_DIRECTORY_NOT_DEDICATED', 'IDENTITY_LOCKED_OR_UNAVAILABLE', 'IDENTITY_LOCK_CHANGED',
  'IDENTITY_EXISTS', 'IDENTITY_NOT_FOUND', 'IDENTITY_STORAGE_FAILED', 'IDENTITY_OPERATION_FAILED',
  'OAUTH_AUTHORIZATION_REQUIRED', 'OAUTH_CLIENT_MISMATCH', 'OAUTH_SCOPE_REJECTED', 'OAUTH_TESTING_REFRESH_EXPIRED',
  'OAUTH_REAUTHORIZATION_REQUIRED', 'OAUTH_TOKEN_FILE_INVALID', 'OAUTH_ACCESS_TOKEN_EXPIRED',
  'DRIVE_HTTP_401', 'DRIVE_HTTP_403', 'DRIVE_HTTP_404', 'DRIVE_HTTP_429', 'GOOGLE_SERVICE_UNAVAILABLE',
  'PRIVATE_PERMISSIONS_REQUIRED', 'SENSITIVE_LOGGING_CONFIGURATION', 'INSECURE_TLS_CONFIGURATION'
]);

function safeIdentityError(error) {
  const code = safeDriveError(error).code;
  return new DriveError(SAFE_CODES.has(code) ? code : 'IDENTITY_OPERATION_FAILED');
}

export function parseIdentityArguments(args) {
  requireDrive(args.length <= 1 && args.every(arg => ['--execute', '--dry-run'].includes(arg)), 'IDENTITY_ARGUMENTS_REJECTED');
  return { execute: args[0] === '--execute' };
}

export function validateIdentityRecord(record, grant = null, now = Date.now()) {
  requireDrive(exact(record, RECORD_KEYS) && record.kind === IDENTITY_KIND && record.scope === DRIVE_SCOPE && record.me === true &&
    typeof record.clientBinding === 'string' && HEX.test(record.clientBinding) &&
    typeof record.ownerPermissionId === 'string' && ID.test(record.ownerPermissionId) &&
    ['authorizedAt', 'refreshTokenExpiresAt', 'observedAt', 'expiresAt'].every(key => Number.isSafeInteger(record[key]) && record[key] > 0) &&
    record.authorizedAt <= record.observedAt && record.observedAt <= now && record.refreshTokenExpiresAt > record.observedAt &&
    record.expiresAt === Math.min(record.observedAt + IDENTITY_TTL_MS, record.refreshTokenExpiresAt), 'IDENTITY_RECORD_INVALID');
  requireDrive(record.expiresAt > now, 'IDENTITY_RECORD_EXPIRED');
  if (grant) {
    requireDrive(record.clientBinding === grant.clientBinding, 'IDENTITY_CLIENT_MISMATCH');
    requireDrive(GRANT_KEYS.every(key => record[key] === grant[key]), 'IDENTITY_AUTHORIZATION_MISMATCH');
  }
  return record;
}

async function queryIdentity(client, timeoutMs) {
  requireDrive(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000, 'IDENTITY_TIMEOUT_CONFIGURATION');
  const controller = new AbortController(); let timer;
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => client.about.get({ fields: IDENTITY_FIELDS }, { signal: controller.signal, timeout: timeoutMs, retry: false })),
      new Promise((_, reject) => { timer = setTimeout(() => { reject(new DriveError('IDENTITY_TIMEOUT')); controller.abort(); }, timeoutMs); })
    ]);
    requireDrive(response?.status === 200 && exact(response.data, ['user']) && exact(response.data.user, ['permissionId', 'me']) &&
      response.data.user.me === true && typeof response.data.user.permissionId === 'string' && ID.test(response.data.user.permissionId),
    'IDENTITY_RESPONSE_REJECTED');
    return response.data.user.permissionId;
  } catch (error) { throw safeIdentityError(error); }
  finally { clearTimeout(timer); }
}

const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const contains = (parent, child) => {
  const relative = path.relative(normalized(parent), normalized(child));
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

// Dedicated external storage; never touches the lab journal, approval contents or token contents.
export class DriveIdentityStore {
  constructor(config) { this.config = config; }
  async ready() {
    const c = this.config;
    requireDrive(['directory', 'credentialsFile', 'tokenDirectory', 'labStateDirectory', 'labApprovalFile'].every(key =>
      typeof c?.[key] === 'string' && path.isAbsolute(c[key])), 'IDENTITY_PATH_CONFIGURATION_REQUIRED');
    const identity = await validateExternalPath(c.directory, { directory: true });
    const credentials = await validateExternalPath(c.credentialsFile);
    const tokens = await validateExternalPath(c.tokenDirectory, { directory: true });
    const lab = await validateExternalPath(c.labStateDirectory, { directory: true, allowMissing: true });
    const approval = await validateExternalPath(c.labApprovalFile, { allowMissing: true });
    const protectedDirectories = [path.dirname(credentials.filename), tokens.filename, lab.filename, path.dirname(approval.filename)];
    requireDrive(protectedDirectories.every(other => !contains(other, identity.filename) && !contains(identity.filename, other)),
      'IDENTITY_DIRECTORIES_OVERLAP');
    await assertPrivatePermissions(identity.filename);
    const names = await fs.readdir(identity.filename);
    requireDrive(names.every(name => [IDENTITY_FILE, IDENTITY_LOCK].includes(name)), 'IDENTITY_DIRECTORY_NOT_DEDICATED');
    return identity.filename;
  }
  async withLock(action) {
    const directory = await this.ready(), lockFile = path.join(directory, IDENTITY_LOCK), filename = path.join(directory, IDENTITY_FILE);
    let lock, identity, release = false;
    try {
      try { lock = await fs.open(lockFile, 'wx', 0o600); }
      catch { throw new DriveError('IDENTITY_LOCKED_OR_UNAVAILABLE'); }
      identity = await lock.stat();
      await validateExternalPath(lockFile); await assertPrivatePermissions(lockFile); await lock.sync(); release = true;
      const read = async () => {
        const entry = await validateExternalPath(filename, { allowMissing: true });
        return entry.exists ? await readPrivateJson(filename) : null;
      };
      return await action({ read, create: async record => {
        validateIdentityRecord(record, null, record.observedAt);
        await this.ready();
        // Hold the lock permanently after any uncertain write. No reader can accept a partial/unsynced file.
        release = false;
        let file;
        const bytes = Buffer.from(JSON.stringify(record) + '\n');
        requireDrive(bytes.length <= 4096, 'IDENTITY_RECORD_INVALID');
        try {
          try { file = await fs.open(filename, 'wx', 0o600); }
          catch (error) { throw new DriveError(error.code === 'EEXIST' ? 'IDENTITY_EXISTS' : 'IDENTITY_STORAGE_FAILED'); }
          const opened = await file.stat(), entry = await validateExternalPath(filename);
          requireDrive(opened.ino === entry.stat.ino && opened.dev === entry.stat.dev && opened.nlink === 1, 'IDENTITY_STORAGE_FAILED');
          await assertPrivatePermissions(filename); // Verify inherited ACL BEFORE writing identity bytes.
          await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
          requireDrive(JSON.stringify(await read()) === JSON.stringify(record), 'IDENTITY_STORAGE_FAILED');
          release = true;
        } finally { bytes.fill(0); if (file) await file.close(); }
      } });
    } catch (error) { throw error instanceof DriveError ? error : new DriveError('IDENTITY_STORAGE_FAILED'); }
    finally {
      if (lock) {
        await lock.close();
        if (release) {
          const current = await validateExternalPath(lockFile);
          requireDrive(current.stat.ino === identity.ino && current.stat.dev === identity.dev, 'IDENTITY_LOCK_CHANGED');
          await assertPrivatePermissions(lockFile); await fs.unlink(lockFile);
        }
      }
    }
  }
}

async function openSession(env, injected, now) {
  const credentials = await (injected.loadCredentials ?? loadDesktopCredentials)(env.LEVEL_DRIVE_CREDENTIALS_FILE);
  const sdk = await (injected.loadSdk ?? loadGoogleSdk)();
  const tokens = (injected.makeTokenStore ?? (directory => new DriveTokenStore(directory)))(env.LEVEL_DRIVE_TOKEN_DIR);
  let observed;
  // Reuse authorizedSession unchanged. Capture only its validated grant reference for the private receipt.
  const store = {
    load: async () => { observed = await tokens.load(); return observed; },
    save: async value => { await tokens.save(value); observed = value; }
  };
  const session = await authorizedSession({ credentials, store, sdk, now });
  const envelope = validateTokenEnvelope(observed, { credentials, now: now() });
  const grant = Object.fromEntries(GRANT_KEYS.map(key => [key, envelope[key]]));
  session.auth.forceRefreshOnFailure = false;
  const currentGrant = async () => {
    const current = validateTokenEnvelope(await tokens.load(), { credentials, now: now() });
    requireDrive(GRANT_KEYS.every(key => current[key] === grant[key]) &&
      current.tokens.refresh_token === session.auth.credentials.refresh_token, 'IDENTITY_AUTHORIZATION_MISMATCH');
  };
  return { grant, client: sdk.drive(session.auth), finish: async () => {
    await currentGrant(); await session.persist(); await currentGrant();
  } };
}

async function operate(mode, { execute = false, env = process.env, expectedOwnerPermissionId } = {}, injected = {}) {
  try {
    requireDrive(typeof execute === 'boolean', 'IDENTITY_ARGUMENTS_REJECTED');
    // This return precedes environment reads, SDK loading, secret access, sockets and all storage effects.
    if (!execute) return { mode: 'DRY_RUN', command: mode === 'capture' ? 'drive:identity' : 'private-identity-load', scope: DRIVE_SCOPE,
      effects: 'NONE', separateHumanApprovalRequired: true, publicationChanged: false };
    assertQuietRuntime(env);
    requireDrive(env.LEVEL_DRIVE_IDENTITY_ACCOUNT_CONFIRMED === 'true', 'IDENTITY_ACCOUNT_CONFIRMATION_REQUIRED');
    const now = injected.now ?? Date.now;
    const identityStore = (injected.makeIdentityStore ?? (config => new DriveIdentityStore(config)))({
      directory: env.LEVEL_DRIVE_IDENTITY_DIR, credentialsFile: env.LEVEL_DRIVE_CREDENTIALS_FILE,
      tokenDirectory: env.LEVEL_DRIVE_TOKEN_DIR, labStateDirectory: env.LEVEL_DRIVE_LAB_STATE_DIR, labApprovalFile: env.LEVEL_DRIVE_LAB_APPROVAL_FILE
    });
    return await identityStore.withLock(async transaction => {
      const existing = await transaction.read();
      if (mode === 'load') requireDrive(existing !== null, 'IDENTITY_NOT_FOUND');
      if (existing !== null) validateIdentityRecord(existing, null, now());
      if (expectedOwnerPermissionId !== undefined) requireDrive(typeof expectedOwnerPermissionId === 'string' && ID.test(expectedOwnerPermissionId),
        'IDENTITY_ACCOUNT_MISMATCH');
      const context = await openSession(env, injected, now);
      if (existing !== null) validateIdentityRecord(existing, context.grant, now());
      const ownerPermissionId = await queryIdentity(context.client, injected.timeoutMs ?? 15000);
      requireDrive((existing === null || ownerPermissionId === existing.ownerPermissionId) &&
        (expectedOwnerPermissionId === undefined || ownerPermissionId === expectedOwnerPermissionId), 'IDENTITY_ACCOUNT_MISMATCH');
      await context.finish();
      const observedAt = now();
      const record = existing ?? { kind: IDENTITY_KIND, scope: DRIVE_SCOPE, ...context.grant, observedAt,
        expiresAt: Math.min(observedAt + IDENTITY_TTL_MS, context.grant.refreshTokenExpiresAt), ownerPermissionId, me: true };
      validateIdentityRecord(record, context.grant, now());
      if (existing === null) await transaction.create(record);
      // The loader is deliberately private: only a separately approved future consumer may receive this value in memory.
      if (mode === 'load') return { ownerPermissionId, clientBinding: record.clientBinding, authorizedAt: record.authorizedAt, expiresAt: record.expiresAt };
      return { status: existing === null ? 'IDENTITY_STORED_PRIVATELY' : 'IDENTITY_ALREADY_VERIFIED', scope: DRIVE_SCOPE,
        identityVerified: true, labApprovalCreated: false, publicationChanged: false };
    });
  } catch (error) { throw safeIdentityError(error); }
}

export const runIdentityCommand = (options, injected) => operate('capture', options, injected);
export const loadPrivateDriveIdentity = (options, injected) => operate('load', options, injected);

export async function main(args = process.argv.slice(2), env = process.env, output = console, injected = {}) {
  try {
    output.log(JSON.stringify(await runIdentityCommand({ ...parseIdentityArguments(args), env }, injected))); return 0;
  } catch (error) { output.error(JSON.stringify({ error: safeIdentityError(error).code })); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
