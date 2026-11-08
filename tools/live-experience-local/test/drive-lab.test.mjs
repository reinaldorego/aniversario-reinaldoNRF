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
import { REPOSITORY } from '../src/drive-token-store.mjs';
import { DriveLabState, LAB_STATE_FILE, LAB_CLAIM_FILE, LAB_LOCK_FILE, validateLabApproval, labDirectoryBinding } from '../src/drive-lab-state.mjs';
import { LAB_TAG, LAB_FOLDER_NAME, LAB_FOLDER_MIME, LAB_METADATA_FIELDS } from '../src/drive-lab.mjs';
import { LAB_COMMANDS, parseLabArguments, runLabCommand, main } from '../src/drive-lab-cli.mjs';
import { labHarness, syntheticApproval, LAB_NOW } from './drive-lab-fixtures.mjs';
import { providerFailure, FAKE_CREDENTIALS, fakeTokens } from './drive-oauth-fixtures.mjs';
const execFileAsync = promisify(execFile);

async function privateScratch(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-lab-test-'));
  if (process.platform === 'win32') {
    const script = ["$ErrorActionPreference='Stop'", '$p=$env:LEVEL_LAB_TEST_SCRATCH',
      '$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$acl=New-Object System.Security.AccessControl.DirectorySecurity', '$acl.SetOwner($me)', '$acl.SetAccessRuleProtection($true,$false)',
      "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
      '$acl.AddAccessRule($rule)', 'Set-Acl -LiteralPath $p -AclObject $acl'].join(';');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, env: { ...process.env, LEVEL_LAB_TEST_SCRATCH: directory }, timeout: 10000 });
  } else await fs.chmod(directory, 0o700);
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('level-xviii-lab-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('L01 — dry-run padrão e explícito não leem configuração, SDK, segredos, filesystem nem abrem rede/socket', async t => {
  const forbidden = () => { throw new Error('SYNTHETIC_SIDE_EFFECT_FORBIDDEN'); };
  for (const method of ['open', 'readFile', 'writeFile', 'lstat', 'realpath', 'readdir', 'mkdir', 'unlink', 'rename']) t.mock.method(fs, method, forbidden);
  t.mock.method(http, 'createServer', forbidden); t.mock.method(http, 'request', forbidden); t.mock.method(https, 'request', forbidden);
  t.mock.method(net, 'createServer', forbidden); t.mock.method(net, 'connect', forbidden); t.mock.method(globalThis, 'fetch', forbidden);
  const env = new Proxy({}, { get: forbidden });
  const injected = Object.fromEntries(['loadApproval', 'makeState', 'loadSdk', 'loadCredentials', 'makeTokenStore', 'now'].map(key => [key, forbidden]));
  for (const command of LAB_COMMANDS) {
    for (const flags of [[], ['--dry-run']]) {
      const args = parseLabArguments([command, ...flags]); assert.equal(args.execute, false);
      const result = await runLabCommand({ ...args, env }, injected);
      assert.equal(result.effects, 'NONE'); assert.equal(result.publicationChanged, false); assert.equal(result.scope, DRIVE_SCOPE);
    }
    assert.deepEqual(parseLabArguments([command, '--execute']), { command, execute: true });
  }
});

test('L02 — parse estrito, destino editorial, parâmetros de scope e saída privada são recusados sem eco', async () => {
  for (const args of [[], ['unknown'], ['lab-create', '--parent=01_ORIGINAIS'], ['lab-create', '--folder=02_PUBLICAR_NA_GALERIA'],
    ['lab-inspect', '--folder=03_RETIRADAS'], ['lab-create', '--scope=drive'], ['lab-create', '--execute', '--dry-run'],
    ['lab-create', '--execute', '--execute'], ['lab-inspect', '--url=https://example.invalid/SYNTHETIC-PRIVATE']]) {
    const output = [];
    assert.equal(await main(args, {}, { log: value => output.push(value), error: value => output.push(value) }), 1);
    assert.ok(!output.join('').includes('SYNTHETIC-PRIVATE')); assert.ok(!output.join('').includes('https://'));
  }
});

