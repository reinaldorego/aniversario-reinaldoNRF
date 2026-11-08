import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { DriveTokenStore, TOKEN_FILENAME, REPOSITORY, readPrivateJson, validateExternalPath, assertQuietRuntime } from '../src/drive-token-store.mjs';
import { createLoopbackCallback, parseOAuthCallback, loadDesktopCredentials } from '../src/drive-auth.mjs';
import { DRIVE_COMMANDS, parseDriveArguments, runDriveCommand, main } from '../src/drive-cli.mjs';
import { fakeEnvelope, FAKE_CREDENTIALS, oauthHarness } from './drive-oauth-fixtures.mjs';

const execFileAsync = promisify(execFile);
async function privateScratch(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-oauth-test-'));
  if (process.platform === 'win32') {
    const script = [
      "$ErrorActionPreference='Stop'", "$p=$env:LEVEL_OAUTH_TEST_SCRATCH", "$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User",
      '$acl=New-Object System.Security.AccessControl.DirectorySecurity', '$acl.SetOwner($me)', '$acl.SetAccessRuleProtection($true,$false)',
      "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
      '$acl.AddAccessRule($rule)', 'Set-Acl -LiteralPath $p -AclObject $acl'
    ].join(';');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env: { ...process.env, LEVEL_OAUTH_TEST_SCRATCH: root }, timeout: 10000 });
  } else await fs.chmod(root, 0o700);
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('level-xviii-oauth-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}
const callbackRequest = (state, extra = {}) => ({ remoteAddress: '127.0.0.1', host: '127.0.0.1:12345', method: 'GET',
  url: '/oauth2/callback?state=' + state + '&code=SYNTHETIC-NOT-AN-OAUTH-CODE', ...extra });
const loopbackGet = (uri, headers = {}) => new Promise((resolve, reject) => {
  http.get(uri, { headers }, response => {
    let body = ''; response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
  }).on('error', reject);
});

test('S01 — todos os comandos dry-run impedem filesystem, segredos, SDK, sockets, rede e navegador', async t => {
  const forbidden = () => { throw new Error('SIDE_EFFECT_FORBIDDEN'); };
  for (const method of ['open', 'readFile', 'writeFile', 'lstat', 'realpath', 'mkdir', 'unlink', 'rename']) t.mock.method(fs, method, forbidden);
  t.mock.method(http, 'createServer', forbidden); t.mock.method(https, 'request', forbidden); t.mock.method(globalThis, 'fetch', forbidden);
  const effects = Object.fromEntries(['makeStore', 'inspect', 'permissions', 'loadSdk', 'loadCredentials', 'loadManifest', 'callbackFactory', 'browser'].map(key => [key, forbidden]));
  for (const command of DRIVE_COMMANDS) {
    const env = { LEVEL_DRIVE_CREDENTIALS_FILE: 'SYNTHETIC-PRIVATE-PATH', LEVEL_DRIVE_TOKEN_DIR: 'SYNTHETIC-PRIVATE-DIR',
      LEVEL_DRIVE_TEST_MANIFEST: 'SYNTHETIC-PRIVATE-MANIFEST' };
    const result = await runDriveCommand({ command, env }, effects);
    assert.equal(result.mode, 'DRY_RUN'); assert.equal(result.effects, 'NONE'); assert.equal(result.publicationChanged, false);
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC-PRIVATE'));
    assert.deepEqual(parseDriveArguments([command]), { command, execute: false });
    assert.deepEqual(parseDriveArguments([command, '--dry-run']), { command, execute: false });
    assert.deepEqual(parseDriveArguments([command, '--execute']), { command, execute: true });
  }
});

test('S02 — argumentos ambíguos, escopos/URLs por CLI e mensagens privadas não vazam na saída', async () => {
  for (const args of [[], ['unknown'], ['authorize', '--scope=drive'], ['authorize', '--execute', '--dry-run'],
    ['authorize', '--url=https://example.invalid/?code=SYNTHETIC-PRIVATE']]) {
    const output = []; const exit = await main(args, {}, { log: value => output.push(value), error: value => output.push(value) });
    assert.equal(exit, 1); assert.ok(!output.join('').includes('SYNTHETIC-PRIVATE')); assert.ok(!output.join('').includes('https://'));
  }
});

test('S03 — diagnóstico executado só inspeciona metadados; limpeza local não carrega SDK nem credenciais', async () => {
  const h = oauthHarness({ envelope: fakeEnvelope() }); let inspected = 0, permissions = 0;
  const forbidden = () => { throw new Error('OAUTH_OR_SECRET_READ_FORBIDDEN'); };
  const result = await runDriveCommand({ command: 'diagnose', execute: true, env: {} }, {
    makeStore: () => h.store, inspect: async () => { inspected++; return { filename: path.join(os.tmpdir(), 'synthetic.json') }; },
    permissions: async () => { permissions++; }, loadSdk: forbidden, loadCredentials: forbidden, browser: forbidden, callbackFactory: forbidden
  });
  assert.equal(inspected, 1); assert.equal(permissions, 2); assert.equal(result.oauthStarted, false); assert.equal(result.networkUsed, false);
  const clean = await runDriveCommand({ command: 'clean-local', execute: true, env: {} },
    { makeStore: () => h.store, loadSdk: forbidden, loadCredentials: forbidden });
  assert.equal(h.store.removes, 1); assert.equal(clean.remoteRevocation, 'NOT_PERFORMED');
});

test('S04 — callback exige IPv4 loopback, Host/rota/método corretos, state e parâmetros únicos', async t => {
  const state = 's'.repeat(43);
  assert.equal(parseOAuthCallback(callbackRequest(state), { port: 12345, state }), 'SYNTHETIC-NOT-AN-OAUTH-CODE');
  const invalid = [
    ['remote', { remoteAddress: '192.0.2.1' }], ['ipv6', { remoteAddress: '::1' }], ['host', { host: 'localhost:12345' }],
    ['origin', { origin: 'https://example.invalid' }], ['method', { method: 'POST' }], ['path', { url: '/wrong?state=' + state }],
    ['state-missing', { url: '/oauth2/callback?code=SYNTHETIC' }], ['state-wrong', { url: '/oauth2/callback?state=' + 'x'.repeat(43) + '&code=SYNTHETIC' }],
    ['state-duplicate', { url: callbackRequest(state).url + '&state=' + state }], ['code-duplicate', { url: callbackRequest(state).url + '&code=SYNTHETIC' }],
    ['absolute-url', { url: 'http://example.invalid/oauth2/callback?state=' + state }], ['fragment', { url: callbackRequest(state).url + '#extra' }],
    ['code-missing', { url: '/oauth2/callback?state=' + state }], ['code-and-error', { url: callbackRequest(state).url + '&error=access_denied' }]
  ];
  for (const [name, override] of invalid) await t.test(name, () => {
    assert.throws(() => parseOAuthCallback(callbackRequest(state, override), { port: 12345, state }));
  });
  assert.throws(() => parseOAuthCallback(callbackRequest(state, { url: '/oauth2/callback?state=' + state + '&error=access_denied' }), { port: 12345, state }),
    { code: 'OAUTH_CONSENT_DENIED' });
});

test('S05 — servidor real apenas loopback aceita callback uma vez, rejeita state incorreto e não reflete dados', async () => {
  const state = 's'.repeat(43), callback = await createLoopbackCallback({ state, timeoutMs: 5000 });
  try {
    assert.equal(new URL(callback.redirectUri).hostname, '127.0.0.1');
    const bad = await loopbackGet(callback.redirectUri + '?state=' + 'x'.repeat(43) + '&code=SYNTHETIC-PRIVATE');
    assert.equal(bad.status, 400); assert.ok(!bad.body.includes('SYNTHETIC-PRIVATE'));
    const host = await loopbackGet(callback.redirectUri + '?state=' + state + '&code=SYNTHETIC', { Host: 'example.invalid' });
    assert.equal(host.status, 400);
    const good = await loopbackGet(callback.redirectUri + '?state=' + state + '&code=SYNTHETIC-PRIVATE');
    assert.equal(good.status, 200); assert.equal(await callback.code, 'SYNTHETIC-PRIVATE');
    assert.equal(good.headers['cache-control'], 'no-store'); assert.equal(good.headers['referrer-policy'], 'no-referrer');
    assert.ok(!good.body.includes(state)); assert.ok(!good.body.includes('SYNTHETIC-PRIVATE'));
    assert.equal((await loopbackGet(callback.redirectUri + '?state=' + state + '&code=SYNTHETIC-REPLAY')).status, 400);
  } finally { await callback.close(); }
});

test('S06 — callback vence, fecha e trata recusa sem código OAuth', async () => {
  const state = 's'.repeat(43), expired = await createLoopbackCallback({ state, timeoutMs: 15 });
  await assert.rejects(expired.code, { code: 'OAUTH_CALLBACK_TIMEOUT' }); await expired.close();
  const denied = await createLoopbackCallback({ state });
  try {
    const response = await loopbackGet(denied.redirectUri + '?state=' + state + '&error=access_denied&error_description=SYNTHETIC-PRIVATE');
    assert.equal(response.status, 400); assert.ok(!response.body.includes('SYNTHETIC-PRIVATE'));
    await assert.rejects(denied.code, { code: 'OAUTH_CONSENT_DENIED' });
  } finally { await denied.close(); }
});

test('S07 — caminhos internos/ancestrais/relativos/UNC e dispositivos são recusados antes de ler arquivos', async t => {
  for (const filename of [path.join(REPOSITORY, 'docs/PROJETO_MESTRE_LEVEL_XVIII.md'), path.dirname(REPOSITORY),
    'relative.json', '', '\\\\synthetic-host\\share\\credentials.json']) await t.test('caminho bloqueado', async () => {
    await assert.rejects(validateExternalPath(filename));
  });
  if (process.platform === 'win32') for (const name of ['file.json:stream', 'NUL.json', 'file.json.']) {
    await assert.rejects(validateExternalPath(path.join(os.tmpdir(), name)));
  }
});

test('S08 — armazenamento externo: ACL privada, envelopes, substituição atômica e limpeza pontual', async t => {
  const root = await privateScratch(t), store = new DriveTokenStore(root), value = fakeEnvelope();
  assert.equal((await store.ready()).exists, false);
  await assert.rejects(store.load(), { code: 'OAUTH_AUTHORIZATION_REQUIRED' });
  await store.save(value); assert.deepEqual(await store.load(), value);
  const changed = structuredClone(value); changed.tokens.access_token = 'SYNTHETIC-NEW-NOT-REAL';
  await store.save(changed); assert.deepEqual(await store.load(), changed);
  assert.deepEqual(await fs.readdir(root), [TOKEN_FILENAME]);
  await fs.writeFile(path.join(root, 'keep.txt'), 'SYNTHETIC-KEEP', { mode: 0o600 });
  await store.remove(); assert.equal(await fs.readFile(path.join(root, 'keep.txt'), 'utf8'), 'SYNTHETIC-KEEP');
  await assert.rejects(store.load(), { code: 'OAUTH_AUTHORIZATION_REQUIRED' });
});

test('S09 — JSON desconhecido/corrompido não é sobrescrito nem apagado', async t => {
  const root = await privateScratch(t), store = new DriveTokenStore(root);
  for (const text of ['{"unrelated":true}', '{synthetic-invalid-json']) {
    await fs.writeFile(store.filename, text, { mode: 0o600 });
    await assert.rejects(store.save(fakeEnvelope())); await assert.rejects(store.remove());
    assert.equal(await fs.readFile(store.filename, 'utf8'), text);
  }
});

test('S10 — hardlinks e junctions/symlinks em qualquer componente são recusados', async t => {
  const root = await privateScratch(t), file = path.join(root, 'synthetic.json');
  await fs.writeFile(file, '{"synthetic":true}', { mode: 0o600 });
  const hardlink = path.join(root, 'hardlink.json'); await fs.link(file, hardlink);
  await assert.rejects(readPrivateJson(file), { code: 'HARDLINK_FILE_FORBIDDEN' });
  const target = path.join(root, 'target'); await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'synthetic.json'), '{}', { mode: 0o600 });
  const link = path.join(root, 'junction'); await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(validateExternalPath(path.join(link, 'synthetic.json')), { code: 'SYMBOLIC_PATH_FORBIDDEN' });
  await assert.rejects(new DriveTokenStore(link).ready(), { code: 'SYMBOLIC_PATH_FORBIDDEN' });
});

