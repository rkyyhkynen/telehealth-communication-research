import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

const includeFullStack = process.argv.includes('--full');
const includePeer = includeFullStack || process.argv.includes('--with-peerjs');
const includeApi = includeFullStack || process.argv.includes('--with-api');
const showHelp = process.argv.includes('--help') || process.argv.includes('-h');

const children = new Set();
let shuttingDown = false;

function killChildTree(child, signal) {
  if (!child || typeof child.pid !== 'number' || child.pid <= 0) {
    return;
  }
  try {
    if (isWindows) {
      child.kill(signal);
      return;
    }
    // On Unix, kill the full process group so npm child processes are not orphaned.
    process.kill(-child.pid, signal);
  } catch {
    // Ignore if the process is already gone.
  }
}

function run(command, args, label) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
    detached: !isWindows
  });
  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) {
      return;
    }
    if (code === 0) {
      return;
    }
    const reason = code !== null ? `exit code ${code}` : `signal ${signal}`;
    console.error(`[dev-runner] ${label} stopped with ${reason}. Shutting down the rest.`);
    shutdown(code ?? 1);
  });

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev-runner] Failed to start ${label}:`, error);
    shutdown(1);
  });
}

function runNpm(script, label = script) {
  run(npmCommand, ['run', script], label);
}

function runBuild(script) {
  const result = spawnSync(npmCommand, ['run', script], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    killChildTree(child, 'SIGTERM');
  }

  setTimeout(() => {
    for (const child of children) {
      killChildTree(child, 'SIGKILL');
    }
    process.exit(exitCode);
  }, 1000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (showHelp) {
  console.log('Usage: node scripts/dev-runner.mjs [--full] [--with-peerjs] [--with-api]');
  process.exit(0);
}

if (!isWindows && includeApi) {
  // Clean stale API processes from previously interrupted runs.
  spawnSync('pkill', ['-f', 'python api/server.py'], { stdio: 'ignore' });
}

runBuild('web:build');
runBuild('build:server');

runNpm('watch:server');
runNpm('serve:server');

if (includePeer) {
  runNpm('peerjs', 'peerjs');
}

if (includeApi) {
  runNpm('api', 'api');
}
