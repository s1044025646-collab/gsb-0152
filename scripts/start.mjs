// Start the local-only API as a project-managed background process.
// Binds exclusively to 127.0.0.1 on an OS-assigned free port; records the pid
// and endpoint under ./tmp so stop.mjs can terminate only this process.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'tmp'), { recursive: true });
mkdirSync(resolve(root, 'data'), { recursive: true });
const pidFile = resolve(root, 'tmp', 'server.pid');
if (existsSync(pidFile)) {
  console.error('server already started (tmp/server.pid exists); run: npm run stop');
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ['--experimental-sqlite', resolve(root, 'src', 'main.ts'), 'serve', '--db', resolve(root, 'data', 'poly.db')],
  {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
writeFileSync(pidFile, String(child.pid));
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});
child.stderr.on('data', () => {});
setTimeout(() => process.exit(0), 1500);
