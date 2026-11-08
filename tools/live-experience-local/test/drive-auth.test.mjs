import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import https from 'node:https';
import { DRIVE_SCOPE, TESTING_REFRESH_TTL_MS, loadGoogleSdk, authorizeDesktop, authorizedSession, revokeDesktop,
  validateTokenEnvelope, validateAuthorizationUrl } from '../src/drive-auth.mjs';
import { DriveError, safeDriveError } from '../src/drive-token-store.mjs';
import { FAKE_CREDENTIALS, OAUTH_NOW, fakeTokens, fakeEnvelope, oauthHarness, providerFailure } from './drive-oauth-fixtures.mjs';

test('A01 — SDK oficial gera PKCE S256 offline, sem iniciar transporte', async t => {
  t.mock.method(https, 'request', () => { throw new Error('NETWORK_FORBIDDEN'); });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('NETWORK_FORBIDDEN'); });
  const sdk = await loadGoogleSdk(), auth = sdk.oauth(FAKE_CREDENTIALS);
  const pair = await auth.generateCodeVerifierAsync();
  assert.match(pair.codeVerifier, /^[A-Za-z0-9._~-]{43,128}$/);
  assert.equal(pair.codeChallenge, createHash('sha256').update(pair.codeVerifier).digest('base64url'));
  assert.equal(auth.transporter.defaults.timeout, 15000);
  assert.equal(auth.transporter.defaults.retry, false);
  const h = oauthHarness();
  auth.getToken = async options => { h.auth.exchanges.push(options); return { tokens: fakeTokens() }; };
  h.sdk.oauth = () => auth;
  await authorizeDesktop(h);
  assert.equal(h.auth.exchanges.length, 1); assert.equal(h.closed, 1);
  assert.equal(h.store.value.tokens.scope, DRIVE_SCOPE);
});

