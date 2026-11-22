import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { DRIVE_SCOPE, loadGoogleSdk } from '../src/drive-auth.mjs';
import { DriveError, REPOSITORY } from '../src/drive-token-store.mjs';
import { IDENTITY_FIELDS, IDENTITY_KIND, IDENTITY_FILE, IDENTITY_LOCK, IDENTITY_TTL_MS, DriveIdentityStore,
  parseIdentityArguments, validateIdentityRecord, runIdentityCommand, loadPrivateDriveIdentity, main } from '../src/drive-identity.mjs';
import { oauthHarness, fakeEnvelope, fakeTokens, FAKE_CREDENTIALS, OAUTH_NOW, providerFailure } from './drive-oauth-fixtures.mjs';
const execFileAsync = promisify(execFile);

// All account identities, tokens, client data and filesystem fixtures in this file are invented.
class MemoryIdentityStore {
  constructor() { this.record = null; this.locked = false; this.writes = 0; }
  async withLock(action) {
    if (this.locked) throw new DriveError('IDENTITY_LOCKED_OR_UNAVAILABLE');
    this.locked = true;
    try { return await action({ read: async () => structuredClone(this.record), create: async record => {
      if (this.record !== null) throw new DriveError('IDENTITY_EXISTS');
      this.writes++; if (this.failure) throw this.failure; this.record = structuredClone(record);
    } }); } finally { this.locked = false; }
  }
}

function harness() {
  const h = oauthHarness({ envelope: fakeEnvelope() });
  h.identityStore = new MemoryIdentityStore(); h.calls = []; h.owner = 'synthetic-private-drive-owner'; h.clock = OAUTH_NOW;
  h.env = { LEVEL_DRIVE_IDENTITY_ACCOUNT_CONFIRMED: 'true' };
  h.sdk.drive = () => ({ about: { get: async (params, options) => {
    h.calls.push({ params, options });
    return h.response ? h.response(params, options) : { status: 200, data: { user: { permissionId: h.owner, me: true } } };
  } }, files: new Proxy({}, { get: () => { throw new Error('SYNTHETIC_FILE_ACCESS_FORBIDDEN'); } }),
  permissions: new Proxy({}, { get: () => { throw new Error('SYNTHETIC_PERMISSIONS_ACCESS_FORBIDDEN'); } }) });
  h.injected = { now: () => h.clock, loadCredentials: async () => FAKE_CREDENTIALS, loadSdk: async () => h.sdk,
    makeTokenStore: () => h.store, makeIdentityStore: () => h.identityStore };
  h.capture = (options = {}, extra = {}) => runIdentityCommand({ execute: true, env: h.env, ...options }, { ...h.injected, ...extra });
  h.load = (options = {}, extra = {}) => loadPrivateDriveIdentity({ execute: true, env: h.env, ...options }, { ...h.injected, ...extra });
  return h;
}

async function privateScratch(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-identity-test-'));
  if (process.platform === 'win32') {
    const script = ["$ErrorActionPreference='Stop'", '$p=$env:LEVEL_IDENTITY_TEST_SCRATCH',
      '$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$acl=New-Object System.Security.AccessControl.DirectorySecurity', '$acl.SetOwner($me)', '$acl.SetAccessRuleProtection($true,$false)',
      "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
      '$acl.AddAccessRule($rule)', 'Set-Acl -LiteralPath $p -AclObject $acl'].join(';');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env: { ...process.env, LEVEL_IDENTITY_TEST_SCRATCH: root }, timeout: 10000 });
  } else await fs.chmod(root, 0o700);
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('level-xviii-identity-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const config = { directory: path.join(root, 'identity'), tokenDirectory: path.join(root, 'tokens'),
    credentialsFile: path.join(root, 'secrets', 'synthetic-desktop.json'), labStateDirectory: path.join(root, 'lab-state'),
    labApprovalFile: path.join(root, 'lab-approvals', 'synthetic-approval.json') };
  for (const name of ['identity', 'tokens', 'secrets', 'lab-state', 'lab-approvals']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
  await fs.writeFile(config.credentialsFile, '{"synthetic":true}', { mode: 0o600 });
  return { root, config, store: new DriveIdentityStore(config) };
}