test('L03 — uma única pasta na raiz, marcador próprio e nenhuma alteração de permissões ou mídia', async () => {
  const h = labHarness(), result = await h.run();
  assert.equal(h.creates, 1); assert.equal(h.stateStore.claims, 1); assert.equal(h.stateStore.state.creation.phase, 'CREATED');
  const create = h.calls.find(call => call.method === 'create');
  assert.deepEqual(create.params.requestBody.parents, ['root']); assert.equal(create.params.requestBody.mimeType, LAB_FOLDER_MIME);
  assert.equal(create.params.requestBody.name, LAB_FOLDER_NAME); assert.equal(create.params.requestBody.appProperties.levelXVIIILab, LAB_TAG);
  assert.deepEqual(Object.keys(create.params).sort(), ['fields', 'requestBody']);
  assert.equal(create.params.fields, LAB_METADATA_FIELDS);
  assert.ok(h.calls.every(call => call.options.retry === false && call.options.signal instanceof AbortSignal));
  assert.ok(h.calls.every(call => call.group !== 'permissions' || call.method === 'list'));
  assert.equal(result.descendantVisibility, 'NOT_PROVEN'); assert.equal(result.editorialAccess, 'NOT_PROVEN'); assert.equal(result.mediaTransferred, false);
  for (const value of [h.folder().id, h.root.id, h.approval.ownerPermissionId, h.approval.operationId, h.approval.clientBinding]) {
    assert.ok(!JSON.stringify(result).includes(value));
  }
});

