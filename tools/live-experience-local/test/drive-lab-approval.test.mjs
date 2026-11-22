import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { DRIVE_SCOPE } from '../src/drive-auth.mjs';
import { DriveError, REPOSITORY, TOKEN_FILENAME, readPrivateJson } from '../src/drive-token-store.mjs';
import { IDENTITY_FILE, IDENTITY_KIND, IDENTITY_LOCK } from '../src/drive-identity.mjs';
import { LAB_APPROVAL_KIND, validateLabApproval, labDirectoryBinding } from '../src/drive-lab-state.mjs';
import { labHarness } from './drive-lab-fixtures.mjs';
import { FAKE_CREDENTIALS, OAUTH_NOW, fakeEnvelope, MemoryTokenStore } from './drive-oauth-fixtures.mjs';
import { PREPARE_LOCK, MIN_APPROVAL_VALIDITY_MS, LabApprovalWriter, assertLocalNtfs, approvalExpiry,
  parsePrepareArguments, runPrepareCommand, main } from '../src/drive-lab-approval.mjs';
const execFileAsync = promisify(execFile);
const KEYS = ['kind', 'action', 'approvalId', 'operationId', 'expiresAt', 'scope', 'clientBinding', 'stateBinding', 'ownerPermissionId', 'files'];

// No real paths, identities, credentials or grants are used. These fixtures are deliberately invented.
function fixture() {
  const h = { clock: OAUTH_NOW, record: null, approval: null, writes: 0, locked: false, identityLocked: false,
    entropyCalls: [], tokens: new MemoryTokenStore(fakeEnvelope()), credentials: { ...FAKE_CREDENTIALS }, reads: 0,
    stateDirectory: path.join(os.tmpdir(), 'synthetic-lab-prepare-state') };
  h.record = { kind: IDENTITY_KIND, scope: DRIVE_SCOPE, clientBinding: h.tokens.value.clientBinding,
    authorizedAt: OAUTH_NOW, refreshTokenExpiresAt: h.tokens.value.refreshTokenExpiresAt,
    observedAt: OAUTH_NOW, expiresAt: OAUTH_NOW + 3600000, ownerPermissionId: 'synthetic-lab-owner', me: true };
  h.env = { LEVEL_DRIVE_LAB_PREPARE_CONFIRMED: 'true', LEVEL_DRIVE_IDENTITY_ACCOUNT_CONFIRMED: 'true' };
  h.writer = { withLock: async action => {
    if (h.locked) throw new DriveError('APPROVAL_LOCKED_OR_UNAVAILABLE');
    if (h.approval) throw new DriveError('APPROVAL_DESTINATION_EXISTS');
    h.locked = true;
    try { return await action({ stateDirectory: h.stateDirectory, publish: async (value, verify) => {
      h.pending = structuredClone(value); if (h.beforeVerify) await h.beforeVerify(); await verify();
      if (h.writeFailure) throw h.writeFailure;
      h.approval = structuredClone(value); h.writes++;
    } }); } finally { h.locked = false; }
  } };
  h.identity = { withLock: async action => {
    if (h.identityLocked) throw new DriveError('IDENTITY_LOCKED_OR_UNAVAILABLE');
    h.identityLocked = true;
    try { return await action({ read: async () => { h.reads++; return structuredClone(h.record); } }); }
    finally { h.identityLocked = false; }
  } };
  h.injected = { now: () => h.clock, makeWriter: () => h.writer, makeIdentityStore: () => h.identity,
    makeTokenStore: () => h.tokens, loadCredentials: async () => h.credentials,
    randomBytes: count => { h.entropyCalls.push(count); return randomBytes(count); } };
  h.run = (extra = {}, options = {}) => runPrepareCommand({ execute: true, env: h.env, ...options }, { ...h.injected, ...extra });
  return h;
}