test('I01 — preview de captura e carregador termina antes de ambiente privado, filesystem, SDK, socket ou rede', async t => {
  const forbidden = () => { throw new Error('SYNTHETIC_SIDE_EFFECT_FORBIDDEN'); };
  for (const key of ['open', 'readFile', 'writeFile', 'lstat', 'stat', 'realpath', 'readdir', 'mkdir', 'unlink', 'rename']) t.mock.method(fs, key, forbidden);
  for (const [target, key] of [[http, 'createServer'], [http, 'request'], [https, 'request'], [net, 'createServer'], [net, 'connect'], [globalThis, 'fetch']]) t.mock.method(target, key, forbidden);
  const env = new Proxy({}, { get: forbidden });
  const injected = Object.fromEntries(['now', 'loadCredentials', 'loadSdk', 'makeTokenStore', 'makeIdentityStore'].map(key => [key, forbidden]));
  for (const fn of [runIdentityCommand, loadPrivateDriveIdentity]) {
    for (const args of [[], ['--dry-run']]) {
      const result = await fn({ ...parseIdentityArguments(args), env }, injected);
      assert.equal(result.mode, 'DRY_RUN'); assert.equal(result.effects, 'NONE'); assert.equal(result.scope, DRIVE_SCOPE);
    }
  }
});

test('I02 — argumentos não permitem scope, fields, destino, URL, comandos ambíguos nem eco de valores privados', async () => {
  assert.deepEqual(parseIdentityArguments(['--execute']), { execute: true });
  for (const args of [['--execute', '--dry-run'], ['--execute', '--execute'], ['--scope=drive'], ['--fields=user'],
    ['--url=https://example.invalid/SYNTHETIC-PRIVATE'], ['--output=SYNTHETIC-PRIVATE'], ['authorize']]) {
    const output = []; assert.equal(await main(args, {}, { log: value => output.push(value), error: value => output.push(value) }), 1);
    assert.deepEqual(output, ['{"error":"IDENTITY_ARGUMENTS_REJECTED"}']);
  }
});

test('I03 — primeira captura consulta somente about com fields exatos e persiste identidade sem tokens', async () => {
  const h = harness(), result = await h.capture();
  assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0].params, { fields: 'user(permissionId,me)' });
  assert.equal(IDENTITY_FIELDS, 'user(permissionId,me)'); assert.equal(h.calls[0].options.retry, false);
  assert.equal(h.calls[0].options.timeout, 15000); assert.ok(h.calls[0].options.signal instanceof AbortSignal);
  assert.equal(h.identityStore.record.ownerPermissionId, h.owner); assert.equal(h.identityStore.writes, 1);
  assert.equal(h.identityStore.record.expiresAt, OAUTH_NOW + IDENTITY_TTL_MS);
  assert.equal(result.status, 'IDENTITY_STORED_PRIVATELY'); assert.equal(result.labApprovalCreated, false);
  const serialized = JSON.stringify(h.identityStore.record);
  for (const value of [h.store.value.tokens.access_token, h.store.value.tokens.refresh_token, FAKE_CREDENTIALS.client_id, FAKE_CREDENTIALS.client_secret]) assert.ok(!serialized.includes(value));
  assert.equal(h.opened, 0); assert.equal(h.callbacks, 0); assert.equal(h.auth.exchanges.length, 0); assert.equal(h.store.saves, 0);
});

test('I04 — repetir verifica a mesma conta sem sobrescrever ou prolongar validade; carregador retorna somente material privado mínimo', async () => {
  const h = harness(); await h.capture(); const before = structuredClone(h.identityStore.record);
  h.clock += 1000;
  assert.equal((await h.capture()).status, 'IDENTITY_ALREADY_VERIFIED'); assert.equal(h.identityStore.writes, 1);
  assert.deepEqual(h.identityStore.record, before);
  const loaded = await h.load(); assert.equal(loaded.ownerPermissionId, h.owner);
  assert.deepEqual(Object.keys(loaded).sort(), ['authorizedAt', 'clientBinding', 'expiresAt', 'ownerPermissionId']);
  assert.equal(h.calls.length, 3); assert.equal(h.identityStore.writes, 1);
});

test('I05 — conta divergente, expectativa privada divergente e cliente divergente bloqueiam', async t => {
  for (const scenario of ['account', 'expected-account', 'client-record', 'client-token']) await t.test(scenario, async () => {
    const h = harness(); await h.capture(); const original = structuredClone(h.identityStore.record);
    if (scenario === 'account') h.owner = 'synthetic-other-private-owner';
    if (scenario === 'client-record') h.identityStore.record.clientBinding = 'f'.repeat(64);
    if (scenario === 'client-token') h.store.value.clientBinding = 'f'.repeat(64);
    await assert.rejects(h.load(scenario === 'expected-account' ? { expectedOwnerPermissionId: 'synthetic-unexpected-owner' } : {}));
    assert.equal(h.identityStore.writes, 1); assert.equal(h.identityStore.record.ownerPermissionId, original.ownerPermissionId);
  });
});