test('S11 — credencial sintética Desktop só é lida em runtime e endpoints externos são negados', async t => {
  const root = await privateScratch(t), filename = path.join(root, 'synthetic-credentials.json');
  const installed = { ...FAKE_CREDENTIALS, auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token',
    redirect_uris: ['https://example.invalid/ignored'] };
  await fs.writeFile(filename, JSON.stringify({ installed }), { mode: 0o600 });
  assert.deepEqual(await loadDesktopCredentials(filename), FAKE_CREDENTIALS);
  await fs.writeFile(filename, JSON.stringify({ installed: { ...installed, token_uri: 'https://example.invalid/token' } }), { mode: 0o600 });
  await assert.rejects(loadDesktopCredentials(filename), { code: 'CREDENTIAL_ENDPOINT_REJECTED' });
  await fs.writeFile(filename, JSON.stringify({ web: installed }), { mode: 0o600 });
  await assert.rejects(loadDesktopCredentials(filename), { code: 'DESKTOP_CREDENTIALS_REQUIRED' });
  await fs.writeFile(filename, Buffer.alloc(65537));
  await assert.rejects(readPrivateJson(filename), { code: 'PRIVATE_JSON_SIZE' });
});

test('S12 — permissões de leitura de terceiros bloqueiam o arquivo externo', async t => {
  const root = await privateScratch(t), filename = path.join(root, 'unsafe.json');
  await fs.writeFile(filename, '{}', { mode: 0o600 });
  if (process.platform === 'win32') {
    await execFileAsync('icacls.exe', [filename, '/grant', '*S-1-1-0:R'], { windowsHide: true });
  } else await fs.chmod(filename, 0o644);
  await assert.rejects(readPrivateJson(filename), { code: 'PRIVATE_PERMISSIONS_REQUIRED' });
});

