import * as fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_BYTES, sha256 } from './png.mjs';

export const FOLDERS = ['01_ORIGINAIS', '02_PUBLICAR_NA_GALERIA', '03_RETIRADAS'];
export class LocalSource {
  constructor(root) { this.root = root; this.editorial = path.join(root, FOLDERS[1]); }
  async init() {
    for (const name of [...FOLDERS, 'derivatives']) {
      const target = path.join(this.root, name);
      await fs.mkdir(target, { recursive: true });
      if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('SYMLINK_DIRECTORY');
    }
  }
  async read(name) {
    if (name !== path.basename(name) || name.includes('\0')) throw new Error('INVALID_NAME');
    const filename = path.join(this.editorial, name);
    const before = await fs.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error('NOT_REGULAR_FILE');
    if (before.size > MAX_BYTES) return { name, hash: null, fingerprint: 'oversize:' + before.size + ':' + before.mtimeMs, size: before.size, invalid: 'BYTE_LIMIT' };
    const file = await fs.open(filename, 'r');
    try {
      const opened = await file.stat();
      if (opened.ino !== before.ino || opened.size !== before.size) throw new Error('UNSTABLE_READ');
      const bytes = Buffer.alloc(before.size + 1);
      let total = 0;
      while (total < bytes.length) {
        const read = await file.read(bytes, total, bytes.length - total, total);
        if (!read.bytesRead) break;
        total += read.bytesRead;
      }
      const after = await fs.lstat(filename);
      if (!after.isFile() || after.isSymbolicLink() || total !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new Error('UNSTABLE_READ');
      const data = bytes.subarray(0, total), hash = sha256(data);
      return { name, data, hash, size: total, fingerprint: hash + ':' + before.mtimeMs + ':' + before.ino };
    } finally { await file.close(); }
  }
  async list(mode = 'complete') {
    if (mode === 'error') throw new Error('SIMULATED_LIST_ERROR');
    const names = (await fs.readdir(this.editorial)).sort();
    if (names.length > 200) throw new Error('LOCAL_FILE_LIMIT');
    const entries = [];
    for (const name of names) entries.push(await this.read(name));
    const after = (await fs.readdir(this.editorial)).sort();
    return { complete: mode === 'complete' && JSON.stringify(after) === JSON.stringify(names), entries };
  }
}