test('I06 — nova autorização, prazo divergente ou token trocado durante consulta não liberam identidade', async t => {
  for (const scenario of ['authorization-record', 'deadline-record', 'authorization-during-query', 'refresh-during-query']) await t.test(scenario, async () => {
    const h = harness(); await h.capture();
    if (scenario === 'authorization-record') h.identityStore.record.authorizedAt--;
    if (scenario === 'deadline-record') h.identityStore.record.refreshTokenExpiresAt--;
    if (scenario.endsWith('during-query')) h.response = () => {
      if (scenario === 'authorization-during-query') h.store.value.authorizedAt--;
      else h.store.value.tokens.refresh_token = 'SYNTHETIC-DIFFERENT-REFRESH-NOT-REAL';
      return { status: 200, data: { user: { permissionId: h.owner, me: true } } };
    };
    await assert.rejects(h.load()); assert.equal(h.identityStore.writes, 1);
  });
});

test('I07 — resposta ausente/incompleta, me inválido, campos extras e permissionId inválido não persistem', async t => {
  const replies = [undefined, {}, { status: 200 }, { status: 201, data: { user: { permissionId: 'synthetic-id', me: true } } },
    { status: 200, data: {} }, { status: 200, data: { user: null } }, { status: 200, data: { user: {} } },
    ...[undefined, null, false, 1, 'true'].map(me => ({ status: 200, data: { user: { permissionId: 'synthetic-id', me } } })),
    ...[undefined, null, '', 123, ' ', '../unsafe', 'x'.repeat(257)].map(permissionId => ({ status: 200, data: { user: { permissionId, me: true } } })),
    { status: 200, data: { user: { permissionId: 'synthetic-id', me: true, emailAddress: 'synthetic@example.invalid' } } },
    { status: 200, data: { user: { permissionId: 'synthetic-id', me: true }, storageQuota: {} } }];
  for (let index = 0; index < replies.length; index++) await t.test('response-' + index, async () => {
    const h = harness(); h.response = () => replies[index];
    await assert.rejects(h.capture(), { code: 'IDENTITY_RESPONSE_REJECTED' });
    assert.equal(h.identityStore.writes, 0); assert.equal(h.identityStore.record, null);
  });
});

test('I08 — falhas HTTP na captura e carregamento não gravam nem sobrescrevem identidade', async t => {
  for (const status of [401, 403, 404, 429, 500, 503, 599]) for (const mode of ['capture', 'load']) await t.test(status + '-' + mode, async () => {
    const h = harness(); if (mode === 'load') await h.capture();
    const before = structuredClone(h.identityStore.record), count = h.calls.length;
    h.response = () => { throw providerFailure(status); };
    await assert.rejects(mode === 'load' ? h.load() : h.capture(), error => !JSON.stringify(error).includes('SYNTHETIC-PRIVATE'));
    assert.equal(h.calls.length, count + 1); assert.deepEqual(h.identityStore.record, before);
  });
});

test('I09 — timeout aborta; resposta tardia não persiste depois da falha', async t => {
  for (const late of [false, true]) await t.test('late-' + late, async () => {
    const h = harness(); let signal, resolveReply;
    h.response = (_params, options) => { signal = options.signal; return new Promise(resolve => { resolveReply = resolve; }); };
    await assert.rejects(h.capture({}, { timeoutMs: 10 }), { code: 'IDENTITY_TIMEOUT' });
    assert.equal(signal.aborted, true);
    if (late) { resolveReply({ status: 200, data: { user: { permissionId: h.owner, me: true } } }); await Promise.resolve(); }
    assert.equal(h.identityStore.writes, 0); assert.equal(h.calls.length, 1);
  });
});

