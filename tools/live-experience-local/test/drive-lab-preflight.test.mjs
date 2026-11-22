import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { DRIVE_SCOPE, loadGoogleSdk } from '../src/drive-auth.mjs';
import { DriveError, DriveTokenStore, REPOSITORY, TOKEN_FILENAME } from '../src/drive-token-store.mjs';
import { LAB_FOLDER_MIME, LAB_METADATA_FIELDS, LAB_TAG } from '../src/drive-lab.mjs';
import { FAKE_CREDENTIALS, fakeEnvelope, OAUTH_NOW, MemoryTokenStore, providerFailure } from './drive-oauth-fixtures.mjs';
import { ACCESS_MARGIN_MS, accessOnlyClient, parsePreflightArguments, runPreflightCommand, main } from '../src/drive-lab-preflight.mjs';
const execFileAsync = promisify(execFile);
const forbidden = () => { throw new Error('SYNTHETIC_EFFECT_FORBIDDEN'); };

function fixture() {
  const h = { now: OAUTH_NOW, calls: [], interceptors: [], store: new MemoryTokenStore(fakeEnvelope()), sdkLoads: 0,
    credentials: { ...FAKE_CREDENTIALS }, env: { LEVEL_DRIVE_LAB_PREFLIGHT_CONFIRMED: 'true' } };
  h.auth = { credentials: {}, setCredentials(value) { this.credentials = { ...value }; },
    getRequestHeaders: async () => { if (h.authFailure) throw h.authFailure; return new Headers(); },
    transporter: { interceptors: { request: { add: interceptor => h.interceptors.push(interceptor) } } } };
  const invoke = async (stage, params, options) => {
    h.calls.push({ stage, params, options });
    if (h.failureStage === stage) {
      if (h.timeout) return new Promise(() => {});
      throw providerFailure(h.status ?? 404);
    }
    if (h.changeClockAt === stage) h.now += 3600000;
    const data = stage === 'ROOT_GET' ? { id: 'synthetic-private-root', mimeType: LAB_FOLDER_MIME } :
      stage === 'ROOT_PERMISSIONS' ? { permissions: [{ id: 'synthetic-private-owner', type: 'user', role: 'owner' }] } :
      { files: [], incompleteSearch: false };
    return h.responseOverride?.(stage, data) ?? { status: 200, data };
  };
  h.sdk = { oauth: (...args) => { assert.equal(args.length, 0); return h.auth; }, drive: () => ({
    files: { get: (p, o) => invoke('ROOT_GET', p, o), list: (p, o) => invoke('LAB_LIST', p, o), create: forbidden },
    permissions: { list: (p, o) => invoke('ROOT_PERMISSIONS', p, o), create: forbidden } }) };
  h.injected = { now: () => h.now, loadCredentials: async () => h.credentials, makeTokenStore: () => h.store,
    loadSdk: async () => { h.sdkLoads++; return h.sdk; } };
  h.run = extra => runPreflightCommand({ execute: true, env: h.env }, { ...h.injected, ...extra });
  return h;
}

test('F01 — dry-run antecede ambiente, arquivos, SDK, rede, sockets e escrita', async t => {
  for (const key of ['open', 'readFile', 'writeFile', 'lstat', 'stat', 'readdir', 'mkdir', 'unlink', 'rename']) t.mock.method(fs, key, forbidden);
  for (const [target, key] of [[http, 'request'], [https, 'request'], [http, 'createServer'], [net, 'connect'], [net, 'createServer'], [globalThis, 'fetch']]) t.mock.method(target, key, forbidden);
  for (const args of [[], ['--dry-run']]) {
    const result = await runPreflightCommand({ ...parsePreflightArguments(args), env: new Proxy({}, { get: forbidden }) },
      { loadCredentials: forbidden, makeTokenStore: forbidden, loadSdk: forbidden });
    assert.equal(result.mode, 'DRY_RUN'); assert.equal(result.googleContacted, false); assert.equal(result.localWrites, false);
    assert.equal(result.scope, DRIVE_SCOPE); assert.equal(result.creationAllowed, false);
  }
});