test('L04 — replay, autorização nova para mesma criação e processos concorrentes não repetem files.create', async () => {
  const h = labHarness();
  const concurrent = await Promise.allSettled([h.run(), h.run()]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(h.creates, 1);
  await assert.rejects(h.run(), { code: 'LAB_CREATE_ALREADY_RESERVED' });
  await assert.rejects(h.run('lab-create', { approval: syntheticApproval('lab-create', { approvalId: 'd'.repeat(64) }) }), { code: 'LAB_CREATE_ALREADY_RESERVED' });
  assert.equal(h.creates, 1); assert.equal(h.factoryCalls, 1);
});

test('L05 — aprovação estrita, consumível, expiração, scope, limites e destino editorial', async t => {
  const cases = {
    missing: value => { delete value.ownerPermissionId; }, expired: value => { value.expiresAt = LAB_NOW; },
    long: value => { value.expiresAt = LAB_NOW + 3600001; }, scope: value => { value.scope += ' https://www.googleapis.com/auth/drive.readonly'; },
    action: value => { value.action = 'lab-inspect'; }, parent: value => { value.parentId = '02_PUBLICAR_NA_GALERIA'; },
    operation: value => { value.operationId = "' or true"; }, noHumanApproval: value => { value.kind = 'UNKNOWN'; },
    fileOnCreate: value => { value.files = [{ id: 'synthetic-file', bytes: 1, sha256: 'a'.repeat(64) }]; },
    binding: value => { value.stateBinding = 'f'.repeat(64); }
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async () => {
    const h = labHarness(), approval = structuredClone(h.approval); mutate(approval);
    await assert.rejects(h.run('lab-create', { approval })); assert.equal(h.factoryCalls, 0); assert.equal(h.creates, 0); assert.equal(h.stateStore.writes, 0);
  });
  const files = [1, 2, 3].map(n => ({ id: 'synthetic-file-' + n, bytes: 1024, sha256: 'a'.repeat(64) }));
  for (const entries of [files, [files[0], files[0]], [{ ...files[0], bytes: 65537 }], [{ ...files[0], id: '../unsafe' }], [{ ...files[0], sha256: 'bad' }]]) {
    assert.throws(() => validateLabApproval(syntheticApproval('lab-inspect', { files: entries }), 'lab-inspect', DRIVE_SCOPE, LAB_NOW));
  }
});

test('L06 — 401/403/404/429/5xx antes e durante criação falham fechado sem retry', async t => {
  for (const status of [401, 403, 404, 429, 500, 503, 599]) for (const stage of ['preflight', 'create', 'verification']) {
    await t.test(status + '-' + stage, async () => {
      const h = labHarness();
      h.override = (group, method) => {
        if (stage === 'preflight' || stage === 'create' && method === 'create' || stage === 'verification' && h.creates > 0) throw providerFailure(status);
      };
      await assert.rejects(h.run(), error => !JSON.stringify(error).includes('SYNTHETIC-PRIVATE'));
      assert.equal(h.calls.filter(call => call.method === 'create').length, stage === 'preflight' ? 0 : 1);
      assert.equal(h.stateStore.state.creation.phase, stage === 'preflight' ? 'BLOCKED' : 'UNCERTAIN');
      const count = h.calls.length; await assert.rejects(h.run()); assert.equal(h.calls.length, count);
    });
  }
});

test('L07 — timeout e resposta perdida consomem autorização; reconciliação somente leitura pode confirmar a pasta', async t => {
  for (const kind of ['timeout', 'late-response', 'lost-response', 'partial-response']) await t.test(kind, async () => {
    const h = labHarness(); let signal, lateResponse;
    h.afterCreate = (_folder, options) => {
      signal = options.signal;
      if (kind === 'timeout') return new Promise(() => {});
      if (kind === 'late-response') return new Promise(resolve => { lateResponse = () => resolve({ data: structuredClone(h.folder()) }); });
      if (kind === 'lost-response') throw providerFailure(503);
      return { data: { id: 'synthetic-lab-folder' } };
    };
    await assert.rejects(h.run('lab-create', { timeoutMs: 15 }));
    assert.equal(h.creates, 1); assert.equal(h.stateStore.state.creation.phase, 'UNCERTAIN');
    if (['timeout', 'late-response'].includes(kind)) assert.equal(signal.aborted, true);
    if (lateResponse) { lateResponse(); await Promise.resolve(); }
    await assert.rejects(h.run()); delete h.afterCreate;
    const result = await h.run('lab-inspect'); assert.equal(result.status, 'LAB_METADATA_INSPECTED'); assert.equal(h.creates, 1);
    await assert.rejects(h.run('lab-inspect'), { code: 'LAB_APPROVAL_CONSUMED' });
    await assert.rejects(h.run()); assert.equal(h.creates, 1);
  });
});

test('L22 — inspeção: falhas HTTP e timeout em metadados, listagem ou permissões não viram pasta vazia', async t => {
  for (const stage of ['get', 'list', 'permissions']) for (const failure of [401, 403, 404, 429, 500, 'timeout']) {
    await t.test(stage + '-' + failure, async () => {
      const h = labHarness(); await h.run(); let signal;
      h.override = (group, method, _params, options) => {
        if (stage === 'permissions' ? group === 'permissions' : group === 'files' && method === stage) {
          signal = options.signal;
          if (failure === 'timeout') return new Promise(() => {});
          throw providerFailure(failure);
        }
      };
      await assert.rejects(h.run('lab-inspect', { timeoutMs: 10 }));
      assert.equal(h.creates, 1); assert.equal(h.stateStore.state.creation.phase, 'UNCERTAIN');
      if (failure === 'timeout') assert.equal(signal.aborted, true);
      await assert.rejects(h.run('lab-inspect'), { code: 'LAB_APPROVAL_CONSUMED' });
    });
  }
});

test('L23 — paginação de arquivos é limitada, completa e sem cursores ou IDs repetidos', async t => {
  for (const condition of ['valid', 'repeat', 'many', 'invalid-token', 'duplicate-id']) await t.test(condition, async () => {
    const h = labHarness(); await h.run();
    h.override = (group, method, params) => {
      if (group !== 'files' || method !== 'list' || !params.q.includes('levelXVIIILabOperation')) return;
      if (condition === 'duplicate-id') return { data: { files: [h.folder(), h.folder()], incompleteSearch: false } };
      if (condition === 'invalid-token') return { data: { files: [], incompleteSearch: false, nextPageToken: null } };
      if (!params.pageToken) return { data: { files: [], incompleteSearch: false, nextPageToken: 'synthetic-page' } };
      if (condition === 'repeat') return { data: { files: [], incompleteSearch: false, nextPageToken: params.pageToken } };
      if (condition === 'many') return { data: { files: [], incompleteSearch: false, nextPageToken: params.pageToken + 'x' } };
      return { data: { files: [structuredClone(h.folder())], incompleteSearch: false } };
    };
    if (condition === 'valid') await h.run('lab-inspect'); else await assert.rejects(h.run('lab-inspect'));
    assert.equal(h.creates, 1);
  });
});

test('L24 — aprovação vencida durante preparação bloqueia antes de files.create', async () => {
  const h = labHarness(); let clock = LAB_NOW, roots = 0;
  h.override = (_group, method, params) => { if (method === 'get' && params.fileId === 'root' && ++roots === 2) clock = h.approval.expiresAt; };
  await assert.rejects(h.run('lab-create', { now: () => clock }), { code: 'LAB_APPROVAL_REJECTED' });
  assert.equal(h.creates, 0); assert.equal(h.stateStore.state.creation.phase, 'BLOCKED');
  await assert.rejects(h.run()); assert.equal(h.creates, 0);
});

test('L25 — envelope OAuth ampliado ou expirado é recusado pela nova CLI sem login automático', async t => {
  for (const condition of ['scope', 'expired', 'missing']) await t.test(condition, async () => {
    const h = labHarness(), injected = h.cli();
    if (condition === 'scope') injected.store.value.tokens.scope += ' https://www.googleapis.com/auth/drive';
    if (condition === 'expired') injected.store.value.refreshTokenExpiresAt = LAB_NOW;
    if (condition === 'missing') injected.store.value = null;
    await assert.rejects(runLabCommand({ command: 'lab-create', execute: true, env: {} }, injected));
    assert.equal(h.calls.length, 0); assert.equal(injected.auth.exchanges.length, 0); assert.equal(injected.opened, 0);
  });
});

test('L08 — resultados incompletos, duplicata remota e inventário alterado bloqueiam', async t => {
  for (const condition of ['missing-data', 'missing-files', 'incomplete', 'missing-incomplete', 'duplicate-folder', 'root-drift', 'folder-drift', 'unknown-file']) {
    await t.test(condition, async () => {
      const h = labHarness(); await h.run(); let metadataReads = 0;
      h.override = (group, method, params) => {
        if (group === 'files' && method === 'list' && params.q.includes('levelXVIIILabOperation')) {
          if (condition === 'missing-data') return {};
          if (condition === 'missing-files') return { data: { incompleteSearch: false } };
          if (condition === 'incomplete') return { data: { files: [], incompleteSearch: true } };
          if (condition === 'missing-incomplete') return { data: { files: [] } };
          if (condition === 'duplicate-folder') return { data: { files: [structuredClone(h.folder()), structuredClone(h.folder())], incompleteSearch: false } };
        }
        if (method === 'get' && params.fileId === (condition === 'root-drift' ? 'root' : h.folder().id) && ++metadataReads === 2) {
          if (condition === 'root-drift') h.root.version = '2';
          if (condition === 'folder-drift') h.folder().version = '2';
        }
        if (condition === 'unknown-file' && method === 'list' && params.q.includes('in parents')) return { data: { files: [{ id: 'synthetic-unknown' }], incompleteSearch: false } };
      };
      await assert.rejects(h.run('lab-inspect')); assert.equal(h.creates, 1); assert.equal(h.stateStore.state.creation.phase, 'UNCERTAIN');
    });
  }
});

test('L09 — ACL insegura ou indeterminada na raiz, pasta ou arquivo é recusada', async t => {
  const conditions = ['anyone', 'domain', 'group', 'third-reader', 'third-writer', 'wrong-owner', 'missing-permissions', 'missing-ids',
    'cannot-share', 'deleted', 'pending-owner', 'unknown-view', 'shared', 'inherited-unknown'];
  for (const target of ['root', 'folder', 'file']) for (const condition of conditions) await t.test(target + '-' + condition, async () => {
    const h = labHarness(); await h.run(); const entry = h.addFixture();
    const resource = target === 'root' ? h.root : target === 'folder' ? h.folder() : h.resources.get(entry.id);
    const permission = resource.permissions[0];
    if (['anyone', 'domain', 'group'].includes(condition)) permission.type = condition;
    if (condition === 'third-reader' || condition === 'third-writer') resource.permissions.push({ id: 'synthetic-third', type: 'user', role: condition.slice(6), deleted: false });
    if (condition === 'wrong-owner') resource.owners[0].permissionId = 'synthetic-other-owner';
    if (condition === 'missing-permissions') delete resource.permissions;
    if (condition === 'missing-ids') delete resource.permissionIds;
    if (condition === 'cannot-share') resource.capabilities.canShare = false;
    if (condition === 'deleted') permission.deleted = true;
    if (condition === 'pending-owner') permission.pendingOwner = true;
    if (condition === 'unknown-view') permission.view = 'metadata';
    if (condition === 'shared') resource.shared = true;
    if (condition === 'inherited-unknown') permission.permissionDetails = [{ inherited: true, inheritedFrom: 'synthetic-unverified-ancestor', permissionType: 'file', role: 'owner' }];
    await assert.rejects(h.run('lab-inspect', { approval: syntheticApproval('lab-inspect', { files: [entry] }) }));
    assert.equal(h.creates, 1); assert.equal(h.stateStore.state.creation.phase, 'UNCERTAIN');
  });
});

test('L10 — ACL paginada completa é comparada a metadados; cursor repetido, página falha e ACL divergente bloqueiam', async t => {
  for (const condition of ['valid-pages', 'repeated', 'too-many-pages', 'page-error', 'missing-page', 'mismatch']) await t.test(condition, async () => {
    const h = labHarness(); await h.run();
    h.override = (group, method, params) => {
      if (group !== 'permissions' || method !== 'list') return;
      if (condition === 'mismatch') return { data: { permissions: [{ ...h.root.permissions[0], pendingOwner: false }] } };
      if (!params.pageToken) return { data: { permissions: [], nextPageToken: 'synthetic-page-1' } };
      if (condition === 'page-error') throw providerFailure(403);
      if (condition === 'missing-page') return { data: {} };
      if (condition === 'repeated') return { data: { permissions: [], nextPageToken: 'synthetic-page-1' } };
      if (condition === 'too-many-pages') return { data: { permissions: [], nextPageToken: params.pageToken + 'x' } };
      return { data: { permissions: structuredClone(h.root.permissions) } };
    };
    if (condition === 'valid-pages') assert.equal((await h.run('lab-inspect')).status, 'LAB_METADATA_INSPECTED');
    else await assert.rejects(h.run('lab-inspect'));
    assert.equal(h.creates, 1);
  });
});

test('L11 — até dois PNGs sintéticos são inspecionados por arquivo; acesso à pasta não autoriza filhos', async t => {
  for (const count of [0, 1, 2]) await t.test('fixtures-' + count, async () => {
    const h = labHarness(); await h.run(); const files = Array.from({ length: count }, (_, index) => h.addFixture(index + 1));
    const result = await h.run('lab-inspect', { approval: syntheticApproval('lab-inspect', { files }) });
    assert.equal(result.verifiedSyntheticFiles, count); assert.equal(result.descendantVisibility, 'NOT_PROVEN');
    assert.ok(h.calls.every(call => !call.params.alt));
  });
  for (const condition of ['unauthorized', 'hidden', 'missing-tag', 'editorial-parent', 'shortcut', 'drive', 'trashed', 'size', 'hash', 'version']) await t.test(condition, async () => {
    const h = labHarness(); await h.run(); const entry = h.addFixture(), file = h.resources.get(entry.id);
    if (condition === 'unauthorized') file.isAppAuthorized = false;
    if (condition === 'hidden') h.hidden.add(file.id);
    if (condition === 'missing-tag') file.appProperties = {};
    if (condition === 'editorial-parent') file.parents = ['02_PUBLICAR_NA_GALERIA'];
    if (condition === 'shortcut') file.shortcutDetails = { targetId: 'synthetic-personal-photo' };
    if (condition === 'drive') file.driveId = 'synthetic-shared-drive';
    if (condition === 'trashed') file.trashed = true;
    if (condition === 'size') file.size = '0';
    if (condition === 'hash') delete file.sha256Checksum;
    if (condition === 'version') delete file.version;
    await assert.rejects(h.run('lab-inspect', { approval: syntheticApproval('lab-inspect', { files: [entry] }) }));
    assert.ok(!h.calls.some(call => call.params.fileId === '02_PUBLICAR_NA_GALERIA' || call.params.alt));
  });
});

test('L12 — pasta com parent editorial ou proveniência divergente nunca é adotada', async t => {
  for (const condition of ['parent', 'marker', 'operation', 'authorized', 'name', 'mime', 'id']) await t.test(condition, async () => {
    const h = labHarness(); await h.run();
    if (condition === 'parent') h.folder().parents = ['01_ORIGINAIS'];
    if (condition === 'marker') delete h.folder().appProperties.levelXVIIILab;
    if (condition === 'operation') h.folder().appProperties.levelXVIIILabOperation = 'd'.repeat(32);
    if (condition === 'authorized') h.folder().isAppAuthorized = false;
    if (condition === 'name') h.folder().name = '03_RETIRADAS';
    if (condition === 'mime') h.folder().mimeType = 'image/png';
    if (condition === 'id') h.stateStore.state.creation.folderId = 'synthetic-unrelated-folder';
    await assert.rejects(h.run('lab-inspect')); assert.equal(h.creates, 1);
  });
});

test('L13 — pasta de laboratório previamente visível bloqueia nova criação mesmo em estado local novo', async () => {
  const h = labHarness(); await h.run(); const second = labHarness();
  second.resources.set(h.folder().id, structuredClone(h.folder()));
  await assert.rejects(second.run(), { code: 'LAB_EXISTING_RESOURCE' }); assert.equal(second.creates, 0);
});

test('L14 — falhas de persistência antes/depois do envio não liberam criação', async t => {
  for (const stage of ['claim', 'intent', 'receipt', 'final']) await t.test(stage, async () => {
    const h = labHarness();
    h.stateStore.failSave = (state, count) => stage === 'claim' && count === 1 || stage === 'intent' && count === 2 ||
      stage === 'receipt' && state.creation.folderId !== null || stage === 'final' && state.creation.phase === 'CREATED';
    await assert.rejects(h.run()); delete h.stateStore.failSave;
    await assert.rejects(h.run()); assert.ok(h.creates <= 1);
    if (stage === 'claim' || stage === 'intent') assert.equal(h.creates, 0);
    else { assert.equal(h.creates, 1); await h.run('lab-inspect'); assert.equal(h.creates, 1); }
  });
});

test('L15 — CLI usa sessão existente, exige aprovação e vínculo de cliente, sem login ou scope novo', async () => {
  const h = labHarness(), injected = h.cli();
  const result = await runLabCommand({ command: 'lab-create', execute: true, env: {} }, injected);
  assert.equal(result.scope, DRIVE_SCOPE); assert.equal(injected.opened, 0); assert.equal(injected.callbacks, 0);
  assert.equal(injected.auth.exchanges.length, 0); assert.equal(injected.store.saves, 0);
  const missing = h.cli(); missing.loadApproval = async () => { throw providerFailure(403); };
  await assert.rejects(runLabCommand({ command: 'lab-create', execute: true, env: {} }, missing));
  const other = labHarness(), wrong = other.cli(); wrong.loadCredentials = async () => ({ client_id: 'synthetic-other.apps.googleusercontent.com' });
  await assert.rejects(runLabCommand({ command: 'lab-create', execute: true, env: {} }, wrong), { code: 'OAUTH_CLIENT_MISMATCH' });
  assert.equal(other.creates, 0);
});

test('L16 — erros da CLI não imprimem tokens, paths, IDs, URL OAuth ou detalhes do provedor', async () => {
  const h = labHarness(); const injected = h.cli(); injected.loadCredentials = async () => { throw providerFailure(401); };
  const output = [];
  // Programmatic mocked dispatch only: no real CLI --execute process is launched.
  const code = await main(['lab-create', '--execute'], {}, { log: value => output.push(value), error: value => output.push(value) }, injected);
  assert.equal(code, 1); assert.deepEqual(output, ['{"error":"DRIVE_HTTP_401"}']);
});

test('L17 — diretório privado real: exclusão entre processos, persistência e consumo após reinício', async t => {
  const directory = await privateScratch(t), store = new DriveLabState(directory);
  const moduleUrl = pathToFileURL(path.join(REPOSITORY, 'tools/live-experience-local/src/drive-lab-state.mjs')).href;
  await store.withLock(async () => {
    await assert.rejects(new DriveLabState(directory).withLock(async () => {}), { code: 'LAB_LOCKED_OR_UNAVAILABLE' });
    const script = "import { DriveLabState } from " + JSON.stringify(moduleUrl) + "; try { await new DriveLabState(process.env.LEVEL_LAB_TEST_SCRATCH).withLock(async()=>{}); process.exitCode=1; } catch(e) { process.stdout.write(e.code); }";
    const child = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], { windowsHide: true,
      env: { ...process.env, LEVEL_LAB_TEST_SCRATCH: directory }, timeout: 15000 });
    assert.equal(child.stdout, 'LAB_LOCKED_OR_UNAVAILABLE');
  });
  const h = labHarness(), approval = { ...h.approval, stateBinding: labDirectoryBinding(directory) };
  await h.run('lab-create', { stateStore: store, approval });
  await assert.rejects(h.run('lab-create', { stateStore: new DriveLabState(directory), approval }), { code: 'LAB_CREATE_ALREADY_RESERVED' });
  assert.equal(h.creates, 1);
  assert.deepEqual((await fs.readdir(directory)).sort(), [LAB_CLAIM_FILE, LAB_STATE_FILE].sort());
  await h.run('lab-inspect', { stateStore: new DriveLabState(directory), approval: syntheticApproval('lab-inspect', { stateBinding: labDirectoryBinding(directory) }) });
  assert.equal(h.creates, 1);
});