test('I10 — sessão ausente, revogada, expirada, scope ampliado ou insegurança de runtime não iniciam login', async t => {
  for (const scenario of ['missing', 'expired-grant', 'scope', 'revoked', 'debug', 'tls', 'confirmation']) await t.test(scenario, async () => {
    const h = harness();
    if (scenario === 'missing') h.store.value = null;
    if (scenario === 'expired-grant') h.clock = h.store.value.refreshTokenExpiresAt;
    if (scenario === 'scope') h.store.value.tokens.scope += ' https://www.googleapis.com/auth/drive';
    if (scenario === 'revoked') { h.store.value.tokens.expiry_date = h.clock + 1; h.auth.failure = providerFailure(400, 'invalid_grant'); }
    if (scenario === 'debug') h.env.DEBUG = '*';
    if (scenario === 'tls') h.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    if (scenario === 'confirmation') delete h.env.LEVEL_DRIVE_IDENTITY_ACCOUNT_CONFIRMED;
    await assert.rejects(h.capture()); assert.equal(h.calls.length, 0); assert.equal(h.identityStore.writes, 0);
    assert.equal(h.opened, 0); assert.equal(h.callbacks, 0); assert.equal(h.auth.exchanges.length, 0);
  });
});

test('I11 — renovação usa authorizedSession existente sem duplicar autenticação ou armazenar tokens na identidade', async () => {
  const h = harness(); h.store.value.tokens.expiry_date = h.clock + 1;
  await h.capture(); assert.equal(h.auth.refreshes, 1); assert.equal(h.store.saves, 1);
  assert.equal(h.identityStore.record.authorizedAt, OAUTH_NOW);
  assert.equal(h.identityStore.record.refreshTokenExpiresAt, h.store.value.refreshTokenExpiresAt);
  assert.ok(!JSON.stringify(h.identityStore.record).includes(h.store.value.tokens.access_token));
});

test('I12 — registro estrito recusa validade expirada, campos sensíveis, tipos inválidos e inconsistência temporal', async t => {
  const h = harness(); await h.capture();
  const changes = {
    kind: value => { value.kind = 'UNKNOWN'; }, missing: value => { delete value.me; }, extraToken: value => { value.access_token = 'SYNTHETIC-NOT-REAL'; },
    extraRefresh: value => { value.refresh_token = 'SYNTHETIC-NOT-REAL'; }, me: value => { value.me = false; },
    future: value => { value.observedAt++; }, client: value => { value.clientBinding = 'bad'; }, id: value => { value.ownerPermissionId = '../unsafe'; },
    ttl: value => { value.expiresAt++; }, expiry: value => { value.refreshTokenExpiresAt = OAUTH_NOW; }, authorized: value => { value.authorizedAt = OAUTH_NOW + 1; }
  };
  for (const [name, change] of Object.entries(changes)) await t.test(name, () => {
    const record = structuredClone(h.identityStore.record); change(record);
    assert.throws(() => validateIdentityRecord(record, null, h.clock));
  });
  h.clock += IDENTITY_TTL_MS;
  await assert.rejects(h.load(), { code: 'IDENTITY_RECORD_EXPIRED' }); assert.equal(h.calls.length, 1);
});

test('I13 — carregador exige registro e expectativa válidos; não cria aprovação nem altera arquivos de laboratório', async () => {
  const h = harness(); await assert.rejects(h.load(), { code: 'IDENTITY_NOT_FOUND' }); assert.equal(h.calls.length, 0);
  await h.capture(); await assert.rejects(h.load({ expectedOwnerPermissionId: '' }), { code: 'IDENTITY_ACCOUNT_MISMATCH' });
  assert.equal(h.identityStore.writes, 1);
});

test('I14 — saídas são allowlistadas sem IDs, Client ID, tokens, hashes, caminhos ou resposta bruta', async () => {
  const h = harness(), output = [];
  const stdout = { log: value => output.push(value), error: value => output.push(value) };
  // This is a mocked programmatic dispatch, never a real CLI process with the execution flag.
  assert.equal(await main(['--execute'], h.env, stdout, h.injected), 0);
  h.response = () => { throw providerFailure(403); };
  assert.equal(await main(['--execute'], h.env, stdout, h.injected), 1);
  h.response = () => { throw new DriveError('IDENTITY_' + h.owner); };
  assert.equal(await main(['--execute'], h.env, stdout, h.injected), 1);
  assert.ok(output.includes('{"error":"DRIVE_HTTP_403"}')); assert.ok(output.includes('{"error":"IDENTITY_OPERATION_FAILED"}'));
  const privateValues = [h.owner, FAKE_CREDENTIALS.client_id, FAKE_CREDENTIALS.client_secret, h.store.value.tokens.access_token,
    h.store.value.tokens.refresh_token, h.identityStore.record.clientBinding, 'SYNTHETIC-PRIVATE'];
  for (const value of privateValues) {
    assert.ok(!output.join('').includes(value)); assert.ok(!output.join('').includes(createHash('sha256').update(value).digest('hex')));
  }
  assert.ok(!output.join('').includes('https://accounts.google.com'));
});