test('S13 — núcleo, fonte simulada, suítes antigas e baseline permanecem byte a byte intactos', async () => {
  const expected = {
    'src/engine.mjs': 'bb41103b3a18386da9c5fd7a486562ec0f6ff79ed50ead38faf34f793ef8bf4f',
    'src/drive-source.mjs': 'a147b263b10709b1ec60cf52fd91fd0fc2a82e92f219d3ac49c5771a795b0a2e',
    'test/drive-source.test.mjs': '19584729f32972af81def8efc265199a3fbbe85605c950c2c36ac0de57f27716',
    'test/simulator.test.mjs': 'c9431f1a0c92303493d078f575795b72b88cac65c70637a628c1faa4792d31e6'
  };
  const moduleRoot = path.join(REPOSITORY, 'tools/live-experience-local');
  for (const [name, digest] of Object.entries(expected)) {
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(moduleRoot, name))).digest('hex'), digest, name);
  }
  for (const name of ['drive-auth.mjs', 'drive-token-store.mjs', 'drive-connection.mjs', 'drive-cli.mjs']) {
    const source = await fs.readFile(path.join(moduleRoot, 'src', name), 'utf8');
    assert.ok(!/from ['"]\.\/(engine|drive-source|storage|http|cli)\.mjs/.test(source));
    assert.ok(!/files\.(create|update|delete)|permissions\.(create|update|delete)/.test(source));
  }
});

