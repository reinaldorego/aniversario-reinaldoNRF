import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const TOKEN_FILENAME = 'drive-oauth-tokens.json';
export const TOKEN_KIND = 'LEVEL_XVIII_DESKTOP_OAUTH_V1';
const MAX_JSON_BYTES = 64 * 1024;

export class DriveError extends Error {
  constructor(code) { super(code); this.name = 'DriveError'; this.code = code; }
}
export function requireDrive(condition, code) { if (!condition) throw new DriveError(code); }
export function assertQuietRuntime(env = process.env, execArgs = process.execArgv) {
  requireDrive(!['NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'DEBUG', 'GOOGLE_SDK_NODE_LOGGING', 'SSLKEYLOGFILE'].some(key => env[key]), 'SENSITIVE_LOGGING_CONFIGURATION');
  // Passive port/filename defaults do not enable inspection/tracing; Node's test runner forwards them.
  const risky = /^(?:-r$|--(?:inspect(?:-brk|-wait)?(?:=|$)|require(?:=|$)|import(?:=|$)|(?:experimental-)?loader(?:=|$)|trace(?:-|=|$)|tls-keylog(?:=|$)))/;
  const flags = (env.NODE_OPTIONS ?? '').match(/--[a-z][a-z-]*(?:=)?|(?:^|\s)-r(?=\s|$)/gi) ?? [];
  requireDrive(![...flags.map(flag => flag.trim()), ...execArgs].some(arg =>
    arg.split('=')[0] !== '--trace-event-file-pattern' && risky.test(arg)), 'SENSITIVE_LOGGING_CONFIGURATION');
  requireDrive(env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'INSECURE_TLS_CONFIGURATION');
}
export function safeDriveError(error) {
  if (error instanceof DriveError) return error;
  const oauth = error?.response?.data?.error;
  if (oauth === 'invalid_grant') return new DriveError('OAUTH_REAUTHORIZATION_REQUIRED');
  if (oauth === 'access_denied') return new DriveError('OAUTH_CONSENT_DENIED');
  const status = Number(error?.response?.status);
  if ([401, 403, 404, 429].includes(status)) return new DriveError('DRIVE_HTTP_' + status);
  if (status >= 500 && status <= 599) return new DriveError('GOOGLE_SERVICE_UNAVAILABLE');
  return new DriveError('DRIVE_OPERATION_FAILED');
}

const contains = (parent, child) => {
  const relative = path.relative(parent, child);
  return !relative || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
function external(filename) {
  requireDrive(typeof filename === 'string' && filename.length > 0 && !filename.includes('\0') && path.isAbsolute(filename), 'EXTERNAL_ABSOLUTE_PATH_REQUIRED');
  requireDrive(!/^(\\\\|\/\/)/.test(filename), 'NETWORK_PATH_FORBIDDEN');
  const resolved = path.resolve(filename);
  requireDrive(!contains(REPOSITORY, resolved) && !contains(resolved, REPOSITORY), 'PATH_MUST_BE_OUTSIDE_REPOSITORY');
  // Reject Windows alternate data streams, devices and ambiguous trailing characters.
  if (process.platform === 'win32') {
    requireDrive(!resolved.slice(path.parse(resolved).root.length).includes(':') &&
      resolved.slice(path.parse(resolved).root.length).split(path.sep).every(part =>
        !/[. ]$/.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)), 'UNSAFE_WINDOWS_PATH');
  }
  return resolved;
}

// Metadata only. Never reads credentials/tokens. Junctions and symbolic ancestors are refused.
export async function validateExternalPath(filename, options = {}) {
  try { return await inspectExternalPath(filename, options); }
  catch (error) { throw error instanceof DriveError ? error : new DriveError('PRIVATE_PATH_UNAVAILABLE'); }
}
async function inspectExternalPath(filename, { directory = false, allowMissing = false } = {}) {
  const resolved = external(filename);
  const root = path.parse(resolved).root;
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root, final;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    try { final = await fs.lstat(current); }
    catch (error) {
      if (allowMissing && index === parts.length - 1 && error.code === 'ENOENT') return { filename: resolved, exists: false };
      throw new DriveError('PRIVATE_PATH_UNAVAILABLE');
    }
    requireDrive(!final.isSymbolicLink(), 'SYMBOLIC_PATH_FORBIDDEN');
    if (index < parts.length - 1) requireDrive(final.isDirectory(), 'PRIVATE_PATH_UNAVAILABLE');
    requireDrive(!contains(REPOSITORY, await fs.realpath(current)), 'PATH_MUST_BE_OUTSIDE_REPOSITORY');
  }
  requireDrive(final && (directory ? final.isDirectory() : final.isFile()), 'PRIVATE_PATH_TYPE');
  if (!directory) requireDrive(final.nlink === 1, 'HARDLINK_FILE_FORBIDDEN');
  requireDrive(path.relative(resolved, await fs.realpath(resolved)) === '', 'SYMBOLIC_PATH_FORBIDDEN');
  return { filename: resolved, exists: true, stat: final };
}

export async function assertPrivatePermissions(filename) {
  if (process.platform !== 'win32') {
    const stat = await fs.stat(filename);
    requireDrive((stat.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || stat.uid === process.getuid()), 'PRIVATE_PERMISSIONS_REQUIRED');
    return;
  }
  // Only booleans leave PowerShell. A path is supplied as an environment value, never shell code.
  const script = [
    "$ErrorActionPreference='Stop'",
    "$acl=Get-Acl -LiteralPath $env:LEVEL_DRIVE_ACL_CHECK_PATH",
    "$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$trusted=@($me,'S-1-5-18','S-1-5-32-544')",
    "$owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
    "$ok=$trusted -contains $owner",
    "$rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])",
    "foreach($rule in $rules){if($rule.AccessControlType -eq 'Allow' -and $rule.FileSystemRights -ne 0 -and $trusted -notcontains $rule.IdentityReference.Value){$ok=$false}}",
    "if($ok){[Console]::Write('PRIVATE')}else{[Console]::Write('UNSAFE')}"
  ].join(';');
  try {
    const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 10000, maxBuffer: 2048,
      env: { ...process.env, LEVEL_DRIVE_ACL_CHECK_PATH: filename }
    });
    requireDrive(result.stdout === 'PRIVATE', 'PRIVATE_PERMISSIONS_REQUIRED');
  } catch { throw new DriveError('PRIVATE_PERMISSIONS_REQUIRED'); }
}