test('I15 — concorrência em memória admite uma captura; falha na gravação não produz sucesso', async () => {
  const h = harness(), result = await Promise.allSettled([h.capture(), h.capture()]);
  assert.equal(result.filter(value => value.status === 'fulfilled').length, 1); assert.equal(h.identityStore.writes, 1); assert.equal(h.calls.length, 1);
  const broken = harness(); broken.identityStore.failure = new Error('SYNTHETIC-PRIVATE-WRITE');
  await assert.rejects(broken.capture(), { code: 'IDENTITY_OPERATION_FAILED' }); assert.equal(broken.identityStore.record, null);
});

test('I16 — prazo OAuth limita validade e expiração durante consulta impede persistência', async () => {
  const h = harness(); h.store.value.refreshTokenExpiresAt = h.clock + 120000;
  await h.capture(); assert.equal(h.identityStore.record.expiresAt, h.clock + 120000);
  const expired = harness(); expired.response = () => {
    expired.clock = expired.store.value.refreshTokenExpiresAt;
    return { status: 200, data: { user: { permissionId: expired.owner, me: true } } };
  };
  await assert.rejects(expired.capture()); assert.equal(expired.identityStore.writes, 0);
});

test('I17 — disco privado: criação exclusiva, lock entre processos, reinício e arquivos protegidos preservados', async t => {
  const { config, store } = await privateScratch(t), h = harness();
  const protectedFiles = [path.join(config.tokenDirectory, 'synthetic-sentinel'), path.join(config.labStateDirectory, 'synthetic-sentinel'), config.labApprovalFile];
  for (const filename of protectedFiles) await fs.writeFile(filename, 'SYNTHETIC-PRESERVE', { mode: 0o600 });
  await store.withLock(async () => {
    await assert.rejects(store.withLock(async () => {}), { code: 'IDENTITY_LOCKED_OR_UNAVAILABLE' });
    const moduleUrl = pathToFileURL(path.join(REPOSITORY, 'tools/live-experience-local/src/drive-identity.mjs')).href;
    const script = 'import { DriveIdentityStore } from ' + JSON.stringify(moduleUrl) + '; try { await new DriveIdentityStore(JSON.parse(process.env.LEVEL_IDENTITY_TEST_CONFIG)).withLock(async()=>{}); process.exitCode=1; } catch(e) { process.stdout.write(e.code); }';
    const child = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true, timeout: 15000,
      env: { ...process.env, LEVEL_IDENTITY_TEST_CONFIG: JSON.stringify(config) } });
    assert.equal(child.stdout, 'IDENTITY_LOCKED_OR_UNAVAILABLE');
  });
  const injection = { makeIdentityStore: () => store };
  await h.capture({}, injection); const before = await fs.readFile(path.join(config.directory, IDENTITY_FILE));
  assert.equal((await h.capture({}, { makeIdentityStore: () => new DriveIdentityStore(config) })).status, 'IDENTITY_ALREADY_VERIFIED');
  assert.equal((await h.load({}, injection)).ownerPermissionId, h.owner);
  assert.deepEqual(await fs.readFile(path.join(config.directory, IDENTITY_FILE)), before);
  assert.deepEqual(await fs.readdir(config.directory), [IDENTITY_FILE]);
  for (const filename of protectedFiles) assert.equal(await fs.readFile(filename, 'utf8'), 'SYNTHETIC-PRESERVE');
});