test('A02 — autorização explícita: state, PKCE, loopback, escopo único e persistência mínima', async () => {
  const h = oauthHarness();
  const result = await authorizeDesktop(h);
  assert.equal(result.publicationChanged, false); assert.equal(h.opened, 1); assert.equal(h.closed, 1);
  const options = h.auth.options;
  assert.deepEqual(options.scope, [DRIVE_SCOPE]); assert.match(options.state, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(options.state, h.callbackState); assert.equal(options.access_type, 'offline');
  assert.equal(options.code_challenge_method, 'S256'); assert.equal(options.include_granted_scopes, undefined);
  assert.equal(h.auth.exchanges[0].redirect_uri, 'http://127.0.0.1:34567/oauth2/callback');
  assert.equal(options.code_challenge, createHash('sha256').update(h.auth.exchanges[0].codeVerifier).digest('base64url'));
  assert.equal(h.store.value.refreshTokenExpiresAt, OAUTH_NOW + TESTING_REFRESH_TTL_MS);
  const serialized = JSON.stringify(h.store.value);
  for (const absent of [FAKE_CREDENTIALS.client_secret, options.state, options.code_challenge, h.auth.exchanges[0].codeVerifier,
    h.auth.exchanges[0].code, 'accounts.google.com']) assert.ok(!serialized.includes(absent));
  assert.deepEqual(Object.keys(h.store.value.tokens).sort(), ['access_token', 'expiry_date', 'refresh_token', 'scope', 'token_type']);
});

test('A03 — falta de suporte/pares PKCE inválidos bloqueia antes de callback ou navegador', async t => {
  for (const condition of ['missing', 'verifier', 'challenge']) await t.test(condition, async () => {
    const h = oauthHarness();
    if (condition === 'missing') h.auth.generateCodeVerifierAsync = null;
    else h.auth.generateCodeVerifierAsync = async () => ({ codeVerifier: condition === 'verifier' ? 'short' : 'v'.repeat(64), codeChallenge: 'wrong' });
    await assert.rejects(authorizeDesktop(h), { code: 'OAUTH_PKCE_REQUIRED' });
    assert.equal(h.callbacks, 0); assert.equal(h.opened, 0); assert.equal(h.store.saves, 0);
  });
});

test('A04 — origem de callback ou URL de autorização adulterada nunca abre navegador', async t => {
  for (const uri of ['http://localhost:34567/oauth2/callback', 'http://0.0.0.0:34567/oauth2/callback',
    'https://example.invalid/oauth2/callback', 'http://127.0.0.1:34567/wrong']) await t.test(new URL(uri).hostname, async () => {
    const h = oauthHarness();
    h.callbackFactory = async () => ({ redirectUri: uri, code: Promise.resolve('SYNTHETIC'), close: async () => { h.closed++; } });
    await assert.rejects(authorizeDesktop(h), { code: 'OAUTH_CALLBACK_CONFIGURATION' });
    assert.equal(h.opened, 0); assert.equal(h.closed, 1);
  });
  const h = oauthHarness(); h.auth.generateAuthUrl = () => 'https://example.invalid/';
  await assert.rejects(authorizeDesktop(h), { code: 'OAUTH_AUTHORIZATION_URL_REJECTED' });
  assert.equal(h.opened, 0); assert.equal(h.store.saves, 0);
});

test('A05 — consentimento negado/timeout preserva token anterior e não troca código', async t => {
  for (const code of ['OAUTH_CONSENT_DENIED', 'OAUTH_CALLBACK_TIMEOUT']) await t.test(code, async () => {
    const h = oauthHarness({ envelope: fakeEnvelope() }), previous = structuredClone(h.store.value);
    h.callbackFactory = async () => {
      const rejected = Promise.reject(new DriveError(code)); rejected.catch(() => {});
      return { redirectUri: 'http://127.0.0.1:34567/oauth2/callback', code: rejected, close: async () => { h.closed++; } };
    };
    await assert.rejects(authorizeDesktop(h), { code });
    assert.deepEqual(h.store.value, previous); assert.equal(h.store.saves, 0); assert.equal(h.auth.exchanges.length, 0); assert.equal(h.closed, 1);
  });
});

test('A06 — falhas OAuth/HTTP são sanitizadas e não substituem tokens anteriores', async t => {
  for (const [status, error, expected] of [[400, 'invalid_grant', 'OAUTH_REAUTHORIZATION_REQUIRED'],
    [400, 'access_denied', 'OAUTH_CONSENT_DENIED'], [401, 'other', 'DRIVE_HTTP_401'], [403, 'other', 'DRIVE_HTTP_403'],
    [500, 'other', 'GOOGLE_SERVICE_UNAVAILABLE']]) await t.test(String(status) + '-' + error, async () => {
    const h = oauthHarness({ envelope: fakeEnvelope() }), previous = structuredClone(h.store.value);
    h.auth.failure = providerFailure(status, error);
    await assert.rejects(authorizeDesktop(h), err => err.message === expected && !JSON.stringify(err).includes('SYNTHETIC-PRIVATE'));
    assert.deepEqual(h.store.value, previous); assert.equal(h.closed, 1); assert.equal(h.store.saves, 0);
  });
  assert.equal(safeDriveError(new Error('SYNTHETIC-PRIVATE')).code, 'DRIVE_OPERATION_FAILED');
});

test('A07 — resposta sem refresh token, escopo ausente/ampliado e acesso expirado são recusados', async t => {
  for (const [name, override, code] of [['refresh', { refresh_token: undefined }, 'OAUTH_REFRESH_TOKEN_REQUIRED'],
    ['scope-missing', { scope: undefined }, 'OAUTH_SCOPE_REJECTED'],
    ['scope-expanded', { scope: DRIVE_SCOPE + ' https://www.googleapis.com/auth/drive.readonly' }, 'OAUTH_SCOPE_REJECTED'],
    ['expired', { expiry_date: OAUTH_NOW }, 'OAUTH_ACCESS_TOKEN_EXPIRED'],
    ['refresh-expiry', { refresh_token_expires_in: -1 }, 'OAUTH_TOKEN_RESPONSE_INVALID']]) await t.test(name, async () => {
    const h = oauthHarness(); h.auth.result = fakeTokens(override);
    await assert.rejects(authorizeDesktop(h), { code }); assert.equal(h.store.saves, 0); assert.equal(h.closed, 1);
  });
});

test('A08 — access token expirado renova sem login e sem prolongar sete dias', async () => {
  const h = oauthHarness({ envelope: fakeEnvelope({ expiry_date: OAUTH_NOW + 1 }) });
  const expiry = h.store.value.refreshTokenExpiresAt;
  await authorizedSession({ ...h, now: () => OAUTH_NOW + 2 });
  assert.equal(h.auth.refreshes, 1); assert.equal(h.store.saves, 1);
  assert.equal(h.store.value.refreshTokenExpiresAt, expiry); assert.equal(h.store.value.authorizedAt, OAUTH_NOW);
  assert.equal(h.store.value.tokens.access_token, 'SYNTHETIC-REFRESHED-NOT-REAL'); assert.equal(h.opened, 0);
});

test('A09 — sete dias vencidos, revogação e falta de autorização não iniciam OAuth', async t => {
  await t.test('Testing expirado', async () => {
    const h = oauthHarness({ envelope: fakeEnvelope() });
    await assert.rejects(authorizedSession({ ...h, now: () => OAUTH_NOW + TESTING_REFRESH_TTL_MS }), { code: 'OAUTH_TESTING_REFRESH_EXPIRED' });
    assert.equal(h.auth.refreshes, 0); assert.equal(h.opened, 0);
  });
  await t.test('refresh revogado', async () => {
    const h = oauthHarness({ envelope: fakeEnvelope({ expiry_date: OAUTH_NOW - 1 }) });
    h.auth.failure = providerFailure(400, 'invalid_grant'); const previous = structuredClone(h.store.value);
    await assert.rejects(authorizedSession(h), { code: 'OAUTH_REAUTHORIZATION_REQUIRED' });
    assert.deepEqual(h.store.value, previous); assert.equal(h.store.saves, 0); assert.equal(h.opened, 0);
  });
  await t.test('sem token local', async () => {
    const h = oauthHarness(); await assert.rejects(authorizedSession(h), { code: 'OAUTH_AUTHORIZATION_REQUIRED' });
    assert.equal(h.opened, 0); assert.equal(h.callbacks, 0);
  });
});

test('A10 — vínculo de cliente e integridade do prazo/escopo persistido são obrigatórios', async t => {
  for (const condition of ['client', 'scope', 'deadline', 'future']) await t.test(condition, () => {
    const envelope = fakeEnvelope();
    const credentials = { ...FAKE_CREDENTIALS };
    if (condition === 'client') credentials.client_id = 'another.apps.googleusercontent.com';
    if (condition === 'scope') envelope.tokens.scope = 'https://www.googleapis.com/auth/drive';
    if (condition === 'deadline') envelope.refreshTokenExpiresAt++;
    if (condition === 'future') envelope.authorizedAt++;
    assert.throws(() => validateTokenEnvelope(envelope, { credentials, now: OAUTH_NOW }));
  });
});

test('A11 — revogar aceita token local vencido e só limpa após confirmação remota', async () => {
  const h = oauthHarness({ envelope: fakeEnvelope() });
  const result = await revokeDesktop({ ...h, now: () => OAUTH_NOW + TESTING_REFRESH_TTL_MS });
  assert.equal(h.auth.revocations.length, 1); assert.equal(h.store.removes, 1); assert.equal(result.publicationChanged, false);
  const failing = oauthHarness({ envelope: fakeEnvelope() }); failing.auth.failure = providerFailure(500);
  await assert.rejects(revokeDesktop(failing), { code: 'GOOGLE_SERVICE_UNAVAILABLE' });
  assert.equal(failing.store.removes, 0); assert.ok(failing.store.value);
});

test('A12 — validação de URL recusa segredo e escopos extras antes de abrir navegador', () => {
  const h = oauthHarness(), params = { state: 's'.repeat(43), redirectUri: 'http://127.0.0.1:1234/oauth2/callback', codeChallenge: 'challenge', clientId: FAKE_CREDENTIALS.client_id };
  const url = h.auth.generateAuthUrl({ state: params.state, redirect_uri: params.redirectUri, scope: [DRIVE_SCOPE],
    response_type: 'code', access_type: 'offline', code_challenge_method: 'S256', code_challenge: params.codeChallenge });
  validateAuthorizationUrl(url, params);
  assert.throws(() => validateAuthorizationUrl(url + '&client_secret=SYNTHETIC', params), { code: 'OAUTH_AUTHORIZATION_URL_REJECTED' });
  assert.throws(() => validateAuthorizationUrl(url.replace('S256', 'plain'), params), { code: 'OAUTH_AUTHORIZATION_URL_REJECTED' });
});

test('A13 — troca pelo SDK oficial usa transporte simulado com PKCE e limite sem retry', async t => {
  t.mock.method(https, 'request', () => { throw new Error('NETWORK_FORBIDDEN'); });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('NETWORK_FORBIDDEN'); });
  const sdk = await loadGoogleSdk(), auth = sdk.oauth(FAKE_CREDENTIALS);
  let calls = 0;
  auth.transporter.defaults.adapter = async options => {
    calls++;
    assert.equal(new URL(options.url).origin, 'https://oauth2.googleapis.com');
    assert.equal(options.retry, false); assert.equal(options.timeout, 15000);
    const body = new URLSearchParams(options.data);
    assert.equal(body.get('code_verifier'), 'v'.repeat(64)); assert.equal(body.get('grant_type'), 'authorization_code');
    return { config: options, status: 200, statusText: 'OK', headers: new Headers(), data: fakeTokens() };
  };
  const response = await auth.getToken({ code: 'SYNTHETIC-CODE-NOT-REAL', codeVerifier: 'v'.repeat(64),
    redirect_uri: 'http://127.0.0.1:34567/oauth2/callback' });
  assert.equal(response.tokens.scope, DRIVE_SCOPE); assert.equal(calls, 1);
});
