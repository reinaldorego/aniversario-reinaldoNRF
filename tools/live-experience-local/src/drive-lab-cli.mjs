import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DRIVE_SCOPE, loadGoogleSdk, loadDesktopCredentials, authorizedSession } from './drive-auth.mjs';
import { DriveTokenStore, requireDrive, safeDriveError, assertQuietRuntime, readPrivateJson } from './drive-token-store.mjs';
import { DriveLabState, validateLabApproval } from './drive-lab-state.mjs';
import { performLabOperation } from './drive-lab.mjs';

export const LAB_COMMANDS = ['lab-create', 'lab-inspect'];
export function parseLabArguments(args) {
  const [command, ...flags] = args;
  requireDrive(LAB_COMMANDS.includes(command), 'LAB_COMMAND_REQUIRED');
  requireDrive(flags.length <= 1 && flags.every(flag => ['--dry-run', '--execute'].includes(flag)), 'LAB_ARGUMENTS_REJECTED');
  return { command, execute: flags[0] === '--execute' };
}

export async function runLabCommand({ command, execute = false, env = process.env }, injected = {}) {
  requireDrive(LAB_COMMANDS.includes(command) && typeof execute === 'boolean', 'LAB_ARGUMENTS_REJECTED');
  // No config/secret reads, SDK load, sockets, filesystem probes or state mutations precede this return.
  if (!execute) return { mode: 'DRY_RUN', command, scope: DRIVE_SCOPE, effects: 'NONE',
    separateHumanApprovalRequired: true, publicationChanged: false };
  assertQuietRuntime(env);
  const now = injected.now ?? Date.now;
  const approval = validateLabApproval(await (injected.loadApproval ?? readPrivateJson)(env.LEVEL_DRIVE_LAB_APPROVAL_FILE), command, DRIVE_SCOPE, now());
  const stateStore = (injected.makeState ?? (directory => new DriveLabState(directory)))(env.LEVEL_DRIVE_LAB_STATE_DIR);
  requireDrive(stateStore.binding() === approval.stateBinding, 'LAB_STATE_BINDING_REJECTED');
  let session;
  const result = await performLabOperation({ action: command, approval, stateStore, now, timeoutMs: injected.timeoutMs ?? 15000,
    clientFactory: async approved => {
      const credentials = await (injected.loadCredentials ?? loadDesktopCredentials)(env.LEVEL_DRIVE_CREDENTIALS_FILE);
      requireDrive(createHash('sha256').update(credentials.client_id).digest('hex') === approved.clientBinding, 'OAUTH_CLIENT_MISMATCH');
      const sdk = await (injected.loadSdk ?? loadGoogleSdk)();
      const store = (injected.makeTokenStore ?? (directory => new DriveTokenStore(directory)))(env.LEVEL_DRIVE_TOKEN_DIR);
      session = await authorizedSession({ credentials, store, sdk, now });
      // The SDK's OAuth layer has its own 401/403 replay path, separate from Gaxios retry.
      // Existing session validation guarantees expiry_date; do not enable forced refresh/replay.
      session.auth.forceRefreshOnFailure = false;
      return sdk.drive(session.auth);
    }
  });
  await session.persist();
  return result;
}

export async function main(args = process.argv.slice(2), env = process.env, output = console, injected = {}) {
  try {
    const result = await runLabCommand({ ...parseLabArguments(args), env }, injected);
    output.log(JSON.stringify(result)); return 0;
  } catch (error) {
    output.error(JSON.stringify({ error: safeDriveError(error).code })); return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
