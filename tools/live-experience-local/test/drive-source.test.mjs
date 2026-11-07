import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { Simulator } from '../src/engine.mjs';
import { DriveSource } from '../src/drive-source.mjs';
import { processSyntheticPng, sha256 } from '../src/png.mjs';
import { startHttp } from '../src/http.mjs';
import { MockDriveClient, EDITORIAL, ROOT, PUBLISHERS, userPermission, fixtureFile } from './drive-fixtures.mjs';

const sourceFor = (client, extra = {}) => new DriveSource({ client, folderId: EDITORIAL, publisherPermissionIds: PUBLISHERS, timeoutMs: 30, ...extra });
async function setup(t, { client = new MockDriveClient(), processor } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-drive-test-'));
  let time = 100000;
  const s = { root, client, clock: () => time, advance: () => { time += 11; } };
  s.source = sourceFor(client);
  s.engine = await Simulator.open({ root, source: s.source, stableMs: 10, freshMs: 1000, clock: s.clock, ...(processor ? { processor } : {}) });
  t.after(async () => {
    if (s.engine?.store.lock) await s.engine.close();
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('level-xviii-drive-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await s.engine.scan();
  if (s.engine.state.permissions === 'allowed') await s.engine.pause(false);
  return s;
}
async function publish(s) { await s.engine.cycle(); s.advance(); await s.engine.cycle(); }
const first = s => s.engine.state.sources[0];
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, response => {
    let body = ''; response.on('data', bytes => { body += bytes; });
    response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});
function gate() {
  let release, enter;
  const ready = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  return { ready, release: () => release(), processor: async bytes => { enter(); await held; return processSyntheticPng(bytes); } };
}

test('D01 — pasta válida, duas identidades opacas e revalidação íntegra', async t => {
  const client = new MockDriveClient(); client.add();
  const s = await setup(t, { client }); await publish(s);
  assert.equal(first(s).state, 'PUBLISHED'); assert.equal(s.engine.snapshot().photos.length, 1);
  assert.equal(s.engine.state.processed, 1);
  assert.ok(s.engine.state.sourceCheckpoint.sequence >= 2);
  assert.equal(s.engine.state.audit.find(a => a.action === 'AUTO_PUBLICATION').humanActor, null);
  await assert.rejects(s.engine.setPermissions('allowed'), /SOURCE_CONTROLS_PERMISSIONS/);
});

test('D02 — terceiro escritor/owner/leitor e e-mail forjado não autorizam', async t => {
  for (const role of ['owner', 'writer', 'organizer', 'fileOrganizer', 'reader', 'commenter']) await t.test(role, async sub => {
    const client = new MockDriveClient(); client.add();
    client.acls.get(EDITORIAL).push(userPermission('mock-third-person', role, { displayName: 'Organizador', emailAddress: 'organizador@example.invalid' }));
    const s = await setup(sub, { client }); await publish(s);
    assert.equal(s.engine.snapshot().photos.length, 0); assert.equal(s.engine.state.permissions, 'denied');
    assert.equal(s.engine.state.processed, 0);
  });
});

test('D03 — anyone, group e domain são negados inclusive como leitores', async t => {
  for (const type of ['anyone', 'group', 'domain']) await t.test(type, async sub => {
    const client = new MockDriveClient(); client.add();
    client.acls.get(EDITORIAL).push({ id: 'mock-sharing', type, role: 'reader' });
    const s = await setup(sub, { client }); await publish(s);
    assert.equal(s.engine.state.permissions, 'denied'); assert.equal(s.engine.snapshot().photos.length, 0);
  });
});

test('D04 — ACL insegura herdada/ancestral/própria e origem ambígua bloqueiam', async t => {
  for (const location of ['ancestor', 'inherited-file', 'unknown-inheritance']) await t.test(location, async sub => {
    const client = new MockDriveClient(); client.add();
    if (location === 'ancestor') client.acls.get(ROOT).push(userPermission('mock-third'));
    else if (location === 'inherited-file') client.acls.get('mock-image-a').push(userPermission('mock-third', 'writer', {
      permissionDetails: [{ inherited: true, inheritedFrom: ROOT, permissionType: 'file', role: 'writer' }]
    }));
    else client.acls.get('mock-image-a')[1].permissionDetails[0].inheritedFrom = 'mock-unknown-ancestor';
    const s = await setup(sub, { client }); await publish(s);
    assert.equal(s.engine.snapshot().photos.length, 0); assert.notEqual(s.engine.state.permissions, 'allowed');
  });
});

test('D05 — visibilidade, campos, papéis e ACL indisponíveis falham fechado', async t => {
  for (const condition of ['visibility', 'partial', '403', 'missing-writer', 'unknown-role', 'cycle']) await t.test(condition, async sub => {
    const client = new MockDriveClient(); client.add();
    if (condition === 'visibility') client.aclVisibility = 'indeterminate';
    if (condition === 'partial') client.enqueue('permissions.list', {});
    if (condition === '403') client.enqueue('permissions.list', 403);
    if (condition === 'missing-writer') client.acls.get(EDITORIAL)[1].role = 'reader';
    if (condition === 'unknown-role') client.acls.get(EDITORIAL)[1].role = 'super-admin';
    if (condition === 'cycle') client.records.get(ROOT).metadata.parents = [EDITORIAL];
    const s = await setup(sub, { client });
    assert.equal(s.engine.state.sourceCheckpoint, undefined, 'failed initial scan must not commit checkpoint');
    await publish(s);
    assert.equal(s.engine.state.paused, true); assert.equal(s.engine.snapshot().photos.length, 0);
    if (condition !== 'partial' && condition !== '403') assert.equal(s.engine.state.sourceCheckpoint, undefined);
  });
});

test('D06 — paginação files/permissions, query exata e filtro defensivo', async t => {
  const client = new MockDriveClient(); client.add(); client.add('mock-image-b', 2); client.add('mock-image-c', 3);
  client.aclPageSize = 1;
  const outside = fixtureFile('mock-outside'); outside.metadata.parents = ['mock-other-folder'];
  const trashed = fixtureFile('mock-trashed'); trashed.metadata.trashed = true;
  client.injectedRows = [outside.metadata, trashed.metadata];
  const s = await setup(t, { client }); await publish(s);
  assert.equal(s.engine.snapshot().photos.length, 3);
  const pages = client.calls.filter(c => c.operation === 'files.list');
  assert.ok(pages.some(c => c.params.pageToken === '2'));
  assert.ok(pages.every(c => c.params.q === "'" + EDITORIAL + "' in parents and trashed = false"));
  assert.ok(client.calls.some(c => c.operation === 'permissions.list' && c.params.pageToken === '1'));
  assert.ok(!client.calls.some(c => c.operation === 'files.media' && ['mock-outside', 'mock-trashed'].includes(c.params.fileId)));
});

test('D07 — token repetido/inválido ou resposta parcial não avança checkpoint', async t => {
  for (const condition of ['repeated', 'invalid', 'missing-files', 'missing-parents', 'missing-incompleteSearch']) await t.test(condition, async sub => {
    const s = await setup(sub); const data = s.client.add().metadata;
    if (condition === 'repeated') s.client.enqueue('files.list',
      { files: [data], incompleteSearch: false, nextPageToken: 'same' },
      { files: [], incompleteSearch: false, nextPageToken: 'same' });
    if (condition === 'invalid') s.client.enqueue('files.list', { files: [data], incompleteSearch: false, nextPageToken: 'INVALID' });
    if (condition === 'missing-files') s.client.enqueue('files.list', { incompleteSearch: false });
    if (condition === 'missing-incompleteSearch') s.client.enqueue('files.list', { files: [data] });
    if (condition === 'missing-parents') { delete s.client.records.get('mock-image-a').metadata.parents; s.client.enqueue('files.list', { files: [s.client.records.get('mock-image-a').metadata], incompleteSearch: false }); }
    const before = structuredClone(s.engine.state.sourceCheckpoint);
    const result = await s.engine.scan();
    assert.equal(result.complete, false);
    assert.deepEqual(s.engine.state.sourceCheckpoint, before);
    assert.equal(s.engine.state.sources.length, 0);
  });
});

test('D08 — incompleteSearch e inventário alterado entre passes são rejeitados', async t => {
  for (const condition of ['incomplete', 'drift']) await t.test(condition, async sub => {
    const s = await setup(sub); s.client.add();
    const checkpoint = structuredClone(s.engine.state.sourceCheckpoint);
    if (condition === 'incomplete') s.client.enqueue('files.list', { files: [], incompleteSearch: true });
    else s.client.enqueue('files.list', { files: [s.client.records.get('mock-image-a').metadata], incompleteSearch: false }, { files: [], incompleteSearch: false });
    assert.equal((await s.engine.scan()).complete, false);
    assert.deepEqual(s.engine.state.sourceCheckpoint, checkpoint);
  });
});

test('D09 — 403/404/429/500/timeout em lista, ACL e conteúdo', async t => {
  for (const operation of ['files.list', 'permissions.list', 'files.media']) {
    for (const failure of [403, 404, 429, 500, 'timeout']) await t.test(operation + ':' + failure, async sub => {
      const s = await setup(sub); s.client.add();
      const checkpoint = structuredClone(s.engine.state.sourceCheckpoint);
      s.client.enqueue(operation, failure);
      assert.equal((await s.engine.scan()).complete, false);
      assert.deepEqual(s.engine.state.sourceCheckpoint, checkpoint);
      assert.equal(s.engine.state.processed, 0); assert.equal(s.engine.snapshot().photos.length, 0);
      assert.ok(!JSON.stringify(s.engine.status()).includes('SYNTHETIC-PRIVATE-PROVIDER-MESSAGE'));
      if (failure === 'timeout') assert.equal(s.source.authorization.code, 'DRIVE_TIMEOUT');
    });
  }
});

test('D10 — ACL muda durante processamento ou revalidação final', async t => {
  await t.test('durante worker', async sub => {
    const g = gate(), s = await setup(sub, { processor: g.processor }); s.client.add();
    await s.engine.scan(); s.advance(); await s.engine.scan();
    const running = s.engine.drain(); await g.ready;
    s.client.acls.get(EDITORIAL).push(userPermission('mock-third'));
    g.release(); await running;
    assert.notEqual(first(s).state, 'PUBLISHED'); assert.equal(s.engine.snapshot().photos.length, 0);
    assert.equal(s.engine.state.paused, true);
  });
  await t.test('último gate', async sub => {
    const s = await setup(sub); s.client.add();
    const revalidate = s.source.revalidate.bind(s.source);
    s.source.revalidate = async (...args) => {
      s.client.acls.get('mock-image-a').push({ id: 'mock-anyone', type: 'anyone', role: 'reader' });
      return revalidate(...args);
    };
    await publish(s);
    assert.equal(s.engine.snapshot().photos.length, 0); assert.notEqual(first(s).state, 'PUBLISHED');
    assert.equal(s.engine.state.paused, true);
  });
});

test('D11 — movido/trashed retira; 404 ambíguo não confirma exclusão', async t => {
  for (const condition of ['moved', 'trashed', '404']) await t.test(condition, async sub => {
    const client = new MockDriveClient(); client.add();
    const s = await setup(sub, { client }); await publish(s);
    if (condition === 'moved') client.records.get('mock-image-a').metadata.parents = ['mock-other-folder'];
    if (condition === 'trashed') client.records.get('mock-image-a').metadata.trashed = true;
    if (condition === '404') client.records.delete('mock-image-a');
    const checkpoint = structuredClone(s.engine.state.sourceCheckpoint);
    await s.engine.cycle();
    if (condition === '404') {
      assert.equal(first(s).state, 'PUBLISHED');
      assert.deepEqual(s.engine.state.sourceCheckpoint, checkpoint);
      assert.equal(s.engine.snapshot().photos.length, 0, 'unverifiable source must not keep serving');
    } else {
      assert.equal(first(s).state, 'WITHDRAWN'); assert.equal(s.engine.state.changes.at(-1).action, 'withdraw');
      assert.equal(await s.engine.media(first(s).id, 'display'), null);
    }
  });
});

test('D12 — falha/omissão temporária preserva três publicados sem retirada em massa', async t => {
  const client = new MockDriveClient(); client.add(); client.add('mock-image-b', 2); client.add('mock-image-c', 3);
  const s = await setup(t, { client }); await publish(s);
  const revision = s.engine.state.revision, checkpoint = structuredClone(s.engine.state.sourceCheckpoint);
  client.enqueue('files.list', 500); await s.engine.cycle();
  assert.ok(s.engine.state.sources.every(e => e.state === 'PUBLISHED')); assert.equal(s.engine.state.revision, revision);
  assert.deepEqual(s.engine.state.sourceCheckpoint, checkpoint);
  await s.engine.scan(); await s.engine.pause(false);
  client.enqueue('files.list', { files: [], incompleteSearch: false }, { files: [], incompleteSearch: false });
  assert.equal((await s.engine.scan()).complete, false, 'known file still exists: false empty snapshot cannot withdraw');
  assert.equal(s.engine.state.revision, revision);
  await s.engine.cycle(); assert.equal(s.engine.snapshot().photos.length, 3);
  assert.equal(s.engine.state.processed, 3);
});

test('D13 — conteúdo/versão estabilizam sem depender só de modifiedTime', async t => {
  const client = new MockDriveClient(); client.add();
  const s = await setup(t, { client }); await publish(s);
  const previousTime = client.records.get('mock-image-a').metadata.modifiedTime;
  client.replace('mock-image-a', 2, 2);
  assert.equal(client.records.get('mock-image-a').metadata.modifiedTime, previousTime);
  await s.engine.cycle(); assert.equal(first(s).state, 'RECEIVED'); assert.equal(s.engine.snapshot().photos.length, 0);
  s.advance(); await s.engine.cycle();
  assert.equal(first(s).state, 'PUBLISHED'); assert.equal(s.engine.state.processed, 2);
  client.records.get('mock-image-a').metadata.version = '3';
  await s.engine.cycle();
  assert.equal(s.engine.state.processed, 2, 'same bytes/version-only must not duplicate processing');
  assert.equal(s.engine.snapshot().photos.length, 1);
});

test('D14 — duplicatas SHA-256 e idempotência, sem promoção após retirada', async t => {
  const client = new MockDriveClient(); client.add(); client.add('mock-image-b', 1);
  const s = await setup(t, { client }); await publish(s); await s.engine.cycle();
  assert.equal(s.engine.state.processed, 1); assert.equal(s.engine.snapshot().photos.length, 1);
  client.records.get('mock-image-a').metadata.parents = ['mock-other-folder'];
  await s.engine.cycle(); await s.engine.cycle();
  assert.equal(s.engine.snapshot().photos.length, 0);
  assert.equal(s.engine.state.processed, 1);
});

test('D15 — job antigo não ressuscita retirada e pausa continua efetiva', async t => {
  const g = gate(), s = await setup(t, { processor: g.processor }); s.client.add();
  await s.engine.scan(); s.advance(); await s.engine.scan();
  const running = s.engine.drain(); await g.ready;
  const old = structuredClone(s.engine.state.jobs[0]);
  s.client.records.get('mock-image-a').metadata.parents = ['mock-other-folder'];
  await s.engine.pause(true); await s.engine.scan();
  g.release(); await running;
  assert.equal(await s.engine.completeJob(old, {}), 'STALE');
  assert.equal(first(s).state, 'WITHDRAWN');
  await s.engine.pause(false); await s.engine.cycle();
  assert.equal(s.engine.snapshot().photos.length, 0);
});

test('D16 — reinício recupera checkpoint/job e reinicia paginação na primeira página', async t => {
  const client = new MockDriveClient(); client.add(); client.add('mock-image-b', 2);
  const s = await setup(t, { client }); s.advance(); await s.engine.scan();
  await s.engine.claim();
  const checkpoint = structuredClone(s.engine.state.sourceCheckpoint);
  client.enqueue('files.list', { files: [client.records.get('mock-image-a').metadata], incompleteSearch: false, nextPageToken: '1' }, 500);
  await s.engine.scan();
  assert.deepEqual(s.engine.state.sourceCheckpoint, checkpoint);
  await s.engine.close();
  s.source = sourceFor(client);
  s.engine = await Simulator.open({ root: s.root, source: s.source, stableMs: 10, freshMs: 1000, clock: s.clock });
  assert.equal(s.engine.snapshot().photos.length, 0);
  const index = client.calls.length;
  await s.engine.scan();
  assert.equal(s.engine.state.sourceCheckpoint.sequence, checkpoint.sequence + 1);
  const resumed = client.calls.slice(index).find(c => c.operation === 'files.list');
  assert.equal(resumed.params.pageToken, undefined);
  await s.engine.pause(false); await s.engine.cycle(); await s.engine.cycle();
  assert.equal(s.engine.snapshot().photos.length, 2);
  const before = s.engine.state.processed;
  await s.engine.cycle(); assert.equal(s.engine.state.processed, before);
});

test('D17 — API de leitura não expõe IDs Drive, ACL, hashes ou campos privados', async t => {
  const client = new MockDriveClient(); client.add();
  const s = await setup(t, { client }); await publish(s);
  const server = await startHttp(s.engine, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const photos = await getJson(base + '/v1/photos'), health = await getJson(base + '/health');
  assert.equal(photos.photos.length, 1);
  const text = JSON.stringify({ photos, health });
  for (const secret of [EDITORIAL, ROOT, ...PUBLISHERS, 'mock-image-a', 'SYNTHETIC-PRIVATE', 'example.invalid', 'lastModifyingUser', 'sourceCheckpoint', 'md5Checksum', 'NOT_A_PROOF']) assert.ok(!text.includes(secret), secret);
  assert.equal(photos.isDemo, true);
});

test('D18 — suíte anterior intacta e cliente sem transporte/credenciais', async t => {
  const oldTest = fileURLToPath(new URL('./simulator.test.mjs', import.meta.url));
  assert.equal(sha256(await fs.readFile(oldTest)), 'c9431f1a0c92303493d078f575795b72b88cac65c70637a628c1faa4792d31e6');
  t.mock.method(globalThis, 'fetch', () => { throw new Error('NETWORK_FORBIDDEN'); });
  t.mock.method(https, 'request', () => { throw new Error('NETWORK_FORBIDDEN'); });
  t.mock.method(https, 'get', () => { throw new Error('NETWORK_FORBIDDEN'); });
  const s = await setup(t); s.client.add(); await publish(s);
  assert.equal(s.engine.snapshot().photos.length, 1);
  assert.throws(() => sourceFor({ mode: 'real-client' }), /ONLY_SYNTHETIC_CLIENT_SUPPORTED/);
});

test('D19 — checksum/tamanho divergentes, metadados incompletos e identidade alterada bloqueiam', async t => {
  for (const condition of ['md5', 'size', 'version', 'changed-during-download']) await t.test(condition, async sub => {
    const s = await setup(sub); s.client.add();
    if (condition === 'md5') s.client.records.get('mock-image-a').metadata.md5Checksum = '0'.repeat(32);
    if (condition === 'size') s.client.records.get('mock-image-a').metadata.size = '1';
    if (condition === 'version') delete s.client.records.get('mock-image-a').metadata.version;
    if (condition === 'changed-during-download') s.client.hook = (operation, params, client) => {
      if (operation === 'files.media') client.records.get(params.fileId).metadata.version = String(Number(client.records.get(params.fileId).metadata.version) + 1);
    };
    await publish(s); assert.equal(s.engine.snapshot().photos.length, 0);
  });
  const s = await setup(t); await s.engine.close(); s.engine = null;
  await assert.rejects(Simulator.open({ root: s.root, source: sourceFor(s.client, { publisherPermissionIds: ['mock-other', PUBLISHERS[1]] }) }), /SOURCE_IDENTITY_MISMATCH/);
});
