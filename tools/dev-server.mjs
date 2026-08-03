import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const root = process.cwd();

try {
  process.loadEnvFile(path.join(root, '.env.local'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const port = process.env.PORT || '3001';
const appOrigin = process.env.APP_ORIGIN || `http://127.0.0.1:${port}`;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const execFileAsync = promisify(execFile);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed (${signal || code})`));
    });
  });
}

function packageManagerCommand() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, 'run', 'build'],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'build'],
  };
}

async function listeningPids() {
  try {
    const { stdout } = await execFileAsync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN']);
    return stdout
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function cwdForPid(pid) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const cwdLine = stdout.split('\n').find((line) => line.startsWith('n'));
    return cwdLine ? cwdLine.slice(1) : '';
  } catch {
    return '';
  }
}

async function wait(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function releaseProjectPort() {
  const pids = await listeningPids();
  if (!pids.length) return;

  for (const pid of pids) {
    const cwd = await cwdForPid(pid);
    if (cwd !== root) {
      throw new Error(`端口 ${port} 被其它进程占用：PID ${pid}${cwd ? ` (${cwd})` : ''}`);
    }

    console.log(`=> 停掉旧菜单服务 PID ${pid}...`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }

  await wait(500);

  const remaining = await listeningPids();
  if (remaining.length) {
    throw new Error(`端口 ${port} 仍被占用：${remaining.join(', ')}`);
  }
}

await releaseProjectPort();

console.log('=> 构建前端静态产物...');
const build = packageManagerCommand();
await run(build.command, build.args);

console.log(`=> 启动菜单服务 ${appOrigin}`);
const server = spawn(
  process.execPath,
  ['--import', 'tsx', '--conditions=react-server', 'server.js'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: port,
      APP_ORIGIN: appOrigin,
      DATA_DIR: dataDir,
    },
  },
);

function stopServer() {
  if (!server.killed) server.kill('SIGTERM');
}

process.on('SIGINT', () => {
  stopServer();
});
process.on('SIGTERM', () => {
  stopServer();
});

server.on('exit', (code) => {
  process.exit(code || 0);
});
