import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Simulator } from './engine.mjs';
import { DEFAULT_ROOT } from './storage.mjs';
import { FOLDERS } from './local-source.mjs';
import { syntheticPng } from './fixtures.mjs';

async function main() {
  const command = process.argv[2] ?? 'start';
  if (!['init', 'seed', 'start', 'status'].includes(command)) throw new Error('USE_INIT_SEED_START_STATUS');
  const root = process.env.LEVEL_LOCAL_DATA_DIR || DEFAULT_ROOT;
  const stableMs = Number(process.env.LEVEL_LOCAL_STABLE_MS ?? 1000);
  const interval = Number(process.env.LEVEL_LOCAL_SCAN_MS ?? 2000);
  if (!Number.isInteger(interval) || interval < 50 || interval > 60000) throw new Error('INVALID_SCAN_INTERVAL');
  const engine = await Simulator.open({ root, stableMs, freshMs: Math.max(15000, interval * 3, stableMs * 2) });
  if (command !== 'start') {
    try {
      if (command === 'seed') for (const seed of [1, 2, 3]) {
        const filename = path.join(engine.store.root, FOLDERS[0], 'SYNTHETIC-' + seed + '.png');
        try { await fs.writeFile(filename, syntheticPng(seed), { flag: 'wx' }); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      console.log(JSON.stringify({ dataDirectory: engine.store.root, ...engine.status() }, null, 2));
    } finally { await engine.close(); }
    return;
  }
  let server;
  try { server = await (await import('./http.mjs')).startHttp(engine, Number(process.env.LEVEL_LOCAL_PORT ?? 8787)); }
  catch (error) { await engine.close(); throw error; }
  console.log('SIMULADOR SINTÉTICO LOCAL — SEM AUTENTICAÇÃO DE PRODUÇÃO');
  console.log('Dados fora do site: ' + engine.store.root);
  console.log('API somente leitura: http://127.0.0.1:' + server.address().port + '/v1/photos');
  console.log('Console: permissions allowed|denied|indeterminate; resume; pause; demo; scan; retry; listing complete|incomplete|error; status; quit');
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
  let stopped = false, cycleRunning = false, timer, active = Promise.resolve(), commands = Promise.resolve();
  const tick = () => {
    if (stopped || cycleRunning) return active;
    cycleRunning = true;
    active = engine.cycle().catch(() => { console.error('CYCLE_FAILED_CLOSED'); }).finally(() => { cycleRunning = false; });
    return active;
  };
  const schedule = () => { if (!stopped) timer = setTimeout(async () => { await tick(); schedule(); }, interval); };
  const stop = async () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); input.close();
    await active;
    await new Promise(resolve => server.close(resolve));
    await engine.close();
  };
  input.on('line', line => {
    commands = commands.then(async () => {
      const [name, value] = line.trim().split(/\s+/);
      if (name === 'quit') return stop();
      if (stopped) return;
      if (name === 'permissions') await engine.setPermissions(value);
      else if (name === 'listing') await engine.setListingMode(value);
      else if (name === 'pause' || name === 'resume') await engine.pause(name === 'pause');
      else if (name === 'retry') await engine.retryFailed();
      else if (name === 'scan') { await active; await tick(); }
      else if (name === 'demo') {
        for (const seed of [1, 2, 3]) {
          const filename = 'SYNTHETIC-' + seed + '.png';
          await fs.copyFile(path.join(engine.store.root, FOLDERS[0], filename), path.join(engine.store.root, FOLDERS[1], filename), fs.constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
        }
      } else if (name !== 'status') console.log('Comando local desconhecido.');
      console.log(JSON.stringify(engine.status()));
    }).catch(() => { console.error('COMMAND_REJECTED'); });
  });
  process.once('SIGINT', () => { commands = commands.then(stop); });
  process.once('SIGTERM', () => { commands = commands.then(stop); });
  await tick(); schedule();
}
main().catch(error => { console.error('SIMULATOR_STOPPED: ' + error.message); process.exitCode = 1; });
