import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import childProcess from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { REPOSITORY, DriveError, assertPrivatePermissions } from '../src/drive-token-store.mjs';
import { DriveLabState, LAB_STATE_KIND, LAB_STATE_FILE, LAB_CLAIM_FILE, LAB_LOCK_FILE } from '../src/drive-lab-state.mjs';
import { LabDiagnosticReader, parseDiagnoseArguments, runDiagnoseCommand, main } from '../src/drive-lab-diagnose.mjs';
const execFileAsync = promisify(childProcess.execFile);
const KEYS = ['integrityValid', 'phase', 'createAttempted', 'rootReferencePresent', 'folderReferencePresent',
  'claimMatchesJournal', 'approvalConsumed', 'stateStable', 'remoteCreationProven'];
const clone = value => structuredClone(value);

// Invented fixtures only. Never take a configuration/path from the operator's environment.
function pair(phase = 'BLOCKED', receipt = phase === 'CREATED') {
  const attempted = ['UNCERTAIN', 'CREATED'].includes(phase);
  const creation = { operationId: 'a'.repeat(32), clientBinding: 'b'.repeat(64), ownerPermissionId: 'synthetic-private-owner',
    phase, createAttempted: attempted, rootId: attempted ? 'synthetic-private-root' : null,
    folderId: receipt ? 'synthetic-private-folder' : null };
  return { state: { kind: LAB_STATE_KIND, usedApprovals: ['c'.repeat(64)], creation },
    claim: { kind: 'LEVEL_XVIII_LAB_CREATE_CONSUMED_V1', operationId: creation.operationId,
      clientBinding: creation.clientBinding, ownerPermissionId: creation.ownerPermissionId } };
}
const envelope = state => JSON.stringify({ payload: state, sha256: createHash('sha256').update(JSON.stringify(state)).digest('hex') });
const executeEnv = directory => ({ LEVEL_DRIVE_LAB_STATE_DIR: directory, LEVEL_DRIVE_LAB_DIAGNOSE_QUIESCENT: 'true' });

async function scratch(t, value = pair()) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'level-xviii-diagnose-test-'));
  t.after(async () => {
    // Cleanup is restricted to this newly created synthetic test directory.
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('level-xviii-diagnose-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  if (process.platform === 'win32') {
    const script = ["$ErrorActionPreference='Stop'", '$p=$env:LEVEL_DIAGNOSE_TEST_SCRATCH',
      '$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
      '$acl=New-Object System.Security.AccessControl.DirectorySecurity', '$acl.SetOwner($me)', '$acl.SetAccessRuleProtection($true,$false)',
      "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow')",
      '$acl.AddAccessRule($rule)', 'Set-Acl -LiteralPath $p -AclObject $acl'].join(';');
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, env: { ...process.env, LEVEL_DIAGNOSE_TEST_SCRATCH: root }, timeout: 10000 });
  } else await fs.chmod(root, 0o700);
  const directory = path.join(root, 'state'); await fs.mkdir(directory, { mode: 0o700 });
  const stateFile = path.join(directory, LAB_STATE_FILE), claimFile = path.join(directory, LAB_CLAIM_FILE);
  await fs.writeFile(stateFile, envelope(value.state), { mode: 0o600 });
  await fs.writeFile(claimFile, JSON.stringify(value.claim), { mode: 0o600 });
  return { root, directory, stateFile, claimFile, value, reader: new LabDiagnosticReader(directory),
    env: executeEnv(directory), run: injected => runDiagnoseCommand({ execute: true, env: executeEnv(directory) }, injected) };
}

function memory(value = pair()) {
  const h = { value, reads: 0, snapshots: 0 };
  h.reader = { snapshot: async () => { h.snapshots++; return { syntheticRevision: 1 }; },
    read: async () => { h.reads++; return clone(h.value); } };
  h.run = () => runDiagnoseCommand({ execute: true, env: executeEnv('SYNTHETIC-NOT-A-REAL-PATH') }, { makeReader: () => h.reader });
  return h;
}
const forbidden = () => { throw new Error('SYNTHETIC_FORBIDDEN_EFFECT'); };