test('S14 — debug, inspeção, keylog e TLS inseguro bloqueiam antes de ler segredos', async t => {
  assert.doesNotThrow(() => assertQuietRuntime({}, ['--inspect-port=0', '--test-concurrency=1', '--trace-event-file-pattern=synthetic.json']));
  for (const flag of ['--inspect', '--inspect-brk=0', '--import=synthetic', '--require=synthetic', '-r', '--trace-uncaught']) {
    assert.throws(() => assertQuietRuntime({}, [flag]), { code: 'SENSITIVE_LOGGING_CONFIGURATION' });
  }
  for (const [key, value] of [['NODE_DEBUG', '*'], ['DEBUG', '*'], ['GOOGLE_SDK_NODE_LOGGING', '*'],
    ['SSLKEYLOGFILE', 'synthetic-only'], ['NODE_OPTIONS', '--inspect'], ['NODE_TLS_REJECT_UNAUTHORIZED', '0']]) await t.test(key, async () => {
    let reached = false;
    await assert.rejects(runDriveCommand({ command: 'authorize', execute: true, env: { [key]: value } }, {
      makeStore: () => { reached = true; throw new Error('SHOULD_NOT_REACH_SECRETS'); }
    }));
    assert.equal(reached, false);
    assert.equal((await runDriveCommand({ command: 'authorize', env: { [key]: value } })).mode, 'DRY_RUN');
  });
});
