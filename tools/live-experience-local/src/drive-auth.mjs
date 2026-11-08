import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DriveError, requireDrive, safeDriveError, readPrivateJson, TOKEN_KIND, assertQuietRuntime } from './drive-token-store.mjs';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const TESTING_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CALLBACK_PATH = '/oauth2/callback';
const execFileAsync = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');

export async function loadGoogleSdk() {
  assertQuietRuntime();
  try {
    const { google } = await import('googleapis');
    return {
      oauth: credentials => {
        const client = new google.auth.OAuth2({ clientId: credentials?.client_id, clientSecret: credentials?.client_secret,
          transporterOptions: { timeout: 15000, retry: false } });
        // OAuth methods set their own retry:true; an official Gaxios interceptor enforces this CLI's bound.
        client.transporter.interceptors.request.add({ resolved: async options => ({ ...options, timeout: 15000, retry: false }) });
        return client;
      },
      drive: auth => google.drive({ version: 'v3', auth })
    };
  } catch { throw new DriveError('GOOGLE_SDK_UNAVAILABLE'); }
}

export async function loadDesktopCredentials(filename) {
  const raw = await readPrivateJson(filename);
  const installed = raw?.installed;
  requireDrive(installed && !raw.web && typeof installed.client_id === 'string' &&
    /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(installed.client_id) && installed.client_id.length <= 512 &&
    typeof installed.client_secret === 'string' && installed.client_secret.length > 0 && installed.client_secret.length <= 4096,
  'DESKTOP_CREDENTIALS_REQUIRED');
  requireDrive(['https://accounts.google.com/o/oauth2/auth', 'https://accounts.google.com/o/oauth2/v2/auth'].includes(installed.auth_uri) &&
    installed.token_uri === 'https://oauth2.googleapis.com/token', 'CREDENTIAL_ENDPOINT_REJECTED');
  // Endpoints and redirect_uris from JSON are never passed to a transport or browser.
  return { client_id: installed.client_id, client_secret: installed.client_secret };
}

function fixedScope(scope) {
  requireDrive(typeof scope === 'string' && scope.trim() === DRIVE_SCOPE, 'OAUTH_SCOPE_REJECTED');
  return DRIVE_SCOPE;
}
function cleanTokens(tokens) {
  requireDrive(tokens && typeof tokens.access_token === 'string' && tokens.access_token.length > 0 && tokens.access_token.length <= 16384 &&
    typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0 && tokens.refresh_token.length <= 16384 &&
    Number.isSafeInteger(tokens.expiry_date) && tokens.expiry_date > 0 &&
    (tokens.token_type === undefined || tokens.token_type === 'Bearer'), 'OAUTH_TOKEN_RESPONSE_INVALID');
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expiry_date: tokens.expiry_date,
    scope: fixedScope(tokens.scope), token_type: 'Bearer' };
}
export function createTokenEnvelope(tokens, credentials, now = Date.now()) {
  const clean = cleanTokens(tokens);
  requireDrive(clean.expiry_date > now, 'OAUTH_ACCESS_TOKEN_EXPIRED');
  const serverSeconds = tokens.refresh_token_expires_in;
  if (serverSeconds !== undefined) requireDrive(Number.isSafeInteger(serverSeconds) && serverSeconds > 0, 'OAUTH_TOKEN_RESPONSE_INVALID');
  return { kind: TOKEN_KIND, clientBinding: hash(credentials.client_id), authorizedAt: now,
    refreshTokenExpiresAt: now + Math.min(TESTING_REFRESH_TTL_MS, serverSeconds === undefined ? TESTING_REFRESH_TTL_MS : serverSeconds * 1000),
    tokens: clean };
}
export function validateTokenEnvelope(envelope, { credentials, now = Date.now(), allowExpired = false } = {}) {
  requireDrive(envelope?.kind === TOKEN_KIND && /^[a-f0-9]{64}$/.test(envelope.clientBinding) &&
    Number.isSafeInteger(envelope.authorizedAt) && envelope.authorizedAt > 0 && envelope.authorizedAt <= now &&
    Number.isSafeInteger(envelope.refreshTokenExpiresAt) && envelope.refreshTokenExpiresAt > envelope.authorizedAt &&
    envelope.refreshTokenExpiresAt <= envelope.authorizedAt + TESTING_REFRESH_TTL_MS, 'OAUTH_TOKEN_FILE_INVALID');
  if (credentials) requireDrive(envelope.clientBinding === hash(credentials.client_id), 'OAUTH_CLIENT_MISMATCH');
  const tokens = cleanTokens(envelope.tokens);
  requireDrive(allowExpired || envelope.refreshTokenExpiresAt > now, 'OAUTH_TESTING_REFRESH_EXPIRED');
  return { ...envelope, tokens };
}

