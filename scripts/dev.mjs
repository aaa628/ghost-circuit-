// Runs the local API server and the Vite dev client together, with prefixed
// output, and stops both when either exits or you press Ctrl+C.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const procs = [
  { name: 'server', color: '\x1b[35m', cmd: 'npm', args: ['run', '--silent', 'dev:server'] },
  { name: 'client', color: '\x1b[36m', cmd: 'npm', args: ['run', '--silent', 'dev:client'] },
];

const children = [];
let shuttingDown = false;

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 400);
}

for (const p of procs) {
  const child = spawn(p.cmd, p.args, { shell: isWin, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `${p.color}[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`${prefix}exited with code ${code ?? 0}`);
      stopAll(code ?? 0);
    }
  });
  children.push(child);
}

console.log('\n  🏁 Ghost Circuit dev: open \x1b[1mhttp://localhost:5173/\x1b[0m  (API on :8787)\n');
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
