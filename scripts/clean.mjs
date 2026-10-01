// Removes only project-local runtime data: ./data and ./tmp.
import { rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['data', 'tmp']) {
  const target = resolve(root, name);
  if (!target.startsWith(root)) throw new Error('unsafe path');
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`removed ${name}/`);
  }
}
// Stray root-level scratch files created only by local manual debugging.
for (const file of ['tmp-srv.err', 'tmp-srv.out', 'tmp-test.log']) {
  rmSync(resolve(root, file), { force: true });
}