test('D01 — dry-run retorna antes de ambiente privado, filesystem, ACL, SDK, rede, sockets ou dependências', async t => {
  for (const key of ['open', 'readFile', 'writeFile', 'lstat', 'stat', 'realpath', 'readdir', 'mkdir', 'link', 'unlink', 'rename']) t.mock.method(fs, key, forbidden);
  for (const [target, key] of [[http, 'createServer'], [http, 'request'], [https, 'request'], [net, 'createServer'],
    [net, 'connect'], [globalThis, 'fetch'], [childProcess, 'execFile']]) t.mock.method(target, key, forbidden);
  const env = new Proxy({}, { get: forbidden });
  for (const args of [[], ['--dry-run']]) {
    const result = await runDiagnoseCommand({ ...parseDiagnoseArguments(args), env }, { makeReader: forbidden });
    assert.deepEqual(Object.keys(result), KEYS); assert.equal(result.phase, 'DRY_RUN');
    for (const [key, value] of Object.entries(result)) if (key !== 'phase') assert.equal(value, 'UNKNOWN');
  }
});

test('D02 — flags ambíguas, payloads e argumentos privados são recusados sem eco', async () => {
  assert.deepEqual(parseDiagnoseArguments(['--execute']), { execute: true });
  for (const args of [['--execute', '--dry-run'], ['--execute', '--execute'], ['--scope=drive'], ['--path=SYNTHETIC-PRIVATE'],
    ['--output=SYNTHETIC-PRIVATE'], ['lab-create'], ['--execute=SYNTHETIC-PRIVATE']]) {
    const out = []; assert.equal(await main(args, {}, { log: v => out.push(v), error: v => out.push(v) }), 1);
    assert.equal(out.length, 1); const result = JSON.parse(out[0]); assert.deepEqual(Object.keys(result), KEYS);
    assert.equal(result.integrityValid, false); assert.equal(result.phase, 'UNKNOWN'); assert.ok(!out[0].includes('SYNTHETIC-PRIVATE'));
  }
});

test('D03 — RESERVED, BLOCKED, UNCERTAIN e CREATED reais: contrato e evidência histórica conservadora', async t => {
  for (const [phase, receipt, remote] of [['RESERVED', false, false], ['BLOCKED', false, false],
    ['UNCERTAIN', false, 'UNKNOWN'], ['UNCERTAIN', true, 'UNKNOWN'], ['CREATED', true, true]]) {
    await t.test(phase + '-' + receipt, async child => {
      const s = await scratch(child, pair(phase, receipt)); const result = await s.run();
      assert.deepEqual(Object.keys(result), KEYS); assert.equal(result.integrityValid, true); assert.equal(result.phase, phase);
      assert.equal(result.createAttempted, ['UNCERTAIN', 'CREATED'].includes(phase));
      assert.equal(result.rootReferencePresent, result.createAttempted); assert.equal(result.folderReferencePresent, receipt);
      assert.equal(result.claimMatchesJournal, true); assert.equal(result.approvalConsumed, true);
      assert.equal(result.stateStable, true); assert.equal(result.remoteCreationProven, remote);
      assert.deepEqual(await fs.readdir(s.directory), [LAB_CLAIM_FILE, LAB_STATE_FILE]);
    });
  }
});

test('D04 — claim divergente, extra ou parcial nunca produz diagnóstico válido', async t => {
  for (const scenario of ['operationId', 'clientBinding', 'ownerPermissionId', 'kind', 'extra', 'missing']) {
    await t.test(scenario, async child => {
      const value = pair();
      if (scenario === 'extra') value.claim.secret = 'SYNTHETIC-PRIVATE';
      else if (scenario === 'missing') delete value.claim.ownerPermissionId;
      else value.claim[scenario] = 'SYNTHETIC-DIFFERENT';
      const s = await scratch(child, value); await assert.rejects(s.run(), { code: 'LAB_DIAGNOSE_CLAIM_MISMATCH' });
    });
  }
});

test('D05 — checksum inválido, JSON parcial, vazio, schema inválido e envelope extra são recusados', async t => {
  for (const scenario of ['checksum', 'partial-state', 'partial-claim', 'empty', 'schema', 'extra-envelope']) {
    await t.test(scenario, async child => {
      const s = await scratch(child), raw = JSON.parse(envelope(s.value.state));
      if (scenario === 'checksum') raw.sha256 = '0'.repeat(64);
      if (scenario === 'extra-envelope') raw.extra = 'SYNTHETIC';
      if (scenario === 'schema') { s.value.state.extra = true; await fs.writeFile(s.stateFile, envelope(s.value.state)); }
      else if (scenario === 'partial-claim') await fs.writeFile(s.claimFile, '{');
      else await fs.writeFile(s.stateFile, scenario === 'partial-state' ? '{' : scenario === 'empty' ? '' : JSON.stringify(raw));
      await assert.rejects(s.run(), { code: scenario === 'checksum' || scenario === 'schema' || scenario === 'extra-envelope' ?
        'LAB_STATE_INVALID' : scenario === 'empty' ? 'PRIVATE_JSON_SIZE' : 'PRIVATE_JSON_INVALID' });
    });
  }
});

