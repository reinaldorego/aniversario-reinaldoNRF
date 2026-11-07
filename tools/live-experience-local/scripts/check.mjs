import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let count = 0;
for (const directory of ['src', 'test', 'scripts']) {
  for (const name of await readdir(path.join(root, directory))) if (name.endsWith('.mjs')) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, directory, name)], { encoding: 'utf8' });
    if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
    count++;
  }
}
console.log('Sintaxe JavaScript válida: ' + count + ' arquivos.');