test('F02 — sucesso: somente três GETs de dados, ordem e campos originais, sem acesso ao estado', async t => {
  const h = fixture(); h.store.save = forbidden; h.store.remove = forbidden;
  for (const key of ['open', 'writeFile', 'rename', 'unlink', 'mkdir']) t.mock.method(fs, key, forbidden);
  for (const [target, key] of [[https, 'request'], [http, 'request'], [net, 'connect'], [globalThis, 'fetch']]) t.mock.method(target, key, forbidden);
  const result = await h.run(); assert.equal(result.code, 'PREFLIGHT_READS_COMPLETED');
  assert.deepEqual(h.calls.map(c => c.stage), ['ROOT_GET', 'ROOT_PERMISSIONS', 'LAB_LIST']);
  assert.deepEqual(h.calls[0].params, { fileId: 'root', fields: LAB_METADATA_FIELDS });
  assert.equal(h.calls[1].params.fileId, 'synthetic-private-root');
  assert.equal(h.calls[2].params.q, "trashed = false and appProperties has { key='levelXVIIILab' and value='" + LAB_TAG + "' }");
  for (const call of h.calls) { assert.equal(call.options.retry, false); assert.equal(call.options.timeout, 15000); }
  assert.deepEqual(Object.keys(h.auth.credentials), ['access_token', 'expiry_date', 'token_type']);
  assert.equal(h.auth.forceRefreshOnFailure, false); assert.equal(h.store.saves, 0);
});

test('F03 — HTTP em cada etapa interrompe a sequência sem retry ou detalhes privados', async t => {
  for (const stage of ['AUTH', 'ROOT_GET', 'ROOT_PERMISSIONS', 'LAB_LIST']) for (const status of [401, 403, 404, 429, 503]) {
    await t.test(stage + '-' + status, async () => {
      const h = fixture(); if (stage === 'AUTH') h.authFailure = providerFailure(status); else { h.failureStage = stage; h.status = status; }
      const result = await h.run(); assert.equal(result.mode, 'BLOCKED'); assert.equal(result.stage, stage);
      assert.equal(result.code, status === 503 ? 'GOOGLE_SERVICE_UNAVAILABLE' : 'DRIVE_HTTP_' + status);
      assert.equal(h.calls.length, ['AUTH', 'ROOT_GET', 'ROOT_PERMISSIONS', 'LAB_LIST'].indexOf(stage));
      assert.equal(h.store.saves, 0); assert.ok(!JSON.stringify(result).includes('SYNTHETIC-PRIVATE'));
    });
  }
});

test('F04 — autenticação vencida, margem insuficiente, cliente/grant/scope inválidos bloqueiam antes do SDK', async t => {
  for (const scenario of ['expired-access', 'near-expiry', 'expired-grant', 'client', 'scope', 'missing', 'invalid-token']) await t.test(scenario, async () => {
    const h = fixture();
    if (scenario === 'expired-access') h.store.value.tokens.expiry_date = h.now - 1;
    if (scenario === 'near-expiry') h.store.value.tokens.expiry_date = h.now + ACCESS_MARGIN_MS;
    if (scenario === 'expired-grant') h.store.value.refreshTokenExpiresAt = h.now;
    if (scenario === 'client') h.credentials.client_id = 'synthetic-other.apps.googleusercontent.com';
    if (scenario === 'scope') h.store.value.tokens.scope += ' https://www.googleapis.com/auth/drive';
    if (scenario === 'missing') h.store.value = null;
    if (scenario === 'invalid-token') h.store.value.tokens.access_token = '';
    const result = await h.run(); assert.equal(result.mode, 'BLOCKED'); assert.equal(result.stage, 'AUTH');
    assert.equal(h.calls.length, 0); assert.equal(h.sdkLoads, 0); assert.equal(h.store.saves, 0);
  });
});