test('L18 — estado ausente/corrompido, claim isolado, lock órfão e temporário não são recuperados automaticamente', async t => {
  const directory = await privateScratch(t), store = new DriveLabState(directory);
  await fs.writeFile(path.join(directory, LAB_CLAIM_FILE), '{}', { mode: 0o600 });
  await assert.rejects(store.withLock(async () => {}), { code: 'LAB_RECONCILIATION_REQUIRED' });
  await fs.writeFile(path.join(directory, LAB_STATE_FILE), '{invalid', { mode: 0o600 });
  await assert.rejects(store.withLock(async () => {}), { code: 'PRIVATE_JSON_INVALID' });
  await fs.writeFile(path.join(directory, LAB_LOCK_FILE), 'SYNTHETIC-ORPHAN', { mode: 0o600 });
  await assert.rejects(store.withLock(async () => {}), { code: 'LAB_LOCKED_OR_UNAVAILABLE' });
  const orphan = await privateScratch(t); await fs.writeFile(path.join(orphan, LAB_STATE_FILE + '.synthetic.tmp'), '{}', { mode: 0o600 });
  await assert.rejects(new DriveLabState(orphan).withLock(async () => {}), { code: 'LAB_DIRECTORY_NOT_DEDICATED' });
});

test('L19 — estado dentro do repositório, paths relativos, hardlinks e ACL aberta são recusados', async t => {
  await assert.rejects(new DriveLabState(REPOSITORY).withLock(async () => {}), { code: 'PATH_MUST_BE_OUTSIDE_REPOSITORY' });
  await assert.rejects(new DriveLabState('relative').withLock(async () => {}));
  const directory = await privateScratch(t), file = path.join(directory, LAB_CLAIM_FILE);
  await fs.writeFile(file, '{}', { mode: 0o600 }); await fs.link(file, path.join(directory, LAB_STATE_FILE));
  await assert.rejects(new DriveLabState(directory).withLock(async () => {}), { code: 'HARDLINK_FILE_FORBIDDEN' });
  const unsafe = await privateScratch(t);
  if (process.platform === 'win32') await execFileAsync('icacls.exe', [unsafe, '/grant', '*S-1-1-0:R'], { windowsHide: true });
  else await fs.chmod(unsafe, 0o755);
  await assert.rejects(new DriveLabState(unsafe).withLock(async () => {}), { code: 'PRIVATE_PERMISSIONS_REQUIRED' });
});

