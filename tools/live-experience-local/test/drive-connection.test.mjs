import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { testConnectivity, readSyntheticFiles, validateSyntheticManifest, SYNTHETIC_TAG, MANIFEST_KIND } from '../src/drive-connection.mjs';
import { runDriveCommand } from '../src/drive-cli.mjs';
import { syntheticPng } from '../src/fixtures.mjs';
import { oauthHarness, fakeEnvelope, providerFailure } from './drive-oauth-fixtures.mjs';

function fixtureClient() {
  const bytes = syntheticPng(1, 40, 30), folderId = 'synthetic-app-test-folder', id = 'synthetic-app-test-file';
  const manifest = { kind: MANIFEST_KIND, folderId, files: [{ id, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] };
  const properties = { appProperties: { levelXVIIITest: SYNTHETIC_TAG }, isAppAuthorized: true, trashed: false };
  const metadata = new Map([
    [folderId, { id: folderId, mimeType: 'application/vnd.google-apps.folder', ...properties }],
    [id, { id, parents: [folderId], mimeType: 'image/png', size: String(bytes.length), version: '1', ...properties }]
  ]);
  const client = { calls: [], streams: [], bytes, manifest, metadata, inventory: [] };
  client.files = {
    list: async (params, options) => { client.calls.push({ params, options }); if (client.failure) throw client.failure;
      return { data: { files: client.inventory, incompleteSearch: false } }; },
    get: async (params, options) => {
      client.calls.push({ params, options }); if (client.failure) throw client.failure;
      if (params.alt === 'media') {
        const stream = Readable.from(client.chunks ?? [client.bytes]); client.streams.push(stream);
        return { data: stream };
      }
      if (client.hook) client.hook(params, client);
      return { data: structuredClone(client.metadata.get(params.fileId)) };
    }
  };
  return client;
}

test('C01 — conectividade não confunde ausência de arquivos autorizados com pasta editorial vazia', async () => {
  const client = fixtureClient();
  const result = await testConnectivity(client);
  assert.equal(result.status, 'NO_AUTHORIZED_SYNTHETIC_FILES'); assert.equal(result.connectivity, 'API_RESPONDED');
  assert.equal(result.editorialAccess, 'NOT_PROVEN'); assert.equal(result.publicationChanged, false);
  const call = client.calls[0];
  assert.equal(call.params.pageSize, 1); assert.ok(call.params.q.includes(SYNTHETIC_TAG)); assert.equal(call.options.retry, false);
  assert.ok(!call.params.fields.includes('name')); assert.ok(!JSON.stringify(result).includes(client.manifest.folderId));
  client.inventory = [{ id: 'synthetic-authorized-file' }];
  assert.equal((await testConnectivity(client)).status, 'AUTHORIZED_SYNTHETIC_RESOURCE_FOUND');
});

test('C02 — erros 401/403/404/429/5xx preservam o estado e os tokens locais', async t => {
  for (const status of [401, 403, 404, 429, 500]) await t.test(String(status), async () => {
    const h = oauthHarness({ envelope: fakeEnvelope() }), client = fixtureClient(); client.failure = providerFailure(status);
    h.sdk.drive = () => client; const previous = structuredClone(h.store.value);
    await assert.rejects(runDriveCommand({ command: 'connectivity', execute: true, env: {} }, {
      ...h, makeStore: () => h.store, loadSdk: async () => h.sdk, loadCredentials: async () => h.credentials
    }), err => !JSON.stringify(err).includes('SYNTHETIC-PRIVATE'));
    assert.deepEqual(h.store.value, previous); assert.equal(h.opened, 0); assert.equal(h.store.saves, 0);
  });
});

test('C03 — inventário parcial não é tratado como consulta completa ou ausência comprovada', async t => {
  for (const data of [{}, { files: [] }, { files: [], incompleteSearch: true }, { files: [{ id: '../unsafe' }], incompleteSearch: false }]) {
    await t.test('resposta incompleta', async () => {
      const client = { files: { list: async () => ({ data }) } };
      await assert.rejects(testConnectivity(client), { code: 'DRIVE_PARTIAL_RESPONSE' });
    });
  }
});

test('C04 — leitura sintética verifica allowlist, parent, marcador, SHA-256 e stream sem persistir conteúdo', async () => {
  const client = fixtureClient();
  client.chunks = [client.bytes.subarray(0, 25), client.bytes.subarray(25, 50), client.bytes.subarray(50)];
  const result = await readSyntheticFiles(client, client.manifest);
  assert.equal(result.verifiedFiles, 1); assert.equal(result.persistedContent, false); assert.equal(result.editorialAccess, 'NOT_PROVEN');
  assert.equal(result.publicationChanged, false); assert.ok(client.streams.every(stream => stream.destroyed));
  assert.equal(client.calls.filter(call => call.params.alt === 'media').length, 1);
  assert.ok(client.calls.every(call => call.params.fileId && !call.params.q));
  for (const absent of [client.manifest.folderId, client.manifest.files[0].id, client.manifest.files[0].sha256]) assert.ok(!JSON.stringify(result).includes(absent));
});

test('C05 — manifesto inválido, arquivo duplicado e limite excessivo falham antes do cliente', async t => {
  for (const condition of ['kind', 'folder', 'empty', 'duplicate', 'hash', 'bytes', 'count']) await t.test(condition, async () => {
    const client = fixtureClient(), manifest = structuredClone(client.manifest);
    if (condition === 'kind') manifest.kind = 'REAL_PHOTOS';
    if (condition === 'folder') manifest.folderId = "' or true";
    if (condition === 'empty') manifest.files = [];
    if (condition === 'duplicate') manifest.files.push(manifest.files[0]);
    if (condition === 'hash') manifest.files[0].sha256 = 'missing';
    if (condition === 'bytes') manifest.files[0].bytes = 1024 * 1024 + 1;
    if (condition === 'count') manifest.files = Array.from({ length: 4 }, (_, index) => ({ ...manifest.files[0], id: 'synthetic-' + index }));
    assert.throws(() => validateSyntheticManifest(manifest), { code: 'SYNTHETIC_MANIFEST_INVALID' });
    await assert.rejects(readSyntheticFiles(client, manifest), { code: 'SYNTHETIC_MANIFEST_INVALID' });
    assert.equal(client.calls.length, 0);
  });
});

test('C06 — pasta/arquivo sem autorização específica, parent correto ou marcador bloqueia download', async t => {
  for (const condition of ['manual-folder', 'marker', 'trashed', 'parent', 'mime', 'size', 'shortcut']) await t.test(condition, async () => {
    const client = fixtureClient(), file = client.metadata.get(client.manifest.files[0].id);
    if (condition === 'manual-folder') client.metadata.get(client.manifest.folderId).isAppAuthorized = false;
    if (condition === 'marker') file.appProperties = {};
    if (condition === 'trashed') file.trashed = true;
    if (condition === 'parent') file.parents = ['real-editorial-folder'];
    if (condition === 'mime') file.mimeType = 'image/jpeg';
    if (condition === 'shortcut') file.mimeType = 'application/vnd.google-apps.shortcut';
    if (condition === 'size') file.size = '1';
    await assert.rejects(readSyntheticFiles(client, client.manifest));
    assert.equal(client.calls.filter(call => call.params.alt === 'media').length, 0);
  });
});

test('C07 — overflow, truncamento, bytes sem marcador e checksum incorreto encerram o stream', async t => {
  for (const condition of ['oversize', 'truncated', 'checksum', 'unmarked']) await t.test(condition, async () => {
    const client = fixtureClient();
    if (condition === 'oversize') client.chunks = [Buffer.alloc(client.bytes.length + 1)];
    if (condition === 'truncated') client.chunks = [client.bytes.subarray(0, 10)];
    if (condition === 'checksum') client.manifest.files[0].sha256 = '0'.repeat(64);
    if (condition === 'unmarked') {
      client.bytes = Buffer.from(client.bytes); client.bytes.fill(0, 40, 100);
      client.manifest.files[0].sha256 = createHash('sha256').update(client.bytes).digest('hex');
    }
    await assert.rejects(readSyntheticFiles(client, client.manifest));
    assert.ok(client.streams.every(stream => stream.destroyed));
  });
});

test('C08 — mudança durante leitura e timeout são recusados sem publicação', async t => {
  await t.test('versão mudou', async () => {
    const client = fixtureClient(); let reads = 0;
    client.hook = (params, current) => {
      if (params.fileId === client.manifest.files[0].id && ++reads === 2) current.metadata.get(params.fileId).version = '2';
    };
    await assert.rejects(readSyntheticFiles(client, client.manifest), { code: 'SYNTHETIC_FILE_CHANGED' });
  });
  await t.test('timeout aborta transporte', async () => {
    let aborted = false;
    const client = { files: { list: async (_params, { signal }) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); }) } };
    await assert.rejects(testConnectivity(client, { timeoutMs: 10 }), { code: 'DRIVE_TIMEOUT' });
    assert.equal(aborted, true);
  });
});

test('C09 — manifesto externo é validado antes de renovar autorização', async () => {
  const h = oauthHarness({ envelope: fakeEnvelope({ expiry_date: 1 }) });
  await assert.rejects(runDriveCommand({ command: 'read-synthetic', execute: true, env: {} }, {
    ...h, makeStore: () => h.store, loadSdk: async () => h.sdk, loadCredentials: async () => h.credentials,
    loadManifest: async () => { throw new Error('SYNTHETIC-PRIVATE'); }
  }));
  assert.equal(h.auth.refreshes, 0); assert.equal(h.auth.exchanges.length, 0); assert.equal(h.opened, 0);
});

test('C10 — download que não termina é abortado e seu stream destruído no timeout', async () => {
  const client = fixtureClient(), original = client.files.get;
  const hanging = new Readable({ read() {} });
  client.files.get = async (params, options) => params.alt === 'media' ? { data: hanging } : original(params, options);
  await assert.rejects(readSyntheticFiles(client, client.manifest, { timeoutMs: 20 }), { code: 'DRIVE_TIMEOUT' });
  assert.equal(hanging.destroyed, true);
});