test('D06 — combinações de fase, tentativa, referências ou consumo ambíguas são recusadas', async t => {
  const cases = {
    absentCreation: p => { p.state.creation = null; }, unconsumed: p => { p.state.usedApprovals = []; },
    reservedAttempted: p => { p.state.creation.createAttempted = true; },
    blockedRoot: p => { p.state.creation.rootId = 'synthetic-root'; },
    blockedFolder: p => { p.state.creation.folderId = 'synthetic-folder'; },
    extraPreflightApproval: p => { p.state.usedApprovals.push('d'.repeat(64)); },
    uncertainNotAttempted: p => { p.state.creation.phase = 'UNCERTAIN'; },
    uncertainNoRoot: p => { p.state.creation.phase = 'UNCERTAIN'; p.state.creation.createAttempted = true; },
    createdNoFolder: p => { p.state.creation.phase = 'CREATED'; p.state.creation.createAttempted = true; p.state.creation.rootId = 'synthetic-root'; }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async child => {
    const value = pair(name.startsWith('reserved') ? 'RESERVED' : 'BLOCKED'); change(value);
    const s = await scratch(child, value); await assert.rejects(s.run());
  });
  const h = memory(pair('UNCERTAIN')); h.value.state.usedApprovals.push('d'.repeat(64));
  assert.equal((await h.run()).approvalConsumed, true); // A previous failed inspection can have consumed another approval.
});

test('D07 — lock ativo/órfão, temporário, arquivo ausente ou desconhecido bloqueia antes de ler bytes', async t => {
  for (const scenario of ['lock', 'temporary', 'unknown', 'missing-state', 'missing-claim']) {
    await t.test(scenario, async child => {
      const s = await scratch(child);
      if (scenario.startsWith('missing-')) await fs.unlink(scenario === 'missing-state' ? s.stateFile : s.claimFile);
      else await fs.writeFile(path.join(s.directory, scenario === 'lock' ? LAB_LOCK_FILE : scenario === 'temporary' ? 'synthetic.tmp' : 'unknown.json'), 'SYNTHETIC');
      const before = await fs.readdir(s.directory); child.mock.method(fs, 'open', forbidden);
      await assert.rejects(s.run(), { code: scenario === 'lock' ? 'LAB_DIAGNOSE_CONCURRENT_OPERATION' : 'LAB_DIAGNOSE_INCOMPLETE_DIRECTORY' });
      assert.deepEqual(await fs.readdir(s.directory), before);
    });
  }
});