test('L20 — regressão: todos os arquivos rastreados de b97483f preservados salvo os três autorizados', async () => {
  const allowed = new Set(['tools/live-experience-local/package.json', 'tools/live-experience-local/README.md', 'tools/live-experience-local/GOOGLE_DRIVE_OAUTH.md']);
  const recorded = JSON.parse(await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/test/preservation-baseline.json'), 'utf8')).files;
  const { stdout } = await execFileAsync('git', ['ls-tree', '-r', '--name-only', '-z', 'b97483f'], { cwd: REPOSITORY });
  for (const name of stdout.split('\0').filter(Boolean)) {
    if (allowed.has(name)) continue;
    // The original 31-file baseline records actual mixed LF/CRLF checkout bytes. Later files use LF Git blobs.
    const baseline = await execFileAsync('git', ['show', 'b97483f:' + name], { cwd: REPOSITORY, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    const current = await fs.readFile(path.join(REPOSITORY, name));
    assert.equal(createHash('sha256').update(current).digest('hex'), recorded[name] ?? createHash('sha256').update(baseline.stdout).digest('hex'), name);
  }
  for (const name of ['drive-lab-cli.mjs', 'drive-lab.mjs', 'drive-lab-state.mjs']) {
    const source = await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/src', name), 'utf8');
    assert.ok(!/from ['"]\.\/(engine|drive-source|storage|http|cli)\.mjs/.test(source));
    assert.ok(!/permissions\.(create|update|delete)|files\.(update|delete)|alt:\s*['"]media/.test(source));
  }
});

test('L21 — SDK oficial com transporte mockado não repete create em 401/403/429/5xx', async t => {
  const forbidden = () => { throw new Error('SYNTHETIC_NETWORK_FORBIDDEN'); };
  t.mock.method(https, 'request', forbidden); t.mock.method(globalThis, 'fetch', forbidden);
  const sdk = await loadGoogleSdk();
  for (const status of [401, 403, 429, 503]) await t.test(String(status), async () => {
    const auth = sdk.oauth(FAKE_CREDENTIALS); auth.forceRefreshOnFailure = false;
    auth.setCredentials({ ...fakeTokens(), expiry_date: Date.now() + 3600000 });
    auth.refreshAccessToken = forbidden;
    let requests = 0;
    auth.transporter.request = async options => { requests++; assert.equal(options.retry, false); throw providerFailure(status); };
    await assert.rejects(sdk.drive(auth).files.create({ requestBody: { name: LAB_FOLDER_NAME, mimeType: LAB_FOLDER_MIME, parents: ['root'] }, fields: 'id' },
      { retry: false, timeout: 15000 }));
    assert.equal(requests, 1);
  });
});