async function scratch(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-approval-test-'));
  if (process.platform === 'win32') {
    const script = ["$ErrorActionPreference='Stop'", '$p=$env:LEVEL_APPROVAL_TEST_SCRATCH',
      '$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$acl=New-Object System.Security.AccessControl.DirectorySecurity', '$acl.SetOwner($me)', '$acl.SetAccessRuleProtection($true,$false)',
      "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
      '$acl.AddAccessRule($rule)', 'Set-Acl -LiteralPath $p -AclObject $acl'].join(';');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, env: { ...process.env, LEVEL_APPROVAL_TEST_SCRATCH: root }, timeout: 10000 });
  } else await fs.chmod(root, 0o700);
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('level-xviii-approval-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  for (const name of ['approvals', 'state', 'identity', 'tokens', 'secrets']) await fs.mkdir(path.join(root, name), { mode: 0o700 });
  const config = { approvalFile: path.join(root, 'approvals', 'synthetic-lab-create.json'), stateDirectory: path.join(root, 'state'),
    identityDirectory: path.join(root, 'identity'), tokenDirectory: path.join(root, 'tokens'), credentialsFile: path.join(root, 'secrets', 'synthetic-desktop.json') };
  const h = fixture(); h.stateDirectory = config.stateDirectory;
  await fs.writeFile(config.credentialsFile, JSON.stringify({ installed: { ...FAKE_CREDENTIALS,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token' } }), { mode: 0o600 });
  await fs.writeFile(path.join(config.tokenDirectory, TOKEN_FILENAME), JSON.stringify(h.tokens.value), { mode: 0o600 });
  await fs.writeFile(path.join(config.identityDirectory, IDENTITY_FILE), JSON.stringify(h.record), { mode: 0o600 });
  const writer = new LabApprovalWriter(config);
  const env = { ...h.env, LEVEL_DRIVE_LAB_APPROVAL_FILE: config.approvalFile, LEVEL_DRIVE_LAB_STATE_DIR: config.stateDirectory,
    LEVEL_DRIVE_IDENTITY_DIR: config.identityDirectory, LEVEL_DRIVE_TOKEN_DIR: config.tokenDirectory, LEVEL_DRIVE_CREDENTIALS_FILE: config.credentialsFile };
  return { root, config, h, writer, env, run: extra => h.run({ makeWriter: () => writer, ...extra }),
    runReal: () => runPrepareCommand({ execute: true, env }, { now: () => h.clock }) };
}

test('P01 — dry-run retorna antes de ambiente privado, filesystem, SDK, sockets, rede ou escrita', async t => {
  const forbidden = () => { throw new Error('SYNTHETIC_SIDE_EFFECT_FORBIDDEN'); };
  for (const key of ['open', 'readFile', 'writeFile', 'lstat', 'stat', 'realpath', 'readdir', 'mkdir', 'link', 'unlink', 'rename']) t.mock.method(fs, key, forbidden);
  for (const [target, key] of [[http, 'createServer'], [http, 'request'], [https, 'request'], [net, 'createServer'], [net, 'connect'], [globalThis, 'fetch']]) t.mock.method(target, key, forbidden);
  const env = new Proxy({}, { get: forbidden }), injected = Object.fromEntries(['now', 'makeWriter', 'makeIdentityStore', 'makeTokenStore', 'loadCredentials', 'randomBytes'].map(key => [key, forbidden]));
  for (const args of [[], ['--dry-run']]) {
    const result = await runPrepareCommand({ ...parsePrepareArguments(args), env }, injected);
    assert.equal(result.effects, 'NONE'); assert.equal(result.googleContacted, false); assert.equal(result.scope, DRIVE_SCOPE);
  }
});

test('P02 — parse não aceita payload, escopo, validade, destino ou flags ambíguas', async () => {
  assert.deepEqual(parsePrepareArguments(['--execute']), { execute: true });
  for (const args of [['--execute', '--dry-run'], ['--execute', '--execute'], ['--scope=drive'], ['--files=synthetic'], ['--expires=3600000'],
    ['--output=SYNTHETIC-PRIVATE'], ['--owner=SYNTHETIC-PRIVATE'], ['--payload=SYNTHETIC-PRIVATE']]) {
    const output = [];
    assert.equal(await main(args, {}, { log: value => output.push(value), error: value => output.push(value) }), 1);
    assert.deepEqual(output, ['{"error":"APPROVAL_ARGUMENTS_REJECTED"}']);
  }
});

test('P03 — exatamente dez campos, randomBytes(32)/(16), vínculos privados corretos e nenhuma ampliação de scope', async () => {
  const h = fixture(), result = await h.run(), a = h.approval;
  assert.deepEqual(Object.keys(a), KEYS); assert.deepEqual(h.entropyCalls, [32, 16]);
  assert.equal(a.kind, LAB_APPROVAL_KIND); assert.equal(a.action, 'lab-create'); assert.equal(a.scope, DRIVE_SCOPE); assert.deepEqual(a.files, []);
  assert.ok(/^[a-f0-9]{64}$/.test(a.approvalId)); assert.ok(/^[a-f0-9]{32}$/.test(a.operationId));
  assert.ok(a.clientBinding === h.tokens.value.clientBinding); assert.ok(a.ownerPermissionId === h.record.ownerPermissionId);
  assert.ok(a.stateBinding === labDirectoryBinding(h.stateDirectory));
  assert.ok(JSON.stringify(validateLabApproval(a, 'lab-create', DRIVE_SCOPE, h.clock)) === JSON.stringify(a));
  assert.equal(result.googleContacted, false); assert.equal(result.labStateChanged, false); assert.equal(h.tokens.saves, 0);
  const other = fixture(); await other.run(); assert.ok(a.approvalId !== other.approval.approvalId && a.operationId !== other.approval.operationId);
});

test('P04 — validade respeita cada limite e exige cinco minutos úteis', async t => {
  const n = OAUTH_NOW;
  for (const [name, id, grant, expected] of [['hour', n + 7200000, n + 10800000, n + 3600000],
    ['identity', n + 600000, n + 7200000, n + 600000], ['grant', n + 7200000, n + 900000, n + 900000]]) {
    await t.test(name, () => assert.equal(approvalExpiry(n, id, grant), expected));
  }
  assert.equal(approvalExpiry(n, n + MIN_APPROVAL_VALIDITY_MS, n + 3600000), n + MIN_APPROVAL_VALIDITY_MS);
  for (const expiry of [n, n - 1, n + MIN_APPROVAL_VALIDITY_MS - 1, NaN, Infinity]) {
    assert.throws(() => approvalExpiry(n, expiry, n + 3600000), { code: 'APPROVAL_INSUFFICIENT_VALIDITY' });
  }
  const h = fixture(); h.clock += 120000; await h.run(); assert.equal(h.approval.expiresAt, h.record.expiresAt);
  const short = fixture(); short.tokens.value.refreshTokenExpiresAt = short.clock + 600000;
  short.record.refreshTokenExpiresAt = short.tokens.value.refreshTokenExpiresAt; short.record.expiresAt = short.tokens.value.refreshTokenExpiresAt;
  await short.run(); assert.equal(short.approval.expiresAt, short.record.expiresAt);
});

test('P05 — identidade ausente/inválida/vencida, cliente, autorização, scope e campos extras falham antes de publicar', async t => {
  const cases = {
    missing: h => { h.record = null; }, invalid: h => { h.record.kind = 'UNKNOWN'; }, expired: h => { h.clock += 3600000; },
    me: h => { h.record.me = false; }, id: h => { h.record.ownerPermissionId = '../unsafe'; }, extra: h => { h.record.extra = true; },
    tokenField: h => { h.record.access_token = 'SYNTHETIC-NOT-REAL'; }, client: h => { h.record.clientBinding = 'f'.repeat(64); },
    credentials: h => { h.credentials.client_id = 'synthetic-other.apps.googleusercontent.com'; },
    authorization: h => { h.record.authorizedAt--; }, scope: h => { h.tokens.value.tokens.scope += ' https://www.googleapis.com/auth/drive'; },
    identityScope: h => { h.record.scope += ' https://www.googleapis.com/auth/drive'; },
    absentTokens: h => { h.tokens.value = null; }, insufficient: h => { h.clock += 3600000 - MIN_APPROVAL_VALIDITY_MS + 1; }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async () => {
    const h = fixture(); change(h); await assert.rejects(h.run()); assert.equal(h.writes, 0); assert.equal(h.approval, null); assert.equal(h.tokens.saves, 0);
  });
});

test('P06 — revalidação de fontes impede conta, cliente, tokens ou prazo trocados durante a preparação', async t => {
  for (const scenario of ['account', 'client', 'authorization', 'access', 'refresh', 'expiry']) await t.test(scenario, async () => {
    const h = fixture(); h.beforeVerify = () => {
      if (scenario === 'account') h.record.ownerPermissionId = 'synthetic-different-owner';
      if (scenario === 'client') h.record.clientBinding = 'f'.repeat(64);
      if (scenario === 'authorization') h.record.authorizedAt--;
      if (scenario === 'access') h.tokens.value.tokens.access_token = 'SYNTHETIC-OTHER-ACCESS';
      if (scenario === 'refresh') h.tokens.value.tokens.refresh_token = 'SYNTHETIC-OTHER-REFRESH';
      if (scenario === 'expiry') h.clock += 3600000;
    };
    await assert.rejects(h.run()); assert.equal(h.writes, 0);
  });
});

test('P07 — contrato V1 recusa action, scope, files, formato de IDs e campo extra', async () => {
  const h = fixture(); await h.run();
  for (const change of [a => { a.action = 'lab-inspect'; }, a => { a.scope += ' https://www.googleapis.com/auth/drive'; },
    a => { a.files = [{ id: 'synthetic-file' }]; }, a => { a.approvalId = 'A'.repeat(64); }, a => { a.operationId = 'wrong'; },
    a => { a.authorizedAt = OAUTH_NOW; }]) {
    const a = structuredClone(h.approval); change(a); assert.throws(() => validateLabApproval(a, 'lab-create', DRIVE_SCOPE, h.clock));
  }
});

test('P08 — execução offline não usa rede e nunca renova ou salva tokens', async t => {
  const forbidden = () => { throw new Error('SYNTHETIC_NETWORK_OR_TOKEN_WRITE_FORBIDDEN'); };
  t.mock.method(https, 'request', forbidden); t.mock.method(http, 'request', forbidden); t.mock.method(net, 'connect', forbidden);
  t.mock.method(globalThis, 'fetch', forbidden); t.mock.method(fs, 'rename', forbidden);
  const h = fixture(); h.tokens.save = forbidden; h.tokens.value.tokens.expiry_date = h.clock - 1;
  await h.run(); assert.equal(h.writes, 1); // An expired access token is not refreshed; the valid grant/identity bound the approval.
});

test('P09 — configuração sensível, confirmação ausente, entropia inválida e concorrência não produzem aprovação', async t => {
  for (const scenario of ['confirm', 'identity-confirm', 'debug', 'tls', 'entropy']) await t.test(scenario, async () => {
    const h = fixture();
    if (scenario === 'confirm') delete h.env.LEVEL_DRIVE_LAB_PREPARE_CONFIRMED;
    if (scenario === 'identity-confirm') delete h.env.LEVEL_DRIVE_IDENTITY_ACCOUNT_CONFIRMED;
    if (scenario === 'debug') h.env.DEBUG = '*';
    if (scenario === 'tls') h.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    await assert.rejects(h.run(scenario === 'entropy' ? { randomBytes: () => Buffer.alloc(1) } : {})); assert.equal(h.writes, 0);
  });
  const h = fixture(), results = await Promise.allSettled([h.run(), h.run()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(h.writes, 1);
  await assert.rejects(h.run(), { code: 'APPROVAL_DESTINATION_EXISTS' });
});

test('P10 — saídas não contêm IDs, bindings, Client ID, tokens, paths, JSON privado ou hashes correlacionáveis', async () => {
  const h = fixture(), output = [], sink = { log: value => output.push(value), error: value => output.push(value) };
  // Mocked programmatic dispatch only, never an executed CLI process with real private configuration.
  assert.equal(await main(['--execute'], h.env, sink, h.injected), 0);
  assert.equal(await main(['--execute'], h.env, sink, h.injected), 1);
  const broken = fixture(); broken.writeFailure = new DriveError('APPROVAL_' + h.record.ownerPermissionId);
  assert.equal(await main(['--execute'], broken.env, sink, broken.injected), 1);
  const privateValues = [h.record.ownerPermissionId, h.approval.approvalId, h.approval.operationId, h.approval.clientBinding,
    h.approval.stateBinding, FAKE_CREDENTIALS.client_id, FAKE_CREDENTIALS.client_secret, h.tokens.value.tokens.access_token,
    h.tokens.value.tokens.refresh_token, h.stateDirectory];
  for (const value of privateValues) {
    assert.ok(!output.join('').includes(value)); assert.ok(!output.join('').includes(createHash('sha256').update(value).digest('hex')));
  }
  assert.ok(output.includes('{"error":"APPROVAL_OPERATION_FAILED"}'));
});

test('P11 — aprovação preparada é consumida pelo laboratório simulado uma vez, sem reutilização', async () => {
  const h = fixture(); await h.run(); const lab = labHarness();
  lab.approval.operationId = h.approval.operationId;
  lab.stateStore.binding = () => labDirectoryBinding(h.stateDirectory);
  await lab.run('lab-create', { approval: h.approval }); assert.equal(lab.creates, 1);
  await assert.rejects(lab.run('lab-create', { approval: h.approval }), { code: 'LAB_CREATE_ALREADY_RESERVED' });
  assert.equal(lab.creates, 1);
});

test('P12 — filesystem não validado/sem NTFS é recusado sem fallback', async () => {
  await assert.rejects(assertLocalNtfs('SYNTHETIC', { platform: 'linux' }), { code: 'APPROVAL_FILESYSTEM_UNSUPPORTED' });
  await assert.rejects(assertLocalNtfs('SYNTHETIC', { platform: 'win32', inspect: async () => ({ stdout: 'FAT32' }) }), { code: 'APPROVAL_FILESYSTEM_UNSUPPORTED' });
  await assert.rejects(assertLocalNtfs('SYNTHETIC', { platform: 'win32', inspect: async () => { throw new Error('SYNTHETIC-PRIVATE'); } }), { code: 'APPROVAL_FILESYSTEM_UNVERIFIED' });
});

test('P13 — Windows/NTFS real: hardlink transiente tem dois nomes e o consumidor privado o recusa', async t => {
  const s = await scratch(t); assert.equal(process.platform, 'win32'); await assertLocalNtfs(path.dirname(s.config.approvalFile));
  const preserved = [s.config.credentialsFile, path.join(s.config.tokenDirectory, TOKEN_FILENAME), path.join(s.config.identityDirectory, IDENTITY_FILE)];
  const before = await Promise.all(preserved.map(name => fs.readFile(name)));
  const original = fs.link.bind(fs); let windows = 0;
  const mock = t.mock.method(fs, 'link', async (source, target) => {
    await original(source, target); const a = await fs.stat(source), b = await fs.stat(target);
    assert.equal(a.nlink, 2); assert.equal(b.nlink, 2); assert.ok(a.ino === b.ino && a.dev === b.dev);
    await assert.rejects(readPrivateJson(target), { code: 'HARDLINK_FILE_FORBIDDEN' }); windows++;
  });
  const result = await s.runReal(); mock.mock.restore();
  assert.equal(result.status, 'LAB_CREATE_APPROVAL_PREPARED_PRIVATELY'); assert.equal(windows, 1);
  const final = await readPrivateJson(s.config.approvalFile);
  assert.ok(Object.keys(final).length === 10); validateLabApproval(final, 'lab-create', DRIVE_SCOPE, s.h.clock);
  assert.equal((await fs.stat(s.config.approvalFile)).nlink, 1);
  assert.deepEqual(await fs.readdir(s.config.stateDirectory), []);
  assert.deepEqual(await fs.readdir(path.dirname(s.config.approvalFile)), [path.basename(s.config.approvalFile)]);
  for (let i = 0; i < preserved.length; i++) assert.ok((await fs.readFile(preserved[i])).equals(before[i]));
  await assert.rejects(s.runReal(), { code: 'APPROVAL_DESTINATION_EXISTS' });
});

test('P14 — lock exclusivo real entre processos não modifica LabState', async t => {
  const s = await scratch(t);
  await s.writer.withLock(async () => {
    await assert.rejects(new LabApprovalWriter(s.config).withLock(async () => {}), { code: 'APPROVAL_LOCKED_OR_UNAVAILABLE' });
    const url = pathToFileURL(path.join(REPOSITORY, 'tools/live-experience-local/src/drive-lab-approval.mjs')).href;
    const code = 'import {LabApprovalWriter} from ' + JSON.stringify(url) + ';try{await new LabApprovalWriter(JSON.parse(process.env.LEVEL_PREPARE_TEST_CONFIG)).withLock(async()=>{});process.exitCode=1;}catch(e){process.stdout.write(e.code);}';
    const result = await execFileAsync(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, timeout: 20000,
      env: { ...process.env, LEVEL_PREPARE_TEST_CONFIG: JSON.stringify(s.config) } });
    assert.equal(result.stdout, 'APPROVAL_LOCKED_OR_UNAVAILABLE');
  });
  assert.deepEqual(await fs.readdir(s.config.stateDirectory), []);
});

test('P15 — paths sobrepostos, relativos, internos, junctions, hardlinks e destinos reservados são recusados', async t => {
  const s = await scratch(t), c = s.config;
  for (const directory of [c.stateDirectory, c.identityDirectory, c.tokenDirectory, path.dirname(c.credentialsFile), s.root]) {
    await assert.rejects(new LabApprovalWriter({ ...c, approvalFile: path.join(directory, 'synthetic-approval.json') }).ready(), { code: 'APPROVAL_DIRECTORIES_OVERLAP' });
  }
  const nested = path.join(c.stateDirectory, 'synthetic-child'); await fs.mkdir(nested);
  await assert.rejects(new LabApprovalWriter({ ...c, approvalFile: path.join(nested, 'synthetic.json') }).ready(), { code: 'APPROVAL_DIRECTORIES_OVERLAP' });
  await assert.rejects(new LabApprovalWriter({ ...c, approvalFile: 'relative.json' }).ready(), { code: 'APPROVAL_PATH_CONFIGURATION_REQUIRED' });
  await assert.rejects(new LabApprovalWriter({ ...c, approvalFile: path.join(REPOSITORY, 'synthetic-not-created.json') }).ready(), { code: 'PATH_MUST_BE_OUTSIDE_REPOSITORY' });
  await assert.rejects(new LabApprovalWriter({ ...c, approvalFile: path.join(path.dirname(c.approvalFile), PREPARE_LOCK) }).ready(), { code: 'APPROVAL_PATH_CONFIGURATION_REQUIRED' });
  const junction = path.join(s.root, 'synthetic-link'); await fs.symlink(c.identityDirectory, junction, 'junction');
  await assert.rejects(new LabApprovalWriter({ ...c, identityDirectory: junction }).ready(), { code: 'SYMBOLIC_PATH_FORBIDDEN' });
  const link = path.join(s.root, 'synthetic-credential-link'); await fs.link(c.credentialsFile, link);
  await assert.rejects(s.writer.ready(), { code: 'HARDLINK_FILE_FORBIDDEN' });
});

test('P16 — LabState ocupado, órfãos e arquivos inesperados impedem geração', async t => {
  for (const where of ['state', 'orphan', 'approval-directory', 'identity-lock']) await t.test(where, async child => {
    const s = await scratch(child);
    if (where === 'state') await fs.writeFile(path.join(s.config.stateDirectory, 'drive-lab.lock'), 'SYNTHETIC', { mode: 0o600 });
    if (where === 'orphan') await fs.writeFile(path.join(path.dirname(s.config.approvalFile), '.drive-lab-approval-orphan.tmp'), '{}', { mode: 0o600 });
    if (where === 'approval-directory') await fs.writeFile(path.join(path.dirname(s.config.approvalFile), 'unknown.json'), '{}', { mode: 0o600 });
    if (where === 'identity-lock') await fs.writeFile(path.join(s.config.identityDirectory, IDENTITY_LOCK), 'SYNTHETIC', { mode: 0o600 });
    await assert.rejects(s.runReal());
    await assert.rejects(fs.stat(s.config.approvalFile), { code: 'ENOENT' });
  });
});

test('P17 — destino existente não é lido nem sobrescrito; lock órfão permanece bloqueado', async t => {
  const s = await scratch(t), before = Buffer.from('SYNTHETIC-UNRELATED-PRIVATE-FILE');
  await fs.writeFile(s.config.approvalFile, before, { mode: 0o600 });
  await assert.rejects(s.run(), { code: 'APPROVAL_DESTINATION_EXISTS' });
  assert.ok((await fs.readFile(s.config.approvalFile)).equals(before));
  const lock = path.join(path.dirname(s.config.approvalFile), PREPARE_LOCK); await fs.writeFile(lock, 'SYNTHETIC', { mode: 0o600 });
  await assert.rejects(s.writer.withLock(async () => {}), { code: 'APPROVAL_DESTINATION_EXISTS' });
});

test('P18 — falhas de write, sync, link e limpeza preservam evidências e não repetem publicação', async t => {
  for (const stage of ['write', 'sync', 'link-unsupported', 'link-after-create', 'unlink-before', 'unlink-after', 'lock-cleanup', 'collision']) {
    await t.test(stage, async child => {
      const s = await scratch(child), directory = path.dirname(s.config.approvalFile);
      const originalOpen = fs.open.bind(fs), originalLink = fs.link.bind(fs), originalUnlink = fs.unlink.bind(fs);
      let links = 0;
      const openMock = child.mock.method(fs, 'open', async (filename, ...args) => {
        const handle = await originalOpen(filename, ...args);
        if (path.basename(filename).startsWith('.drive-lab-approval-') && ['write', 'sync'].includes(stage)) handle[stage === 'write' ? 'writeFile' : 'sync'] = async () => { throw new Error('SYNTHETIC-PRIVATE-IO'); };
        return handle;
      });
      const linkMock = child.mock.method(fs, 'link', async (source, target) => {
        links++;
        if (stage === 'link-unsupported') throw Object.assign(new Error('SYNTHETIC'), { code: 'ENOTSUP' });
        if (stage === 'collision') await fs.writeFile(target, 'SYNTHETIC-PRESERVE-COLLISION', { mode: 0o600 });
        await originalLink(source, target);
        if (stage === 'link-after-create') throw new Error('SYNTHETIC-PRIVATE-UNCERTAIN');
      });
      const unlinkMock = child.mock.method(fs, 'unlink', async filename => {
        const temporary = path.basename(filename).startsWith('.drive-lab-approval-');
        if (temporary && stage === 'unlink-before' || path.basename(filename) === PREPARE_LOCK && stage === 'lock-cleanup') throw new Error('SYNTHETIC-PRIVATE-CLEANUP');
        await originalUnlink(filename);
        if (temporary && stage === 'unlink-after') throw new Error('SYNTHETIC-PRIVATE-CLEANUP');
      });
      await assert.rejects(s.run()); openMock.mock.restore(); linkMock.mock.restore(); unlinkMock.mock.restore();
      assert.ok((await fs.readdir(directory)).includes(PREPARE_LOCK)); assert.ok(links <= 1);
      await assert.rejects(s.run());
      assert.ok(links <= 1);
      if (stage === 'collision') assert.equal(await fs.readFile(s.config.approvalFile, 'utf8'), 'SYNTHETIC-PRESERVE-COLLISION');
      if (['link-after-create', 'unlink-before'].includes(stage)) await assert.rejects(readPrivateJson(s.config.approvalFile), { code: 'HARDLINK_FILE_FORBIDDEN' });
      if (['unlink-after', 'lock-cleanup'].includes(stage)) validateLabApproval(await readPrivateJson(s.config.approvalFile), 'lab-create', DRIVE_SCOPE, s.h.clock);
    });
  }
});

test('P19 — ACL insegura de diretório e temporário é recusada antes dos bytes', async t => {
  const s = await scratch(t), originalOpen = fs.open.bind(fs);
  let temporary;
  const mock = t.mock.method(fs, 'open', async (filename, ...args) => {
    const handle = await originalOpen(filename, ...args);
    if (path.basename(filename).startsWith('.drive-lab-approval-')) {
      temporary = filename; await execFileAsync('icacls.exe', [filename, '/grant', '*S-1-1-0:R'], { windowsHide: true });
    }
    return handle;
  });
  await assert.rejects(s.run(), { code: 'PRIVATE_PERMISSIONS_REQUIRED' }); mock.mock.restore();
  assert.equal((await fs.stat(temporary)).size, 0);
  await execFileAsync('icacls.exe', [path.dirname(s.config.approvalFile), '/grant', '*S-1-1-0:R'], { windowsHide: true });
  await assert.rejects(s.writer.ready(), { code: 'PRIVATE_PERMISSIONS_REQUIRED' });
});

test('P20 — mudança de LabState ou fonte após hardlink bloqueia antes de tornar destino elegível', async t => {
  for (const scenario of ['state', 'source']) await t.test(scenario, async child => {
    const s = await scratch(child), original = fs.link.bind(fs);
    const mock = child.mock.method(fs, 'link', async (source, target) => {
      await original(source, target);
      if (scenario === 'state') await fs.writeFile(path.join(s.config.stateDirectory, 'synthetic-race'), 'SYNTHETIC', { mode: 0o600 });
      else s.h.record.ownerPermissionId = 'synthetic-changed-owner';
    });
    await assert.rejects(s.run()); mock.mock.restore();
    await assert.rejects(readPrivateJson(s.config.approvalFile), { code: 'HARDLINK_FILE_FORBIDDEN' });
    assert.ok((await fs.readdir(path.dirname(s.config.approvalFile))).includes(PREPARE_LOCK));
  });
});

test('P21 — 67 arquivos protegidos do baseline d2ec6bb e todos os testes anteriores permanecem intactos', async () => {
  const allowed = new Set(['tools/live-experience-local/package.json', 'tools/live-experience-local/README.md', 'tools/live-experience-local/GOOGLE_DRIVE_LAB.md']);
  const recorded = JSON.parse(await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/test/preservation-baseline.json'), 'utf8')).files;
  const { stdout } = await execFileAsync('git', ['ls-tree', '-r', '--name-only', '-z', 'd2ec6bb'], { cwd: REPOSITORY });
  let checked = 0;
  for (const name of stdout.split('\0').filter(Boolean)) {
    if (allowed.has(name)) continue;
    const baseline = await execFileAsync('git', ['show', 'd2ec6bb:' + name], { cwd: REPOSITORY, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(REPOSITORY, name))).digest('hex'), recorded[name] ?? createHash('sha256').update(baseline.stdout).digest('hex'), name);
    checked++;
  }
  assert.equal(checked, 67);
  const source = await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/src/drive-lab-approval.mjs'), 'utf8');
  assert.ok(!/\b(?:authorizedSession|loadPrivateDriveIdentity|loadGoogleSdk)\s*\(|fs\.rename\s*\(|\.(?:about|files|permissions)\./.test(source));
});