test('F05 — timeout em cada consulta aborta e não avança nem repete', async t => {
  for (const stage of ['ROOT_GET', 'ROOT_PERMISSIONS', 'LAB_LIST']) await t.test(stage, async () => {
    const h = fixture(); h.failureStage = stage; h.timeout = true;
    const result = await h.run({ timeoutMs: 10 }); assert.equal(result.stage, stage); assert.equal(result.code, 'TIMEOUT');
    assert.equal(h.calls.at(-1).options.signal.aborted, true);
    assert.equal(h.calls.length, ['ROOT_GET', 'ROOT_PERMISSIONS', 'LAB_LIST'].indexOf(stage) + 1);
  });
});

test('F06 — respostas incompletas, páginas adicionais e listas ambíguas bloqueiam na própria etapa', async t => {
  for (const stage of ['ROOT_GET', 'ROOT_PERMISSIONS', 'LAB_LIST']) for (const scenario of ['missing', 'partial', 'pagination']) await t.test(stage + '-' + scenario, async () => {
    const h = fixture(); h.responseOverride = (current, data) => {
      if (current !== stage) return;
      if (scenario === 'missing') return { status: 200 };
      if (scenario === 'partial') return { status: 200, data: {} };
      if (stage === 'ROOT_GET') return { status: 200, data: { ...data, parents: ['synthetic-editorial'] } };
      return { status: 200, data: { ...data, nextPageToken: 'synthetic-private-page' } };
    };
    const result = await h.run(); assert.equal(result.stage, stage); assert.equal(result.code, 'INCOMPLETE_RESPONSE');
    assert.equal(h.calls.length, ['ROOT_GET', 'ROOT_PERMISSIONS', 'LAB_LIST'].indexOf(stage) + 1);
  });
});

test('F07 — expiração durante o preflight bloqueia a chamada seguinte sem renovar', async () => {
  const h = fixture(); h.changeClockAt = 'ROOT_GET'; const result = await h.run();
  assert.equal(result.stage, 'ROOT_PERMISSIONS'); assert.equal(result.code, 'ACCESS_TOKEN_NOT_USABLE');
  assert.equal(h.calls.length, 1); assert.equal(h.store.saves, 0);
});

test('F08 — guarda de transporte recusa token endpoint, POST, mídia e destino externo', async t => {
  for (const options of [{ url: 'https://oauth2.googleapis.com/token', method: 'POST' },
    { url: 'https://www.googleapis.com/drive/v3/files', method: 'POST' },
    { url: 'https://www.googleapis.com/drive/v3/files/root?alt=media' }, { url: 'https://example.invalid/drive/v3/files' }]) {
    await t.test(options.method ?? options.url, async () => {
      const h = fixture(); await h.run();
      await assert.rejects(h.interceptors[0].resolved(options), { code: 'TRANSPORT_FORBIDDEN' });
    });
  }
  const h = fixture(); await h.run(); const options = await h.interceptors[0].resolved({ url: 'https://www.googleapis.com/drive/v3/files/root', retry: true });
  assert.equal(options.retry, false); assert.equal(options.timeout, 15000);
});

test('F09 — SDK oficial: access-only, expiração e HTTP não renovam, não repetem nem persistem', async t => {
  t.mock.method(https, 'request', forbidden); t.mock.method(globalThis, 'fetch', forbidden);
  const sdk = await loadGoogleSdk();
  for (const status of [401, 403, 404, 429, 503]) await t.test(String(status), async () => {
    const testNow = Date.now();
    const envelope = fakeEnvelope(); envelope.tokens.expiry_date = testNow + 3600000;
    envelope.refreshTokenExpiresAt = testNow + 24 * 3600000;
    const s = accessOnlyClient(sdk, envelope, () => testNow); let calls = 0;
    assert.equal(s.auth.credentials.refresh_token, undefined); assert.equal(s.auth._clientSecret, undefined);
    s.auth.transporter.request = async options => { calls++; assert.equal(options.retry, false); throw providerFailure(status); };
    await assert.rejects(s.client.files.get({ fileId: 'root', fields: LAB_METADATA_FIELDS }, { retry: false })); assert.equal(calls, 1);
    s.auth.credentials.expiry_date = Date.now() - 1;
    await assert.rejects(s.auth.getRequestHeaders(), { code: 'REFRESH_FORBIDDEN' }); assert.equal(calls, 1);
  });
});

