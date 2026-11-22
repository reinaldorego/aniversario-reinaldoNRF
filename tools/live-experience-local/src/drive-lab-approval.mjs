import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DRIVE_SCOPE, loadDesktopCredentials, validateTokenEnvelope } from './drive-auth.mjs';
import { DriveError, DriveTokenStore, requireDrive, safeDriveError, validateExternalPath, assertPrivatePermissions,
  readPrivateJson, assertQuietRuntime } from './drive-token-store.mjs';
import { DriveIdentityStore, validateIdentityRecord } from './drive-identity.mjs';
import { LAB_APPROVAL_KIND, validateLabApproval, labDirectoryBinding } from './drive-lab-state.mjs';

export const PREPARE_LOCK = 'drive-lab-prepare.lock';
export const MIN_APPROVAL_VALIDITY_MS = 5 * 60 * 1000;
const execFileAsync = promisify(execFile);
const GRANT_KEYS = ['clientBinding', 'authorizedAt', 'refreshTokenExpiresAt'];
const SAFE_CODES = new Set([
  'APPROVAL_ARGUMENTS_REJECTED', 'APPROVAL_HUMAN_CONFIRMATION_REQUIRED', 'APPROVAL_PATH_CONFIGURATION_REQUIRED',
  'APPROVAL_DIRECTORIES_OVERLAP', 'APPROVAL_DIRECTORY_NOT_DEDICATED', 'APPROVAL_STATE_NOT_EMPTY', 'APPROVAL_DESTINATION_EXISTS',
  'APPROVAL_LOCKED_OR_UNAVAILABLE', 'APPROVAL_LOCK_CHANGED', 'APPROVAL_FILESYSTEM_UNSUPPORTED', 'APPROVAL_FILESYSTEM_UNVERIFIED',
  'APPROVAL_INSUFFICIENT_VALIDITY', 'APPROVAL_IDENTITY_REQUIRED', 'APPROVAL_SOURCE_CHANGED', 'APPROVAL_ENTROPY_REJECTED',
  'APPROVAL_WRITE_UNCERTAIN', 'APPROVAL_PUBLICATION_UNCERTAIN', 'APPROVAL_ATOMIC_PUBLICATION_UNAVAILABLE',
  'APPROVAL_INTEGRITY_REJECTED', 'APPROVAL_OPERATION_FAILED', 'LAB_APPROVAL_REJECTED',
  'IDENTITY_RECORD_INVALID', 'IDENTITY_RECORD_EXPIRED', 'IDENTITY_CLIENT_MISMATCH', 'IDENTITY_AUTHORIZATION_MISMATCH',
  'IDENTITY_LOCKED_OR_UNAVAILABLE', 'IDENTITY_DIRECTORY_NOT_DEDICATED', 'IDENTITY_DIRECTORIES_OVERLAP',
  'OAUTH_CLIENT_MISMATCH', 'OAUTH_AUTHORIZATION_REQUIRED', 'OAUTH_TESTING_REFRESH_EXPIRED', 'OAUTH_SCOPE_REJECTED',
  'PRIVATE_PERMISSIONS_REQUIRED', 'SENSITIVE_LOGGING_CONFIGURATION', 'INSECURE_TLS_CONFIGURATION'
]);
const safeError = error => {
  const code = safeDriveError(error).code;
  return new DriveError(SAFE_CODES.has(code) ? code : 'APPROVAL_OPERATION_FAILED');
};
const normalized = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const contains = (parent, child) => {
  const relative = path.relative(normalized(parent), normalized(child));
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const canonical = value => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev && a.isFile() && b.isFile() && !a.isSymbolicLink() && !b.isSymbolicLink();

export function parsePrepareArguments(args) {
  requireDrive(args.length <= 1 && args.every(arg => ['--execute', '--dry-run'].includes(arg)), 'APPROVAL_ARGUMENTS_REJECTED');
  return { execute: args[0] === '--execute' };
}

export async function assertLocalNtfs(directory, { platform = process.platform, inspect = execFileAsync } = {}) {
  requireDrive(platform === 'win32', 'APPROVAL_FILESYSTEM_UNSUPPORTED');
  try {
    const result = await inspect('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop';$root=[System.IO.Path]::GetPathRoot($env:LEVEL_APPROVAL_FS_PATH);[Console]::Write(([System.IO.DriveInfo]::new($root)).DriveFormat)"],
    { windowsHide: true, timeout: 10000, maxBuffer: 128, env: { ...process.env, LEVEL_APPROVAL_FS_PATH: directory } });
    requireDrive(result.stdout === 'NTFS', 'APPROVAL_FILESYSTEM_UNSUPPORTED');
  } catch (error) { throw error instanceof DriveError ? error : new DriveError('APPROVAL_FILESYSTEM_UNVERIFIED'); }
}

export function approvalExpiry(now, identityExpiresAt, grantExpiresAt) {
  requireDrive([now, identityExpiresAt, grantExpiresAt].every(value => Number.isSafeInteger(value) && value > 0), 'APPROVAL_INSUFFICIENT_VALIDITY');
  const expiresAt = Math.min(now + 3600000, identityExpiresAt, grantExpiresAt);
  requireDrive(expiresAt - now >= MIN_APPROVAL_VALIDITY_MS, 'APPROVAL_INSUFFICIENT_VALIDITY');
  return expiresAt;
}

function checkedApproval(value, now) {
  const approval = validateLabApproval(value, 'lab-create', DRIVE_SCOPE, now);
  requireDrive(approval.expiresAt - now >= MIN_APPROVAL_VALIDITY_MS, 'APPROVAL_INSUFFICIENT_VALIDITY');
  return approval;
}

// One fixed configured destination. No LabState mutation, recovery, replacement or cleanup command.
export class LabApprovalWriter {
  constructor(config) { this.config = config; }
  async ready(stageName = null) {
    const c = this.config;
    requireDrive(['approvalFile', 'stateDirectory', 'identityDirectory', 'tokenDirectory', 'credentialsFile'].every(key =>
      typeof c?.[key] === 'string' && path.isAbsolute(c[key])), 'APPROVAL_PATH_CONFIGURATION_REQUIRED');
    const approval = await validateExternalPath(c.approvalFile, { allowMissing: true });
    const directory = path.dirname(approval.filename), basename = path.basename(approval.filename);
    requireDrive(basename !== PREPARE_LOCK && !basename.startsWith('.drive-lab-approval-'), 'APPROVAL_PATH_CONFIGURATION_REQUIRED');
    const state = await validateExternalPath(c.stateDirectory, { directory: true });
    const identity = await validateExternalPath(c.identityDirectory, { directory: true });
    const tokens = await validateExternalPath(c.tokenDirectory, { directory: true });
    const credentials = await validateExternalPath(c.credentialsFile);
    const directories = [directory, state.filename, identity.filename, tokens.filename, path.dirname(credentials.filename)];
    for (let i = 0; i < directories.length; i++) for (let j = i + 1; j < directories.length; j++) {
      requireDrive(!contains(directories[i], directories[j]) && !contains(directories[j], directories[i]), 'APPROVAL_DIRECTORIES_OVERLAP');
    }
    for (const item of directories) {
      await validateExternalPath(item, { directory: true }); await assertPrivatePermissions(item);
    }
    requireDrive((await fs.readdir(state.filename)).length === 0, 'APPROVAL_STATE_NOT_EMPTY');
    const names = await fs.readdir(directory);
    requireDrive(names.every(name => [basename, PREPARE_LOCK, stageName].includes(name)), 'APPROVAL_DIRECTORY_NOT_DEDICATED');
    return { directory, filename: approval.filename, exists: approval.exists, stateDirectory: state.filename };
  }
  async withLock(action) {
    const location = await this.ready();
    requireDrive(!location.exists, 'APPROVAL_DESTINATION_EXISTS');
    await assertLocalNtfs(location.directory);
    const lockFile = path.join(location.directory, PREPARE_LOCK);
    let lock, lockStat, release = false, publicationStarted = false;
    try {
      try { lock = await fs.open(lockFile, 'wx', 0o600); }
      catch { throw new DriveError('APPROVAL_LOCKED_OR_UNAVAILABLE'); }
      lockStat = await lock.stat();
      await validateExternalPath(lockFile); await assertPrivatePermissions(lockFile); await lock.sync(); release = true;
      const fresh = await this.ready(); requireDrive(!fresh.exists, 'APPROVAL_DESTINATION_EXISTS');
      return await action({ stateDirectory: fresh.stateDirectory, publish: async (raw, verifySources, now) => {
        const approval = checkedApproval(raw, now());
        const bytes = Buffer.from(JSON.stringify(approval) + '\n');
        requireDrive(bytes.length <= 4096, 'APPROVAL_INTEGRITY_REJECTED');
        const stageName = '.drive-lab-approval-' + randomUUID() + '.tmp', stage = path.join(location.directory, stageName);
        let file, original;
        release = false; // All write/publication failures retain the lock and evidence, even if no final name exists.
        try {
          file = await fs.open(stage, 'wx', 0o600);
          original = await file.stat();
          const entry = await validateExternalPath(stage);
          requireDrive(sameFile(original, entry.stat) && original.nlink === 1, 'APPROVAL_INTEGRITY_REJECTED');
          await assertPrivatePermissions(stage); // Before any approval bytes.
          await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
          const readback = checkedApproval(await readPrivateJson(stage), now());
          requireDrive(canonical(readback) === canonical(approval), 'APPROVAL_INTEGRITY_REJECTED');
          await verifySources();
          const beforeLink = await this.ready(stageName);
          requireDrive(!beforeLink.exists, 'APPROVAL_DESTINATION_EXISTS');
          checkedApproval(approval, now());
          publicationStarted = true;
          try { await fs.link(stage, location.filename); }
          catch (error) {
            if (error.code === 'EEXIST') throw new DriveError('APPROVAL_DESTINATION_EXISTS');
            if (['EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS'].includes(error.code)) throw new DriveError('APPROVAL_ATOMIC_PUBLICATION_UNAVAILABLE');
            throw new DriveError('APPROVAL_PUBLICATION_UNCERTAIN');
          }
          const staged = await fs.lstat(stage), published = await fs.lstat(location.filename);
          requireDrive(sameFile(original, staged) && sameFile(staged, published) && staged.nlink === 2 && published.nlink === 2 &&
            staged.size === bytes.length && published.size === bytes.length, 'APPROVAL_INTEGRITY_REJECTED');
          await assertPrivatePermissions(stage); await assertPrivatePermissions(location.filename);
          await verifySources();
          await validateExternalPath(fresh.stateDirectory, { directory: true });
          await assertPrivatePermissions(fresh.stateDirectory); await assertPrivatePermissions(location.directory);
          requireDrive((await fs.readdir(fresh.stateDirectory)).length === 0, 'APPROVAL_STATE_NOT_EMPTY');
          checkedApproval(approval, now());
          // During this two-link window the existing private reader rejects the final path. No partial JSON is exposed.
          await fs.unlink(stage);
          const final = await validateExternalPath(location.filename);
          requireDrive(sameFile(original, final.stat) && final.stat.nlink === 1, 'APPROVAL_INTEGRITY_REJECTED');
          requireDrive(canonical(checkedApproval(await readPrivateJson(location.filename), now())) === canonical(approval), 'APPROVAL_INTEGRITY_REJECTED');
          release = true;
        } finally { bytes.fill(0); if (file) await file.close(); }
      } });
    } catch (error) {
      if (publicationStarted) release = false;
      if (error instanceof DriveError) throw error;
      throw new DriveError(publicationStarted ? 'APPROVAL_PUBLICATION_UNCERTAIN' : 'APPROVAL_WRITE_UNCERTAIN');
    } finally {
      if (lock) {
        await lock.close();
        if (release) {
          const current = await validateExternalPath(lockFile);
          requireDrive(sameFile(lockStat, current.stat), 'APPROVAL_LOCK_CHANGED');
          await assertPrivatePermissions(lockFile);
          try { await fs.unlink(lockFile); }
          catch { throw new DriveError(publicationStarted ? 'APPROVAL_PUBLICATION_UNCERTAIN' : 'APPROVAL_OPERATION_FAILED'); }
        }
      }
    }
  }
}

export async function runPrepareCommand({ execute = false, env = process.env } = {}, injected = {}) {
  try {
    requireDrive(typeof execute === 'boolean', 'APPROVAL_ARGUMENTS_REJECTED');
    if (!execute) return { mode: 'DRY_RUN', command: 'drive:lab-prepare', scope: DRIVE_SCOPE, effects: 'NONE',
      separateHumanApprovalRequired: true, googleContacted: false, publicationChanged: false };
    assertQuietRuntime(env);
    requireDrive(env.LEVEL_DRIVE_LAB_PREPARE_CONFIRMED === 'true' && env.LEVEL_DRIVE_IDENTITY_ACCOUNT_CONFIRMED === 'true',
      'APPROVAL_HUMAN_CONFIRMATION_REQUIRED');
    const now = injected.now ?? Date.now;
    const writer = (injected.makeWriter ?? (config => new LabApprovalWriter(config)))({ approvalFile: env.LEVEL_DRIVE_LAB_APPROVAL_FILE,
      stateDirectory: env.LEVEL_DRIVE_LAB_STATE_DIR, identityDirectory: env.LEVEL_DRIVE_IDENTITY_DIR,
      tokenDirectory: env.LEVEL_DRIVE_TOKEN_DIR, credentialsFile: env.LEVEL_DRIVE_CREDENTIALS_FILE });
    return await writer.withLock(async destination => {
      const identity = (injected.makeIdentityStore ?? (config => new DriveIdentityStore(config)))({ directory: env.LEVEL_DRIVE_IDENTITY_DIR,
        credentialsFile: env.LEVEL_DRIVE_CREDENTIALS_FILE, tokenDirectory: env.LEVEL_DRIVE_TOKEN_DIR,
        labStateDirectory: env.LEVEL_DRIVE_LAB_STATE_DIR, labApprovalFile: env.LEVEL_DRIVE_LAB_APPROVAL_FILE });
      return identity.withLock(async stored => {
        const tokens = (injected.makeTokenStore ?? (directory => new DriveTokenStore(directory)))(env.LEVEL_DRIVE_TOKEN_DIR);
        const snapshot = async () => {
          const record = await stored.read(); requireDrive(record !== null, 'APPROVAL_IDENTITY_REQUIRED');
          const credentials = await (injected.loadCredentials ?? loadDesktopCredentials)(env.LEVEL_DRIVE_CREDENTIALS_FILE);
          const envelope = validateTokenEnvelope(await tokens.load(), { credentials, now: now() });
          validateIdentityRecord(record, envelope, now());
          return { record, envelope };
        };
        const initial = await snapshot();
        const expiresAt = approvalExpiry(now(), initial.record.expiresAt, initial.envelope.refreshTokenExpiresAt);
        const entropy = injected.randomBytes ?? randomBytes;
        const approvalBytes = entropy(32), operationBytes = entropy(16);
        requireDrive(Buffer.isBuffer(approvalBytes) && approvalBytes.length === 32 && Buffer.isBuffer(operationBytes) && operationBytes.length === 16,
          'APPROVAL_ENTROPY_REJECTED');
        const candidate = { kind: LAB_APPROVAL_KIND, action: 'lab-create', approvalId: approvalBytes.toString('hex'),
          operationId: operationBytes.toString('hex'), expiresAt, scope: DRIVE_SCOPE, clientBinding: initial.envelope.clientBinding,
          stateBinding: labDirectoryBinding(destination.stateDirectory), ownerPermissionId: initial.record.ownerPermissionId, files: [] };
        approvalBytes.fill(0); operationBytes.fill(0);
        const approval = checkedApproval(candidate, now());
        await destination.publish(approval, async () => {
          const latest = await snapshot();
          requireDrive(canonical(latest.record) === canonical(initial.record) && GRANT_KEYS.every(key => latest.envelope[key] === initial.envelope[key]) &&
            ['access_token', 'refresh_token'].every(key => latest.envelope.tokens[key] === initial.envelope.tokens[key]), 'APPROVAL_SOURCE_CHANGED');
          approvalExpiry(now(), latest.record.expiresAt, latest.envelope.refreshTokenExpiresAt);
        }, now);
        return { status: 'LAB_CREATE_APPROVAL_PREPARED_PRIVATELY', scope: DRIVE_SCOPE, googleContacted: false,
          labStateChanged: false, publicationChanged: false };
      });
    });
  } catch (error) { throw safeError(error); }
}

export async function main(args = process.argv.slice(2), env = process.env, output = console, injected = {}) {
  try { output.log(JSON.stringify(await runPrepareCommand({ ...parsePrepareArguments(args), env }, injected))); return 0; }
  catch (error) { output.error(JSON.stringify({ error: safeError(error).code })); return 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