export function parseOAuthCallback(request, { port, state }) {
  requireDrive(request.remoteAddress === '127.0.0.1' && request.host === '127.0.0.1:' + port && !request.origin,
    'OAUTH_CALLBACK_ORIGIN_REJECTED');
  requireDrive(request.method === 'GET' && typeof request.url === 'string' && request.url.startsWith('/') &&
    !request.url.startsWith('//') && request.url.length <= 8192, 'OAUTH_CALLBACK_REQUEST_REJECTED');
  let url;
  try { url = new URL(request.url, 'http://127.0.0.1:' + port); }
  catch { throw new DriveError('OAUTH_CALLBACK_REQUEST_REJECTED'); }
  requireDrive(url.pathname === CALLBACK_PATH && !url.hash, 'OAUTH_CALLBACK_PATH_REJECTED');
  for (const name of ['state', 'code', 'error']) requireDrive(url.searchParams.getAll(name).length <= 1, 'OAUTH_CALLBACK_DUPLICATE_PARAMETER');
  const actual = Buffer.from(url.searchParams.get('state') ?? ''), expected = Buffer.from(state);
  requireDrive(actual.length === expected.length && timingSafeEqual(actual, expected), 'OAUTH_STATE_REJECTED');
  if (url.searchParams.has('error')) {
    requireDrive(!url.searchParams.has('code'), 'OAUTH_CALLBACK_REQUEST_REJECTED');
    throw new DriveError(url.searchParams.get('error') === 'access_denied' ? 'OAUTH_CONSENT_DENIED' : 'OAUTH_CALLBACK_REJECTED');
  }
  const code = url.searchParams.get('code');
  requireDrive(typeof code === 'string' && code.length > 0 && code.length <= 4096 && !/[\r\n\0]/.test(code), 'OAUTH_CODE_MISSING');
  return code;
}

export async function createLoopbackCallback({ state, timeoutMs = 120000 }) {
  requireDrive(typeof state === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(state) &&
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000, 'OAUTH_CALLBACK_CONFIGURATION');
  let resolveCode, rejectCode, settled = false, timer;
  const code = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  code.catch(() => {}); // A timeout while the browser is opening must never be an unhandled rejection.
  const finish = (error, value) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    if (error) rejectCode(error); else resolveCode(value);
  };
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    try {
      requireDrive(!settled, 'OAUTH_CALLBACK_ALREADY_USED');
      const value = parseOAuthCallback({ method: request.method, url: request.url, host: request.headers.host,
        origin: request.headers.origin, remoteAddress: request.socket.remoteAddress }, { port: server.address().port, state });
      finish(null, value);
      response.writeHead(200); response.end('Autorizacao recebida. Pode fechar esta janela.');
    } catch (error) {
      const denied = ['OAUTH_CONSENT_DENIED', 'OAUTH_CALLBACK_REJECTED'].includes(error.code);
      if (denied) finish(error);
      response.writeHead(400); response.end('Solicitacao de autorizacao rejeitada.');
    }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
  } catch { throw new DriveError('OAUTH_CALLBACK_UNAVAILABLE'); }
  timer = setTimeout(() => finish(new DriveError('OAUTH_CALLBACK_TIMEOUT')), timeoutMs);
  const close = async () => {
    finish(new DriveError('OAUTH_CANCELLED'));
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  };
  return { redirectUri: 'http://127.0.0.1:' + server.address().port + CALLBACK_PATH, code, close };
}

export function validateAuthorizationUrl(value, { state, redirectUri, codeChallenge, clientId }) {
  let url;
  try { url = new URL(value); } catch { throw new DriveError('OAUTH_AUTHORIZATION_URL_REJECTED'); }
  const allowed = ['scope', 'response_type', 'access_type', 'prompt', 'state', 'redirect_uri', 'code_challenge_method', 'code_challenge', 'client_id'];
  requireDrive([...url.searchParams.keys()].every(key => allowed.includes(key) && url.searchParams.getAll(key).length === 1), 'OAUTH_AUTHORIZATION_URL_REJECTED');
  requireDrive(url.origin === 'https://accounts.google.com' && ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname) &&
    !url.username && !url.password && !url.hash && url.searchParams.get('state') === state &&
    url.searchParams.get('redirect_uri') === redirectUri && url.searchParams.get('client_id') === clientId &&
    url.searchParams.get('scope') === DRIVE_SCOPE && url.searchParams.get('response_type') === 'code' && url.searchParams.get('access_type') === 'offline' &&
    url.searchParams.get('code_challenge_method') === 'S256' && url.searchParams.get('code_challenge') === codeChallenge &&
    !url.searchParams.has('client_secret') && !url.searchParams.has('access_token'), 'OAUTH_AUTHORIZATION_URL_REJECTED');
}
export async function openSystemBrowser(url) {
  try {
    const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    await execFileAsync(command, args, { windowsHide: true, timeout: 15000, maxBuffer: 2048 });
  } catch { throw new DriveError('OAUTH_BROWSER_OPEN_FAILED'); }
}