test('I18 — caminhos sobrepostos a Tokens, Segredos, LabState ou LabApprovals e diretório público são recusados', async t => {
  const { root, config } = await privateScratch(t);
  const forbidden = [config.tokenDirectory, path.dirname(config.credentialsFile), config.labStateDirectory, path.dirname(config.labApprovalFile), root];
  for (const directory of forbidden) await assert.rejects(new DriveIdentityStore({ ...config, directory }).ready(), { code: 'IDENTITY_DIRECTORIES_OVERLAP' });
  const child = path.join(config.labStateDirectory, 'identity'); await fs.mkdir(child);
  await assert.rejects(new DriveIdentityStore({ ...config, directory: child }).ready(), { code: 'IDENTITY_DIRECTORIES_OVERLAP' });
  await assert.rejects(new DriveIdentityStore({ ...config, directory: REPOSITORY }).ready(), { code: 'PATH_MUST_BE_OUTSIDE_REPOSITORY' });
  await assert.rejects(new DriveIdentityStore({ ...config, directory: 'relative' }).ready(), { code: 'IDENTITY_PATH_CONFIGURATION_REQUIRED' });
  await assert.rejects(new DriveIdentityStore({ ...config, labStateDirectory: undefined }).ready(), { code: 'IDENTITY_PATH_CONFIGURATION_REQUIRED' });
  await fs.writeFile(path.join(config.directory, 'unrelated.json'), '{}', { mode: 0o600 });
  await assert.rejects(new DriveIdentityStore(config).ready(), { code: 'IDENTITY_DIRECTORY_NOT_DEDICATED' });
});

test('I19 — disco: arquivo parcial/corrompido, hardlink e lock órfão não são sobrescritos nem recuperados', async t => {
  const { config, store } = await privateScratch(t), file = path.join(config.directory, IDENTITY_FILE), h = harness();
  await fs.writeFile(file, '{partial', { mode: 0o600 });
  await assert.rejects(h.capture({}, { makeIdentityStore: () => store })); assert.equal(await fs.readFile(file, 'utf8'), '{partial');
  assert.equal(h.calls.length, 0);
  const hardlink = path.join(path.dirname(config.credentialsFile), 'synthetic-hardlink'); await fs.link(file, hardlink);
  await assert.rejects(store.withLock(async transaction => transaction.read()), { code: 'HARDLINK_FILE_FORBIDDEN' });
  await fs.writeFile(path.join(config.directory, IDENTITY_LOCK), 'SYNTHETIC-ORPHAN', { mode: 0o600 });
  await assert.rejects(store.withLock(async () => {}), { code: 'IDENTITY_LOCKED_OR_UNAVAILABLE' });
});

