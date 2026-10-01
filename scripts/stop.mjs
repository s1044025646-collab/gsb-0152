// Stop only the API process previously started by scripts/start.mjs.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = resolve(root, 'tmp', 'server.pid');
if (!existsSync(pidFile)) {
  console.log('no managed server found');
  process.exit(0);
}
const pid = Number(readFileSync(pidFile, 'utf8').trim());
try {
  process.kill(pid);
  console.log(`stopped managed server pid ${pid}`);
} catch (err) {
  if (err.code !== 'ESRCH') throw err;
  console.log(`pid ${pid} already exited`);
} finally {
  rmSync(pidFile, { force: true });
}