test('F10 — CLI usa códigos fixos, flags estritas e nunca ecoa exceções/IDs/hashes/segredos', async () => {
  const h = fixture(), out = [], sink = { log: v => out.push(v), error: v => out.push(v) };
  assert.equal(await main(['--execute'], h.env, sink, h.injected), 0); // Synthetic dispatch only.
  for (const args of [['--scope=drive'], ['--execute', '--dry-run'], ['--execute', '--execute']]) assert.equal(await main(args, {}, sink), 1);
  const injected = { ...h.injected, loadCredentials: async () => { throw new DriveError('PRIVATE_' + FAKE_CREDENTIALS.client_secret); } };
  assert.equal(await main(['--execute'], h.env, sink, injected), 1);
  for (const value of [FAKE_CREDENTIALS.client_id, FAKE_CREDENTIALS.client_secret, h.store.value.tokens.access_token,
    h.store.value.tokens.refresh_token, h.store.value.clientBinding, 'synthetic-private-root', 'synthetic-private-owner']) {
    assert.ok(!out.join('').includes(value)); assert.ok(!out.join('').includes(createHash('sha256').update(value).digest('hex')));
  }
  const quiet = fixture(); delete quiet.env.LEVEL_DRIVE_LAB_PREFLIGHT_CONFIRMED;
  const result = await quiet.run({ loadCredentials: forbidden }); assert.equal(result.stage, 'CONFIG'); assert.equal(result.mode, 'BLOCKED');
});