test('I20 — ACL insegura em diretório ou arquivo e junction são recusadas sem ajuste automático', async t => {
  const { root, config, store } = await privateScratch(t), h = harness();
  await h.capture({}, { makeIdentityStore: () => store }); const file = path.join(config.directory, IDENTITY_FILE);
  if (process.platform === 'win32') await execFileAsync('icacls.exe', [file, '/grant', '*S-1-1-0:R'], { windowsHide: true });
  else await fs.chmod(file, 0o644);
  await assert.rejects(h.load({}, { makeIdentityStore: () => store }), { code: 'PRIVATE_PERMISSIONS_REQUIRED' });
  const link = path.join(root, 'synthetic-junction'); await fs.symlink(config.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(new DriveIdentityStore({ ...config, directory: link }).ready(), { code: 'SYMBOLIC_PATH_FORBIDDEN' });
  if (process.platform === 'win32') await execFileAsync('icacls.exe', [config.directory, '/grant', '*S-1-1-0:R'], { windowsHide: true });
  else await fs.chmod(config.directory, 0o755);
  await assert.rejects(store.ready(), { code: 'PRIVATE_PERMISSIONS_REQUIRED' });
});

test('I21 — regressão: todos os 64 arquivos protegidos de 739fc91, incluindo módulos e testes anteriores, permanecem intactos', async () => {
  const allowed = new Set(['tools/live-experience-local/package.json', 'tools/live-experience-local/README.md',
    'tools/live-experience-local/GOOGLE_DRIVE_OAUTH.md', 'tools/live-experience-local/GOOGLE_DRIVE_LAB.md']);
  const recorded = JSON.parse(await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/test/preservation-baseline.json'), 'utf8')).files;
  const { stdout } = await execFileAsync('git', ['ls-tree', '-r', '--name-only', '-z', '739fc91'], { cwd: REPOSITORY });
  let checked = 0;
  for (const name of stdout.split('\0').filter(Boolean)) {
    if (allowed.has(name)) continue;
    const baseline = await execFileAsync('git', ['show', '739fc91:' + name], { cwd: REPOSITORY, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(REPOSITORY, name))).digest('hex'),
      recorded[name] ?? createHash('sha256').update(baseline.stdout).digest('hex'), name); checked++;
  }
  assert.equal(checked, 64);
  const source = await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/src/drive-identity.mjs'), 'utf8');
  assert.ok(!/from ['"]\.\/(engine|drive-source|drive-lab|drive-lab-state|storage|http|cli)\.mjs/.test(source));
  assert.ok(!/files\.(create|get|list|update|delete)|permissions\.|authorizeDesktop|generateAuthUrl/.test(source));
});

test('I22 — SDK oficial usa transporte mockado para about mínimo, sem retry HTTP e sem ampliação de scope', async t => {
  const forbidden = () => { throw new Error('SYNTHETIC_NETWORK_FORBIDDEN'); };
  t.mock.method(https, 'request', forbidden); t.mock.method(globalThis, 'fetch', forbidden);
  const sdk = await loadGoogleSdk();
  for (const status of [200, 401, 403, 404, 429, 503]) await t.test(String(status), async () => {
    const h = harness(), auth = sdk.oauth(FAKE_CREDENTIALS);
    h.store.value.tokens.expiry_date = Math.max(Date.now(), OAUTH_NOW) + 3600000;
    let requests = 0;
    auth.refreshAccessToken = forbidden;
    auth.transporter.request = async options => {
      requests++; assert.equal(options.retry, false); assert.equal(options.method, 'GET');
      assert.equal(options.params.fields, IDENTITY_FIELDS);
      assert.equal(new URL(options.url).pathname, '/drive/v3/about');
      if (status !== 200) throw providerFailure(status);
      return { status: 200, data: { user: { permissionId: h.owner, me: true } } };
    };
    const injected = { loadSdk: async () => ({ ...sdk, oauth: () => auth }) };
    if (status === 200) await h.capture({}, injected); else await assert.rejects(h.capture({}, injected));
    assert.equal(requests, 1);
  });
});

test('I23 — gravação incerta deixa lock para revisão e não publica registro parcial', async t => {
  for (const stage of ['write', 'sync', 'exclusive']) await t.test(stage, async child => {
    const { config, store } = await privateScratch(child), h = harness(), originalOpen = fs.open.bind(fs);
    const file = path.join(config.directory, IDENTITY_FILE);
    if (stage === 'exclusive') h.response = async () => {
      await fs.writeFile(file, 'SYNTHETIC-PRESERVE', { mode: 0o600 });
      return { status: 200, data: { user: { permissionId: h.owner, me: true } } };
    };
    const mock = child.mock.method(fs, 'open', async (filename, ...args) => {
      const handle = await originalOpen(filename, ...args);
      if (filename === file && stage !== 'exclusive') handle[stage === 'write' ? 'writeFile' : 'sync'] = async () => {
        throw new Error('SYNTHETIC-PRIVATE-DISK-FAILURE');
      };
      return handle;
    });
    await assert.rejects(h.capture({}, { makeIdentityStore: () => store }), { code: stage === 'exclusive' ? 'IDENTITY_EXISTS' : 'IDENTITY_STORAGE_FAILED' });
    mock.mock.restore();
    assert.ok((await fs.readdir(config.directory)).includes(IDENTITY_LOCK));
    await assert.rejects(h.load({}, { makeIdentityStore: () => store }), { code: 'IDENTITY_LOCKED_OR_UNAVAILABLE' });
    if (stage === 'write') assert.equal((await fs.stat(file)).size, 0);
    if (stage === 'sync') assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).kind, IDENTITY_KIND);
    if (stage === 'exclusive') assert.equal(await fs.readFile(file, 'utf8'), 'SYNTHETIC-PRESERVE');
  });
});

test('I24 — ACL é verificada antes dos bytes; falha preserva arquivo vazio e lock', async t => {
  const { config, store } = await privateScratch(t), h = harness(), originalOpen = fs.open.bind(fs);
  const file = path.join(config.directory, IDENTITY_FILE);
  const mock = t.mock.method(fs, 'open', async (filename, ...args) => {
    const handle = await originalOpen(filename, ...args);
    if (filename === file) {
      if (process.platform === 'win32') await execFileAsync('icacls.exe', [file, '/grant', '*S-1-1-0:R'], { windowsHide: true });
      else await fs.chmod(file, 0o644);
    }
    return handle;
  });
  await assert.rejects(h.capture({}, { makeIdentityStore: () => store }), { code: 'PRIVATE_PERMISSIONS_REQUIRED' }); mock.mock.restore();
  assert.equal((await fs.stat(file)).size, 0);
  assert.ok((await fs.readdir(config.directory)).includes(IDENTITY_LOCK));
});
