import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { Simulator } from '../src/engine.mjs';
import { REPO_ROOT } from '../src/storage.mjs';
import { FOLDERS } from '../src/local-source.mjs';
import { syntheticPng } from '../src/fixtures.mjs';
import { decodePng, processSyntheticPng, sha256, MAX_BYTES, chunk, encodePng } from '../src/png.mjs';
import { startHttp } from '../src/http.mjs';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = syntheticPng(1);
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-test-'));
  let time = 100000;
  const engine = await Simulator.open({ root, stableMs: 10, freshMs: 1000, clock: () => time, ...options });
  const state = { root, engine, advance: (ms = 11) => { time += ms; } };
  t.after(async () => {
    if (state.engine?.store.lock) await state.engine.close();
    // Only this test's new, uniquely named scratch directory is removed.
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('level-xviii-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  await engine.setPermissions('allowed'); await engine.pause(false);
  return state;
}
const editorial = s => path.join(s.root, FOLDERS[1]);
async function add(s, name = 'SYNTHETIC.png', bytes = fixture) { await fs.writeFile(path.join(editorial(s), name), bytes); }
async function publish(s) { await s.engine.cycle(); s.advance(); await s.engine.cycle(); }
const photo = s => s.engine.state.sources[0];
async function remove(s, name = 'SYNTHETIC.png') { await fs.rename(path.join(editorial(s), name), path.join(s.root, FOLDERS[2], name)); }
function gateProcessor() {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  return { ready, release: () => release(), processor: async bytes => { entered(); await gate; return processSyntheticPng(bytes); } };
}

test('T01 — imagem válida: estabilidade, transições e publicação automática', async t => {
  const s = await setup(t); await add(s);
  await s.engine.cycle();
  assert.equal(photo(s).state, 'RECEIVED'); assert.equal(s.engine.snapshot().photos.length, 0);
  s.advance(); await s.engine.cycle();
  assert.equal(photo(s).state, 'PUBLISHED'); assert.equal(s.engine.snapshot().photos.length, 1);
  assert.deepEqual(s.engine.state.audit.filter(a => a.action === 'STATE').map(a => a.to), ['RECEIVED', 'PROCESSING', 'READY', 'PUBLISHED']);
  assert.equal(s.engine.state.audit.find(a => a.action === 'AUTO_PUBLICATION').humanActor, null);
  assert.equal(s.engine.state.processed, 1);
});

test('T02 — repetição e cópia idêntica não duplicam processamento/publicação', async t => {
  const s = await setup(t); await add(s); await publish(s);
  await add(s, 'COPY.png'); await publish(s); await s.engine.cycle();
  assert.equal(s.engine.snapshot().photos.length, 1);
  assert.equal(s.engine.state.processed, 1); assert.equal(s.engine.state.revision, 1);
  assert.equal(s.engine.state.sources.find(e => e.name === 'COPY.png').duplicateOf, photo(s).id);
  await remove(s); await s.engine.cycle(); await s.engine.cycle();
  assert.equal(s.engine.snapshot().photos.length, 0, 'duplicate must not replace withdrawn canonical');
});

test('T03 — transferência parcial ou variável nunca publica prematuramente', async t => {
  const s = await setup(t);
  await add(s, 'SYNTHETIC.png', fixture.subarray(0, 60));
  await s.engine.cycle(); s.advance();
  await add(s, 'SYNTHETIC.png', fixture.subarray(0, 160));
  await s.engine.cycle(); assert.equal(photo(s).state, 'RECEIVED');
  await add(s); s.advance(); await s.engine.cycle();
  assert.equal(s.engine.snapshot().photos.length, 0);
  s.advance(); await s.engine.cycle();
  assert.equal(photo(s).state, 'PUBLISHED');
});

test('T04 — assinatura, CRC, perfil, formato, tamanho e integridade inválidos', async t => {
  const corrupted = Buffer.from(fixture); corrupted[corrupted.length - 1] ^= 1;
  const bomb = Buffer.from(fixture);
  bomb.writeUInt32BE(50000, 16);
  const ihdr = chunk('IHDR', bomb.subarray(16, 29));
  ihdr.copy(bomb, 8);
  const plain = encodePng({ width: 1, height: 1, channels: 3, pixels: Buffer.from([1, 2, 3]) });
  const cases = [
    ['bad.png', Buffer.from('not an image')], ['photo.jpg', fixture],
    ['crc.png', corrupted], ['truncated.png', fixture.subarray(0, fixture.length - 8)],
    ['oversize.png', Buffer.alloc(MAX_BYTES + 1)], ['bomb.png', bomb],
    ['private-unmarked.png', plain], ['trailing.png', Buffer.concat([fixture, Buffer.from([0])])]
  ];
  for (const [name, bytes] of cases) await t.test(name, async sub => {
    const s = await setup(sub); await add(s, name, bytes); await publish(s);
    assert.equal(photo(s).state, 'FAILED'); assert.equal(s.engine.snapshot().photos.length, 0);
  });
});

test('T05 — permissões negadas/indeterminadas e mudança durante job bloqueiam', async t => {
  for (const mode of ['denied', 'indeterminate']) await t.test(mode, async sub => {
    const s = await setup(sub); await s.engine.setPermissions(mode); await add(s); await publish(s);
    assert.equal(s.engine.snapshot().photos.length, 0); assert.equal(s.engine.state.processed, 0);
    await assert.rejects(s.engine.pause(false), /PERMISSION_NOT_ALLOWED/);
  });
  await t.test('ACL muda com job em voo', async sub => {
    const gated = gateProcessor(), s = await setup(sub, { processor: gated.processor });
    await add(s); await s.engine.scan(); s.advance(); await s.engine.scan();
    const running = s.engine.drain(); await gated.ready;
    await s.engine.setPermissions('denied');
    gated.release(); await running;
    assert.equal(s.engine.snapshot().photos.length, 0);
    assert.notEqual(photo(s).state, 'PUBLISHED');
    await s.engine.setPermissions('allowed');
    assert.equal(s.engine.state.paused, true, 'no automatic resume after security change');
  });
});

test('T06 — lista incompleta/falha de leitura não retiram tudo', async t => {
  const s = await setup(t); await add(s); await publish(s);
  const originalList = s.engine.source.list.bind(s.engine.source);
  s.engine.source.list = async () => ({ complete: false, entries: [] });
  await s.engine.cycle(); assert.equal(photo(s).state, 'PUBLISHED'); assert.equal(s.engine.state.revision, 1);
  s.engine.source.list = async () => { throw new Error('read denied'); };
  await s.engine.cycle(); assert.equal(photo(s).state, 'PUBLISHED'); assert.equal(s.engine.state.revision, 1);
  s.engine.source.list = originalList;
  await s.engine.cycle(); assert.equal(s.engine.snapshot().photos.length, 1);
});

test('T07 — retirada gera tombstone e bloqueia leitura de derivados', async t => {
  const s = await setup(t); await add(s); await publish(s);
  const id = photo(s).id; await remove(s); await s.engine.cycle();
  assert.equal(photo(s).state, 'WITHDRAWN'); assert.equal(s.engine.snapshot().photos.length, 0);
  assert.equal(await s.engine.media(id, 'display'), null);
  assert.equal(s.engine.state.changes.at(-1).action, 'withdraw');
  assert.equal(s.engine.state.revision, 2);
});

test('T08 — job antigo concluído após retirada não republica', async t => {
  const gated = gateProcessor(), s = await setup(t, { processor: gated.processor });
  await add(s); await s.engine.scan(); s.advance(); await s.engine.scan();
  const running = s.engine.drain(); await gated.ready;
  const oldJob = structuredClone(s.engine.state.jobs[0]);
  await remove(s); await s.engine.scan();
  gated.release(); await running;
  assert.equal(await s.engine.completeJob(oldJob, {}), 'STALE');
  assert.equal(photo(s).state, 'WITHDRAWN'); assert.equal(s.engine.snapshot().photos.length, 0);
});

test('T09 — reinício real recupera estado e job PROCESSING após crash', async t => {
  const s = await setup(t); await add(s); await s.engine.close(); s.engine = null;
  const childCode = `
    import { Simulator } from './src/engine.mjs';
    const e = await Simulator.open({root:process.argv[1],stableMs:1});
    await e.scan(); await new Promise(r=>setTimeout(r,5)); await e.scan();
    await e.claim(); process.exit(0);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode, s.root], { cwd: moduleRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', c => { stderr += c; });
  const [code] = await once(child, 'exit'); assert.equal(code, 0, stderr);
  const before = JSON.parse(JSON.parse(await fs.readFile(path.join(s.root, 'state.json'), 'utf8')).payload);
  assert.equal(before.sources[0].state, 'PROCESSING');
  const e = await Simulator.open({ root: s.root, stableMs: 1 });
  s.engine = e;
  assert.equal(e.snapshot().photos.length, 0, 'fresh scan required after restart');
  await e.cycle(); assert.equal(e.snapshot().photos.length, 1);
  const id = photo(s).id, processed = e.state.processed;
  await e.close();
  s.engine = await Simulator.open({ root: s.root, stableMs: 1 }); await s.engine.cycle();
  assert.equal(photo(s).id, id); assert.equal(s.engine.state.processed, processed);
  await remove(s); await s.engine.cycle(); await s.engine.close();
  s.engine = await Simulator.open({ root: s.root, stableMs: 1 }); await s.engine.cycle();
  assert.equal(photo(s).state, 'WITHDRAWN'); assert.equal(s.engine.state.revision, 2);
});

test('T10 — pausa persistida, retomada e pausa em voo', async t => {
  const s = await setup(t); await s.engine.pause(true); await add(s); await publish(s);
  assert.equal(s.engine.state.processed, 0);
  await s.engine.close();
  s.engine = await Simulator.open({ root: s.root, stableMs: 1 });
  assert.equal(s.engine.state.paused, true);
  await s.engine.pause(false); await s.engine.cycle();
  assert.equal(s.engine.snapshot().photos.length, 1);
  await s.engine.pause(true); await remove(s); await s.engine.cycle();
  assert.equal(photo(s).state, 'WITHDRAWN', 'pause must not block withdrawals');
  await t.test('pausa durante processamento segura READY e reaproveita derivados', async sub => {
    const gate = gateProcessor(), q = await setup(sub, { processor: gate.processor });
    await add(q); await q.engine.scan(); q.advance(); await q.engine.scan();
    const running = q.engine.drain(); await gate.ready;
    await q.engine.pause(true); gate.release(); await running;
    assert.equal(photo(q).state, 'READY'); assert.equal(q.engine.snapshot().photos.length, 0);
    await q.engine.pause(false); await q.engine.cycle();
    assert.equal(q.engine.snapshot().photos.length, 1); assert.equal(q.engine.state.processed, 1);
  });
});

test('T11 — falha de processamento recupera com retry idempotente', async t => {
  let fail = true;
  const s = await setup(t, { processor: bytes => { if (fail) throw new Error('injected processing failure'); return processSyntheticPng(bytes); } });
  await add(s); await publish(s); assert.equal(photo(s).state, 'FAILED');
  fail = false; await s.engine.retryFailed(); await s.engine.cycle(); await s.engine.cycle();
  assert.equal(photo(s).state, 'PUBLISHED'); assert.equal(s.engine.snapshot().photos.length, 1);
  assert.equal(s.engine.state.processed, 1);
});

test('T12 — todos os 31 arquivos preexistentes preservados byte a byte', async () => {
  const baseline = JSON.parse(await fs.readFile(path.join(moduleRoot, 'test/preservation-baseline.json'), 'utf8'));
  assert.equal(Object.keys(baseline.files).length, 31);
  for (const [name, hash] of Object.entries(baseline.files)) assert.equal(sha256(await fs.readFile(path.join(REPO_ROOT, name))), hash, name);
});

test('T13 — API somente publica PUBLISHED e nega escrita/origem externa', async t => {
  const s = await setup(t), server = await startHttp(s.engine, 0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal(server.address().address, '127.0.0.1');
  await add(s); await s.engine.cycle();
  assert.equal((await (await fetch(base + '/v1/photos')).json()).photos.length, 0);
  s.advance(); await s.engine.cycle();
  const snapshot = await (await fetch(base + '/v1/photos')).json();
  assert.equal(snapshot.photos.length, 1); assert.equal(snapshot.isDemo, true);
  assert.equal(snapshot.photos[0].status, 'published');
  assert.ok(!JSON.stringify(snapshot).includes('SYNTHETIC.png'));
  const media = await fetch(base + snapshot.photos[0].imageUrl);
  assert.equal(media.status, 200); assert.equal(media.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + '/v1/photos', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/v1/photos', { headers: { Origin: 'https://example.invalid' } })).status, 403);
  await remove(s); await s.engine.cycle();
  assert.equal((await fetch(base + snapshot.photos[0].imageUrl)).status, 404);
  assert.equal((await (await fetch(base + '/v1/photos')).json()).photos.length, 0);
});

test('T14 — derivados reais íntegros, reduzidos e sem EXIF/GPS; original intacto', async t => {
  const s = await setup(t); await add(s);
  const before = sha256(await fs.readFile(path.join(editorial(s), 'SYNTHETIC.png')));
  assert.ok(decodePng(fixture).chunks.includes('eXIf'));
  await publish(s);
  assert.equal(sha256(await fs.readFile(path.join(editorial(s), 'SYNTHETIC.png'))), before);
  for (const [variant, side] of [['thumbnail', 160], ['display', 640]]) {
    const bytes = await s.engine.media(photo(s).id, variant);
    assert.ok(bytes.length < fixture.length);
    // Independent chunk walk and raw output check (encoder emits filter 0 only).
    let offset = 8; const types = [], idat = []; let width, height;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      types.push(type);
      if (type === 'IHDR') { width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12); }
      if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
    assert.equal(Math.max(width, height), side);
    const raw = inflateSync(Buffer.concat(idat));
    assert.equal(raw.length, (width * 3 + 1) * height);
    assert.equal(raw[0], 0);
    assert.deepEqual([...raw.subarray(1, 4)], [205, 166, 37]);
    assert.ok(!bytes.includes(Buffer.from('GPS')));
  }
});

test('T15 — estado corrompido falha fechado, sem recriar galeria vazia', async t => {
  const s = await setup(t); await add(s); await publish(s); await s.engine.close(); s.engine = null;
  await fs.writeFile(path.join(s.root, 'state.json'), '{"damaged":true}');
  await assert.rejects(Simulator.open({ root: s.root }));
  assert.equal(await fs.readFile(path.join(s.root, 'state.json'), 'utf8'), '{"damaged":true}');
});

test('T16 — segundo escritor e dados dentro da árvore pública são rejeitados', async t => {
  const s = await setup(t);
  await assert.rejects(Simulator.open({ root: s.root }), /SERVICE_ALREADY_RUNNING/);
  await assert.rejects(Simulator.open({ root: path.join(REPO_ROOT, 'tools/unsafe-data') }), /DATA_MUST_BE_OUTSIDE_REPOSITORY/);
});

test('T17 — lease vencido impede leitura sem apagar estado publicado', async t => {
  const s = await setup(t); await add(s); await publish(s); s.advance(1001);
  assert.equal(photo(s).state, 'PUBLISHED'); assert.equal(s.engine.snapshot().photos.length, 0);
  assert.equal(await s.engine.media(photo(s).id, 'display'), null);
  await s.engine.cycle(); assert.equal(s.engine.snapshot().photos.length, 1);
});

test('T18 — artefato interrompido/corrompido é recuperado antes de publicar', async t => {
  const gated = gateProcessor(), s = await setup(t, { processor: gated.processor });
  await add(s); await s.engine.scan(); s.advance(); await s.engine.scan();
  const running = s.engine.drain(); await gated.ready;
  const variants = await processSyntheticPng(fixture);
  const job = s.engine.state.jobs[0];
  const target = path.join(s.root, 'derivatives', job.sourceId + '.' + job.generation + '.thumbnail.' + variants.thumbnail.sha256 + '.png');
  await fs.writeFile(target, Buffer.from('partial derivative'));
  gated.release(); await running;
  assert.equal(photo(s).state, 'PUBLISHED');
  assert.equal(sha256(await fs.readFile(target)), variants.thumbnail.sha256);
});

test('T19 — substituição binária invalida geração antiga e processa nova', async t => {
  const s = await setup(t); await add(s); await publish(s);
  const generation = photo(s).generation;
  await add(s, 'SYNTHETIC.png', syntheticPng(2));
  await s.engine.cycle();
  assert.equal(photo(s).state, 'RECEIVED'); assert.equal(s.engine.snapshot().photos.length, 0);
  s.advance(); await s.engine.cycle();
  assert.equal(photo(s).state, 'PUBLISHED'); assert.ok(photo(s).generation > generation);
  assert.equal(s.engine.state.revision, 3);
  assert.equal(s.engine.state.processed, 2);
});

test('T20 — CLI seed/start/console/HTTP/quit funciona de ponta a ponta', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-test-'));
  const env = { ...process.env, LEVEL_LOCAL_DATA_DIR: root, LEVEL_LOCAL_PORT: '0', LEVEL_LOCAL_SCAN_MS: '50', LEVEL_LOCAL_STABLE_MS: '20' };
  const run = command => spawn(process.execPath, ['src/cli.mjs', command], { cwd: moduleRoot, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('level-xviii-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  const seeded = run('seed'); let errors = '';
  seeded.stderr.on('data', data => { errors += data; }); seeded.stdout.resume();
  const [seedExit] = await once(seeded, 'exit'); assert.equal(seedExit, 0, errors);
  child = run('start'); let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  const waitFor = async predicate => {
    const until = Date.now() + 5000;
    while (!await predicate()) {
      assert.ok(Date.now() < until, 'CLI timeout: ' + output + errors);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  await waitFor(() => output.includes('API somente leitura:'));
  const base = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  child.stdin.write('permissions allowed\nresume\ndemo\n');
  await waitFor(async () => (await (await fetch(base + '/v1/photos')).json()).photos.length === 3);
  child.stdin.write('pause\n');
  await waitFor(async () => (await (await fetch(base + '/health')).json()).paused);
  child.stdin.write('quit\n');
  const [exit] = await once(child, 'exit'); assert.equal(exit, 0, errors);
  const persisted = JSON.parse(JSON.parse(await fs.readFile(path.join(root, 'state.json'), 'utf8')).payload);
  assert.equal(persisted.paused, true); assert.equal(persisted.sources.filter(e => e.state === 'PUBLISHED').length, 3);
});

test('T21 — extensão proibida não bloqueia PNG válido com os mesmos bytes', async t => {
  const s = await setup(t);
  await add(s, 'a-bad.jpg'); await add(s, 'z-good.png'); await publish(s);
  assert.equal(s.engine.snapshot().photos.length, 1);
  assert.equal(s.engine.state.processed, 1);
  assert.equal(s.engine.state.sources.find(e => e.name === 'a-bad.jpg').state, 'FAILED');
});