const textExtensions = new Set(['.js', '.mjs', '.json', '.html', '.css', '.md', '.svg', '.webmanifest']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// Replace only CRLF bytes; preserve BOMs, lone CRs, whitespace and the final newline.
const normalizeLineEndings = bytes => Buffer.from(bytes.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

function assertPreservedFile(name, actual, baseline, expected) {
  const actualHash = sha256(actual);
  if (actualHash === expected) return;
  const text = (textExtensions.has(path.extname(name)) || path.basename(name) === '.gitignore') &&
    [actual, baseline].every(bytes => isUtf8(bytes) && !bytes.includes(0));
  if (!text) { assert.equal(actualHash, expected, name); return; }
  const normalizedBaseline = normalizeLineEndings(baseline);
  const crlfBaseline = Buffer.from(normalizedBaseline.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
  // Keep the recorded hash as an independent anchor, including baselines captured on Windows.
  assert.ok([baseline, normalizedBaseline, crlfBaseline].some(bytes => sha256(bytes) === expected), name + ': baseline');
  assert.equal(sha256(normalizeLineEndings(actual)), sha256(normalizedBaseline), name);
}

test('F11 — baseline preservado com alterações aprovadas em e46025a', async t => {
  await t.test('texto aceita LF/CRLF, inclusive mistos e hashes registrados em CRLF', () => {
    const lf = Buffer.from('ação\nsegunda linha\n'), crlf = Buffer.from('ação\r\nsegunda linha\r\n');
    for (const baseline of [lf, crlf]) for (const actual of [lf, crlf, Buffer.from('ação\r\nsegunda linha\n')]) {
      for (const expected of [sha256(lf), sha256(crlf)]) assertPreservedFile('fixture.js', actual, baseline, expected);
    }
  });
  await t.test('conteúdo, espaços, BOM, CR isolado e quebra final continuam protegidos', () => {
    const baseline = Buffer.from('ação\n');
    for (const changed of ['outra ação\r\n', 'ação \r\n', '\uFEFFação\r\n', 'ação\r', 'ação']) {
      assert.throws(() => assertPreservedFile('fixture.html', Buffer.from(changed), baseline, sha256(baseline)), { code: 'ERR_ASSERTION' });
    }
  });
  await t.test('hash registrado divergente não é substituído pelo conteúdo do commit', () => {
    assert.throws(() => assertPreservedFile('fixture.md', Buffer.from('original\r\n'), Buffer.from('original\n'),
      sha256(Buffer.from('outro conteúdo\n'))), { code: 'ERR_ASSERTION' });
  });
  await t.test('binários, extensões desconhecidas, NUL e UTF-8 inválido exigem bytes exatos', () => {
    for (const [name, baseline] of [['fixture.png', Buffer.from([0x89, 0x50, 0, 13, 10])],
      ['fixture.png', Buffer.from('ASCII\r\n')], ['fixture.bin', Buffer.from('ASCII\r\n')],
      ['fixture.js', Buffer.from([0, 13, 10])], ['fixture.js', Buffer.from([0xff, 13, 10])]]) {
      assertPreservedFile(name, Buffer.from(baseline), baseline, sha256(baseline));
      assert.throws(() => assertPreservedFile(name, normalizeLineEndings(baseline), baseline, sha256(baseline)), { code: 'ERR_ASSERTION' });
      const changed = Buffer.from(baseline); changed[0] ^= 1;
      assert.throws(() => assertPreservedFile(name, changed, baseline, sha256(baseline)), { code: 'ERR_ASSERTION' });
    }
  });
  const approvedChanges = new Set(['app.js', 'index.html']);
  const allowed = new Set(['tools/live-experience-local/package.json', 'tools/live-experience-local/README.md', 'tools/live-experience-local/GOOGLE_DRIVE_LAB.md']);
  const recorded = JSON.parse(await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/test/preservation-baseline.json'), 'utf8')).files;
  const names = (await execFileAsync('git', ['ls-tree', '-r', '--name-only', '-z', 'd5b63e7'], { cwd: REPOSITORY })).stdout;
  for (const name of names.split('\0').filter(Boolean)) {
    if (allowed.has(name)) continue;
    const reference = approvedChanges.has(name) ? 'e46025a:' : 'd5b63e7:';
    const baseline = await execFileAsync('git', ['show', reference + name], { cwd: REPOSITORY, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    const baselineHash = createHash('sha256').update(baseline.stdout).digest('hex');
    const expected = approvedChanges.has(name) ? baselineHash : (recorded[name] ?? baselineHash);
    assertPreservedFile(name, await fs.readFile(path.join(REPOSITORY, name)), baseline.stdout, expected);
  }
  const current = JSON.parse(await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/package.json'), 'utf8'));
  delete current.scripts['drive:lab-preflight'];
  assert.deepEqual(current, JSON.parse((await execFileAsync('git', ['show', 'd5b63e7:tools/live-experience-local/package.json'], { cwd: REPOSITORY })).stdout));
});

test('F12 — filesystem temporário privado: credenciais/tokens somente O_RDONLY; sentinelas de estado intactas', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-preflight-test-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('level-xviii-preflight-test-')); await fs.rm(root, { recursive: true, force: true }); });
  if (process.platform === 'win32') {
    const script = ["$ErrorActionPreference='Stop'", '$p=$env:LEVEL_PREFLIGHT_TEST_SCRATCH',
      '$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User', '$acl=New-Object System.Security.AccessControl.DirectorySecurity',
      '$acl.SetOwner($me)', '$acl.SetAccessRuleProtection($true,$false)',
      "$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))",
      'Set-Acl -LiteralPath $p -AclObject $acl'].join(';');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true,
      env: { ...process.env, LEVEL_PREFLIGHT_TEST_SCRATCH: root }, timeout: 10000 });
  } else await fs.chmod(root, 0o700);
  const tokens = path.join(root, 'tokens'); await fs.mkdir(tokens, { mode: 0o700 });
  const credentialFile = path.join(root, 'synthetic-desktop.json'), tokenFile = path.join(tokens, TOKEN_FILENAME), stateFile = path.join(root, 'synthetic-state-sentinel');
  await fs.writeFile(credentialFile, JSON.stringify({ installed: { ...FAKE_CREDENTIALS,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token' } }), { mode: 0o600 });
  await fs.writeFile(tokenFile, JSON.stringify(fakeEnvelope()), { mode: 0o600 }); await fs.writeFile(stateFile, 'SYNTHETIC-STATE', { mode: 0o600 });
  const names = [credentialFile, tokenFile, stateFile], before = await Promise.all(names.map(f => fs.readFile(f)));
  const h = fixture(); h.env.LEVEL_DRIVE_CREDENTIALS_FILE = credentialFile; h.env.LEVEL_DRIVE_TOKEN_DIR = tokens;
  const originalOpen = fs.open.bind(fs), opened = [];
  const openMock = t.mock.method(fs, 'open', async (filename, flags, ...rest) => {
    assert.ok([credentialFile, tokenFile].includes(filename)); assert.equal(flags, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    opened.push(filename); const handle = await originalOpen(filename, flags, ...rest); handle.writeFile = forbidden; return handle;
  });
  const mocks = ['writeFile', 'appendFile', 'rename', 'unlink', 'mkdir', 'rm', 'chmod'].map(key => t.mock.method(fs, key, forbidden));
  for (const key of ['save', 'remove']) mocks.push(t.mock.method(DriveTokenStore.prototype, key, forbidden));
  const result = await h.run({ loadCredentials: undefined, makeTokenStore: undefined });
  openMock.mock.restore(); for (const mock of mocks) mock.mock.restore();
  assert.equal(result.code, 'PREFLIGHT_READS_COMPLETED'); assert.deepEqual(opened, [credentialFile, tokenFile]);
  assert.deepEqual(await Promise.all(names.map(f => fs.readFile(f))), before);
});

test('F13 — SDK e fetch instalados: 3xx bloqueado antes de uma segunda requisição', async t => {
  // Keep Gaxios, its interceptors and node-fetch real; replace only the socket-facing requests.
  t.mock.method(globalThis, 'fetch', forbidden); t.mock.method(net, 'connect', forbidden);
  const sdk = await loadGoogleSdk();
  let calls = [], status = 302, location = 'https://example.invalid/redirected';
  const initial = 'https://www.googleapis.com/drive/v3/files/root';
  const send = (url, options) => {
    calls.push({ url: String(url), method: options.method });
    const request = new EventEmitter();
    request.abort = () => {};
    request.setTimeout = () => request;
    request.end = () => queueMicrotask(() => {
      const response = new PassThrough();
      const redirected = calls.length > 1;
      response.statusCode = redirected ? 200 : status;
      response.headers = { 'content-type': 'application/json', ...(redirected ? {} : { location }) };
      response.rawHeaders = Object.entries(response.headers).flat();
      request.emit('response', response); response.end('{}');
    });
    return request;
  };
  t.mock.method(https, 'request', send); t.mock.method(http, 'request', send);
  await t.test('controle: transporte sem a guarda segue o redirect simulado', async () => {
    const auth = sdk.oauth();
    const result = await auth.transporter.request({ url: initial, retry: false });
    assert.equal(result.status, 200);
    assert.deepEqual(calls.map(call => call.url), [initial, location]);
  });
  for (const code of [301, 302, 303, 307, 308]) for (const target of [
    'https://example.invalid/redirected', 'https://www.googleapis.com/drive/v3/files/root?alt=media'
  ]) await t.test(String(code) + (target.includes('alt=media') ? '-media' : '-external'), async () => {
    calls = []; status = code; location = target;
    const h = fixture();
    h.now = Date.now(); h.store.value.authorizedAt = h.now;
    h.store.value.tokens.expiry_date = h.now + 3600000;
    h.store.value.refreshTokenExpiresAt = h.now + 86400000;
    h.store.save = forbidden; h.store.remove = forbidden;
    const result = await h.run({ loadSdk: async () => sdk });
    assert.equal(result.mode, 'BLOCKED'); assert.equal(result.stage, 'ROOT_GET');
    assert.equal(result.code, 'VALIDATION_OR_ACCESS_FAILED');
    assert.equal(result.localWrites, false); assert.equal(h.store.saves, 0);
    assert.equal(calls.length, 1); assert.equal(calls[0].method, 'GET');
    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, initial);
    assert.equal(url.searchParams.has('alt'), false);
    assert.ok(!JSON.stringify(result).includes(target));
  });
});