test('D08 — confirmação de repouso ausente ou runtime inseguro bloqueia antes de qualquer leitura', async () => {
  for (const extra of [{ LEVEL_DRIVE_LAB_DIAGNOSE_QUIESCENT: undefined }, { LEVEL_DRIVE_LAB_DIAGNOSE_QUIESCENT: 'TRUE' },
    { DEBUG: '*' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { NODE_OPTIONS: '--inspect' }]) {
    await assert.rejects(runDiagnoseCommand({ execute: true, env: { ...executeEnv('SYNTHETIC'), ...extra } }, { makeReader: forbidden }));
  }
});

test('D09 — diretório interno/relativo/UNC, junction/symlink e hardlink são recusados', async t => {
  const s = await scratch(t);
  for (const directory of ['relative', REPOSITORY, '\\\\synthetic-server\\synthetic-share']) {
    await assert.rejects(runDiagnoseCommand({ execute: true, env: executeEnv(directory) }));
  }
  const junction = path.join(s.root, 'synthetic-junction'); await fs.symlink(s.directory, junction, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(runDiagnoseCommand({ execute: true, env: executeEnv(junction) }), { code: 'SYMBOLIC_PATH_FORBIDDEN' });
  const hardlink = path.join(s.root, 'synthetic-hardlink'); await fs.link(s.claimFile, hardlink);
  await assert.rejects(s.run(), { code: 'HARDLINK_FILE_FORBIDDEN' });
});

test('D10 — ACL insegura de diretório, journal ou claim é recusada sem alterar permissões', async t => {
  for (const where of ['directory', 'journal', 'claim']) await t.test(where, async child => {
    const s = await scratch(child), filename = where === 'directory' ? s.directory : where === 'journal' ? s.stateFile : s.claimFile;
    if (process.platform === 'win32') await execFileAsync('icacls.exe', [filename, '/grant', '*S-1-1-0:R'], { windowsHide: true });
    else await fs.chmod(filename, where === 'directory' ? 0o755 : 0o644);
    await assert.rejects(s.run(), { code: 'PRIVATE_PERMISSIONS_REQUIRED' });
    await assert.rejects(assertPrivatePermissions(filename), { code: 'PRIVATE_PERMISSIONS_REQUIRED' });
  });
});

test('D11 — comparação rejeita mudanças de metadados e de conteúdo entre passagens', async () => {
  for (const revision of [2, undefined]) {
    const h = memory(pair('UNCERTAIN'));
    if (revision === 2) h.reader.snapshot = async () => ({ syntheticRevision: ++h.snapshots === 1 ? 1 : 2 });
    else h.reader.read = async () => { const p = clone(h.value); if (++h.reads === 2) p.state.usedApprovals.push('d'.repeat(64)); return p; };
    await assert.rejects(h.run(), { code: 'LAB_DIAGNOSE_STATE_CHANGED' });
  }
});

test('D12 — filesystem real detecta escrita, substituição, ACL ou lock surgido entre leituras', async t => {
  for (const scenario of ['write', 'replace', 'acl', 'lock', 'transient-lock']) await t.test(scenario, async child => {
    const s = await scratch(child), original = s.reader.read.bind(s.reader); let reads = 0;
    s.reader.read = async () => {
      const value = await original();
      if (++reads === 1) {
        if (scenario === 'write') await fs.appendFile(s.claimFile, ' ');
        if (scenario === 'replace') {
          const tmp = path.join(s.directory, 'synthetic-replacement'); await fs.writeFile(tmp, JSON.stringify(s.value.claim), { mode: 0o600 });
          await fs.rename(tmp, s.claimFile);
        }
        if (scenario === 'acl') {
          if (process.platform === 'win32') await execFileAsync('icacls.exe', [s.claimFile, '/grant', '*S-1-1-0:R'], { windowsHide: true });
          else await fs.chmod(s.claimFile, 0o644);
        }
        if (scenario.endsWith('lock')) {
          const lock = path.join(s.directory, LAB_LOCK_FILE); await fs.writeFile(lock, 'SYNTHETIC');
          if (scenario === 'transient-lock') await fs.unlink(lock);
        }
      }
      return value;
    };
    await assert.rejects(s.run({ makeReader: () => s.reader })); assert.equal(reads, 1);
  });
});

test('D13 — alteração dentro da leitura privada é detectada pelo validador existente', async t => {
  const s = await scratch(t), original = fs.open.bind(fs); let changed = false;
  t.mock.method(fs, 'open', async (filename, ...args) => {
    const handle = await original(filename, ...args);
    if (filename === s.claimFile && !changed) {
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        if (!changed) { changed = true; await fs.appendFile(s.claimFile, ' '); }
        return result;
      };
    }
    return handle;
  });
  await assert.rejects(s.run(), { code: 'PRIVATE_FILE_CHANGED' }); assert.equal(changed, true);
});

test('D14 — execução sintética abre somente os dois arquivos em O_RDONLY, sem escrita, lock, rede ou SDK', async t => {
  const s = await scratch(t, pair('UNCERTAIN')), before = await Promise.all([fs.readFile(s.stateFile), fs.readFile(s.claimFile)]);
  const originalOpen = fs.open.bind(fs), opened = [];
  const mock = t.mock.method(fs, 'open', async (filename, flags, ...rest) => {
    assert.ok([s.stateFile, s.claimFile].includes(filename)); assert.equal(flags, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    opened.push(filename); const handle = await originalOpen(filename, flags, ...rest);
    for (const method of ['write', 'writeFile', 'truncate', 'chmod', 'chown', 'sync', 'datasync']) handle[method] = forbidden;
    return handle;
  });
  const mocks = [];
  for (const key of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rename', 'link', 'symlink', 'unlink', 'rm', 'rmdir', 'chmod', 'chown', 'truncate', 'copyFile', 'utimes']) mocks.push(t.mock.method(fs, key, forbidden));
  for (const key of ['withLock', 'write']) mocks.push(t.mock.method(DriveLabState.prototype, key, forbidden));
  for (const [target, key] of [[http, 'createServer'], [http, 'request'], [https, 'request'], [net, 'connect'],
    [net, 'createServer'], [globalThis, 'fetch']]) mocks.push(t.mock.method(target, key, forbidden));
  assert.equal((await s.run()).stateStable, true); assert.equal(opened.length, 4);
  mock.mock.restore(); for (const item of mocks) item.mock.restore();
  assert.deepEqual(await Promise.all([fs.readFile(s.stateFile), fs.readFile(s.claimFile)]), before);
  assert.deepEqual(await fs.readdir(s.directory), [LAB_CLAIM_FILE, LAB_STATE_FILE]);
});

test('D15 — stdout/stderr contêm só nove campos, inclusive diante de exceção com dados privados', async () => {
  const p = pair('CREATED'), h = memory(p), output = [], sink = { log: v => output.push(v), error: v => output.push(v) };
  assert.equal(await main(['--execute'], executeEnv('SYNTHETIC-PRIVATE-PATH'), sink, { makeReader: () => h.reader }), 0);
  for (const error of [new Error(JSON.stringify(p)), new DriveError('PRIVATE_' + p.claim.ownerPermissionId)]) {
    assert.equal(await main(['--execute'], executeEnv('SYNTHETIC-PRIVATE-PATH'), sink,
      { makeReader: () => ({ snapshot: async () => { throw error; } }) }), 1);
  }
  const values = [...Object.values(p.claim), ...p.state.usedApprovals, p.state.creation.rootId, p.state.creation.folderId, 'SYNTHETIC-PRIVATE-PATH'];
  for (const line of output) {
    assert.deepEqual(Object.keys(JSON.parse(line)), KEYS);
    for (const value of values) {
      assert.ok(!line.includes(value)); assert.ok(!line.includes(createHash('sha256').update(value).digest('hex')));
    }
  }
});

test('D16 — falhas de leitura/stabilidade não repetem automaticamente o diagnóstico', async () => {
  const h = memory(); h.reader.read = async () => { h.reads++; throw new Error('SYNTHETIC-PRIVATE'); };
  await assert.rejects(h.run()); assert.equal(h.reads, 1); assert.equal(h.snapshots, 1);
});

test('D17 — baseline 91c725f: testes anteriores e módulos operacionais intactos; somente script adicionado', async () => {
  const allowed = new Set(['tools/live-experience-local/package.json', 'tools/live-experience-local/README.md', 'tools/live-experience-local/GOOGLE_DRIVE_LAB.md']);
  const recorded = JSON.parse(await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/test/preservation-baseline.json'), 'utf8')).files;
  const { stdout } = await execFileAsync('git', ['ls-tree', '-r', '--name-only', '-z', '91c725f'], { cwd: REPOSITORY });
  for (const name of stdout.split('\0').filter(Boolean)) {
    if (allowed.has(name)) continue;
    const baseline = await execFileAsync('git', ['show', '91c725f:' + name], { cwd: REPOSITORY, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(REPOSITORY, name))).digest('hex'), recorded[name] ?? createHash('sha256').update(baseline.stdout).digest('hex'), name);
  }
  const baseline = JSON.parse((await execFileAsync('git', ['show', '91c725f:tools/live-experience-local/package.json'], { cwd: REPOSITORY })).stdout);
  const current = JSON.parse(await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/package.json'), 'utf8'));
  assert.equal(current.scripts['drive:lab-diagnose'], 'node src/drive-lab-diagnose.mjs'); delete current.scripts['drive:lab-diagnose'];
  assert.deepEqual(current, baseline);
  const source = await fs.readFile(path.join(REPOSITORY, 'tools/live-experience-local/src/drive-lab-diagnose.mjs'), 'utf8');
  assert.ok(!/\b(?:withLock|authorizedSession|loadGoogleSdk|loadPrivateDriveIdentity)\s*\(|fs\.(?:write|rename|link|unlink|mkdir)|googleapis|from ['"]\.\/(?:drive-auth|drive-lab|engine|http)\.mjs/.test(source));
});
