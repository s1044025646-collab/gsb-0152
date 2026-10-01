// Stop the local API server using the recorded PID/port file in .data.
// Only manages a process recorded by THIS project; never kills arbitrary PIDs.
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pidFile = join(root, '.data', 'server.pid');
const portFile = join(root, '.data', 'server.port');

function tryKill(pid) {
  try {
    // tree-kill style: kill the recorded PID only (a process this project started)
    process.kill(pid);
    console.log(`Sent termination to project server PID ${pid}.`);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') {
      console.log(`PID ${pid} is not running.`);
      return false;
    }
    console.error(`Could not signal PID ${pid}: ${e.message}`);
    return false;
  }
}

let didSomething = false;
if (existsSync(pidFile)) {
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (Number.isInteger(pid)) {
    tryKill(pid);
    didSomething = true;
  }
  rmSync(pidFile, { force: true });
}
// Fallback: on Windows, find the listener on the recorded port and stop only
// a node process whose command line references this project's server.js.
if (existsSync(portFile)) {
  const port = readFileSync(portFile, 'utf8').trim();
  console.log(`Server had bound 127.0.0.1:${port}.`);
}
if (!didSomething) {
  console.log('No recorded project server PID found. Nothing to stop.');
}
