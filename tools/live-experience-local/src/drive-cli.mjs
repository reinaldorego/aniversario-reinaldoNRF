import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DriveTokenStore, DriveError, requireDrive, safeDriveError, validateExternalPath, assertPrivatePermissions, assertQuietRuntime } from './drive-token-store.mjs';
import { DRIVE_SCOPE, loadGoogleSdk, loadDesktopCredentials, authorizeDesktop, authorizedSession, revokeDesktop } from './drive-auth.mjs';
import { loadSyntheticManifest, testConnectivity, readSyntheticFiles } from './drive-connection.mjs';

export const DRIVE_COMMANDS = ['diagnose', 'authorize', 'connectivity', 'read-synthetic', 'revoke', 'clean-local'];

export function parseDriveArguments(args) {
  const [command, ...flags] = args;
  requireDrive(DRIVE_COMMANDS.includes(command), 'DRIVE_COMMAND_REQUIRED');
  requireDrive(flags.length <= 1 && flags.every(flag => ['--execute', '--dry-run'].includes(flag)), 'DRIVE_ARGUMENTS_REJECTED');
  return { command, execute: flags[0] === '--execute' };
}

export async function runDriveCommand({ command, execute = false, env = process.env }, injected = {}) {
  requireDrive(DRIVE_COMMANDS.includes(command), 'DRIVE_COMMAND_REQUIRED');
  // This return precedes every dependency import, filesystem inspection, secret read, socket and effect.
  if (!execute) return { mode: 'DRY_RUN', command, scope: DRIVE_SCOPE, effects: 'NONE',
    credentialsPathConfigured: Boolean(env.LEVEL_DRIVE_CREDENTIALS_FILE), tokenDirectoryConfigured: Boolean(env.LEVEL_DRIVE_TOKEN_DIR),
    realGoogleRequiresApproval: '04B.3B', publicationChanged: false };
  assertQuietRuntime(env);
  const credentialsFile = env.LEVEL_DRIVE_CREDENTIALS_FILE;
  const tokenDirectory = env.LEVEL_DRIVE_TOKEN_DIR;
  const makeStore = injected.makeStore ?? (directory => new DriveTokenStore(directory));
  if (command === 'diagnose') {
    // Metadata/ACL inspection only; never deserialize credentials or tokens and never start OAuth.
    const inspect = injected.inspect ?? validateExternalPath;
    const permissions = injected.permissions ?? assertPrivatePermissions;
    const file = await inspect(credentialsFile);
    await permissions(path.dirname(file.filename)); await permissions(file.filename);
    const store = makeStore(tokenDirectory);
    const entry = await store.ready();
    try { import.meta.resolve('googleapis'); } catch { throw new DriveError('GOOGLE_SDK_UNAVAILABLE'); }
    return { mode: 'LOCAL_DIAGNOSTIC', status: 'LOCAL_METADATA_CHECKED', scope: DRIVE_SCOPE,
      tokenFilePresent: entry.exists, oauthStarted: false, networkUsed: false, publicationChanged: false };
  }
  const store = makeStore(tokenDirectory);
  if (command === 'clean-local') {
    await store.remove();
    return { status: 'LOCAL_TOKEN_FILE_REMOVED', remoteRevocation: 'NOT_PERFORMED', publicationChanged: false };
  }
  // Only explicitly executed commands below can load the SDK or contact Google.
  const sdk = await (injected.loadSdk ?? loadGoogleSdk)();
  if (command === 'revoke') return revokeDesktop({ store, sdk, now: injected.now });
  const credentials = await (injected.loadCredentials ?? loadDesktopCredentials)(credentialsFile);
  if (command === 'authorize') return authorizeDesktop({ credentials, store, sdk, now: injected.now,
    callbackFactory: injected.callbackFactory, browser: injected.browser });
  // Validate the external synthetic allowlist before refreshing a token or making any API request.
  const manifest = command === 'read-synthetic' ? await (injected.loadManifest ?? loadSyntheticManifest)(env.LEVEL_DRIVE_TEST_MANIFEST) : null;
  const session = await authorizedSession({ credentials, store, sdk, now: injected.now });
  const client = sdk.drive(session.auth);
  try {
    const result = command === 'connectivity' ? await testConnectivity(client) : await readSyntheticFiles(client, manifest);
    await session.persist();
    return result;
  } catch (error) { throw safeDriveError(error); }
}

export async function main(args = process.argv.slice(2), env = process.env, output = console) {
  try {
    const options = parseDriveArguments(args);
    const result = await runDriveCommand({ ...options, env });
    output.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    // Never print arguments, paths, provider messages/stacks, HTTP config, callback or authorization URLs.
    output.error(JSON.stringify({ error: safeDriveError(error).code }));
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