export async function authorizeDesktop({ credentials, store, sdk, now = Date.now,
  callbackFactory = createLoopbackCallback, browser = openSystemBrowser }) {
  const entry = await store.ready();
  if (entry.exists) validateTokenEnvelope(await store.load(), { credentials, now: now(), allowExpired: true });
  const requestedAt = now();
  const auth = sdk.oauth(credentials);
  requireDrive(typeof auth.generateCodeVerifierAsync === 'function', 'OAUTH_PKCE_REQUIRED');
  const { codeVerifier, codeChallenge } = await auth.generateCodeVerifierAsync();
  requireDrive(typeof codeVerifier === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier) &&
    codeChallenge === createHash('sha256').update(codeVerifier).digest('base64url'), 'OAUTH_PKCE_REQUIRED');
  const state = randomBytes(32).toString('base64url');
  const callback = await callbackFactory({ state });
  try {
    const redirect = new URL(callback.redirectUri);
    requireDrive(redirect.protocol === 'http:' && redirect.hostname === '127.0.0.1' &&
      Number(redirect.port) > 0 && redirect.pathname === CALLBACK_PATH && !redirect.search && !redirect.hash &&
      !redirect.username && !redirect.password, 'OAUTH_CALLBACK_CONFIGURATION');
    const authUrl = auth.generateAuthUrl({ scope: [DRIVE_SCOPE], response_type: 'code', access_type: 'offline',
      prompt: 'consent select_account', state, redirect_uri: callback.redirectUri,
      code_challenge_method: 'S256', code_challenge: codeChallenge });
    validateAuthorizationUrl(authUrl, { state, redirectUri: callback.redirectUri, codeChallenge, clientId: credentials.client_id });
    await browser(authUrl);
    const code = await callback.code;
    const result = await auth.getToken({ code, codeVerifier, redirect_uri: callback.redirectUri });
    requireDrive(typeof result?.tokens?.refresh_token === 'string' && result.tokens.refresh_token.length > 0, 'OAUTH_REFRESH_TOKEN_REQUIRED');
    await store.save(createTokenEnvelope(result.tokens, credentials, requestedAt));
    return { status: 'AUTHORIZED_LOCALLY', scope: DRIVE_SCOPE, publicationChanged: false };
  } catch (error) { throw safeDriveError(error); }
  finally { await callback.close(); }
}

export async function authorizedSession({ credentials, store, sdk, now = Date.now }) {
  let envelope = validateTokenEnvelope(await store.load(), { credentials, now: now() });
  const auth = sdk.oauth(credentials);
  auth.setCredentials(envelope.tokens);
  const persist = async () => {
    // Refreshing an access token never extends the seven-day Testing deadline.
    const tokens = cleanTokens({ ...envelope.tokens, ...auth.credentials });
    requireDrive(tokens.expiry_date > now(), 'OAUTH_ACCESS_TOKEN_EXPIRED');
    const updated = { ...envelope, tokens };
    validateTokenEnvelope(updated, { credentials, now: now() });
    if (JSON.stringify(updated) !== JSON.stringify(envelope)) { await store.save(updated); envelope = updated; }
  };
  try {
    if (envelope.tokens.expiry_date <= now() + 30000) {
      const refreshed = await auth.refreshAccessToken();
      auth.setCredentials({ ...envelope.tokens, ...refreshed.credentials });
      await persist();
    }
  } catch (error) { throw safeDriveError(error); }
  return { auth, persist };
}

export async function revokeDesktop({ store, sdk, now = Date.now }) {
  const envelope = validateTokenEnvelope(await store.load(), { now: now(), allowExpired: true });
  try { await sdk.oauth().revokeToken(envelope.tokens.refresh_token); }
  catch (error) { throw safeDriveError(error); } // Preserve local tokens if remote revocation is not confirmed.
  await store.remove();
  return { status: 'REVOKED_AND_LOCAL_FILE_REMOVED', publicationChanged: false };
}