async function privatePath(filename, options = {}) {
  const result = await validateExternalPath(filename, options);
  await assertPrivatePermissions(options.directory ? result.filename : path.dirname(result.filename));
  if (result.exists && !options.directory) await assertPrivatePermissions(result.filename);
  return result;
}

export async function readPrivateJson(filename) {
  const before = await privatePath(filename);
  requireDrive(before.stat.size > 0 && before.stat.size <= MAX_JSON_BYTES, 'PRIVATE_JSON_SIZE');
  let file;
  try {
    file = await fs.open(before.filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await file.stat();
    requireDrive(opened.ino === before.stat.ino && opened.dev === before.stat.dev && opened.nlink === 1, 'PRIVATE_FILE_CHANGED');
    const buffer = Buffer.alloc(MAX_JSON_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const read = await file.read(buffer, total, buffer.length - total, total);
      if (!read.bytesRead) break;
      total += read.bytesRead;
    }
    const after = await validateExternalPath(filename);
    requireDrive(total === before.stat.size && total <= MAX_JSON_BYTES && after.stat.ino === opened.ino &&
      after.stat.dev === opened.dev && after.stat.size === opened.size && after.stat.mtimeMs === opened.mtimeMs &&
      after.stat.ctimeMs === opened.ctimeMs, 'PRIVATE_FILE_CHANGED');
    try { return JSON.parse(buffer.toString('utf8', 0, total)); }
    catch { throw new DriveError('PRIVATE_JSON_INVALID'); }
    finally { buffer.fill(0); }
  } catch (error) { throw error instanceof DriveError ? error : new DriveError('PRIVATE_FILE_READ_FAILED'); }
  finally { if (file) await file.close(); }
}

export class DriveTokenStore {
  constructor(directory) { this.directory = external(directory); this.filename = path.join(this.directory, TOKEN_FILENAME); }
  async ready() {
    await privatePath(this.directory, { directory: true });
    return privatePath(this.filename, { allowMissing: true });
  }
  async load() {
    const entry = await this.ready();
    if (!entry.exists) throw new DriveError('OAUTH_AUTHORIZATION_REQUIRED');
    const value = await readPrivateJson(this.filename);
    requireDrive(value?.kind === TOKEN_KIND, 'TOKEN_FILE_NOT_OWNED');
    return value;
  }
  async save(value) {
    requireDrive(value?.kind === TOKEN_KIND, 'TOKEN_FILE_NOT_OWNED');
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    requireDrive(bytes.length <= MAX_JSON_BYTES, 'PRIVATE_JSON_SIZE');
    const entry = await this.ready();
    if (entry.exists) await this.load(); // Never overwrite an unrelated/corrupt file.
    const temporary = this.filename + '.' + randomUUID() + '.tmp';
    let file, created = false;
    try {
      file = await fs.open(temporary, 'wx', 0o600); created = true;
      await privatePath(temporary); // Verify inherited Windows ACL before writing token bytes.
      await file.writeFile(bytes); await file.sync(); await file.close(); file = null;
      await this.ready();
      await fs.rename(temporary, this.filename); created = false;
    } catch (error) { throw error instanceof DriveError ? error : new DriveError('TOKEN_SAVE_FAILED'); }
    finally {
      bytes.fill(0);
      if (file) await file.close();
      if (created) await fs.unlink(temporary).catch(() => {});
    }
  }
  async remove() {
    await this.load(); // Fixed filename, owned envelope, external path, no recursive deletion.
    await this.ready();
    try { await fs.unlink(this.filename); }
    catch { throw new DriveError('TOKEN_CLEANUP_FAILED'); }
  }
}
