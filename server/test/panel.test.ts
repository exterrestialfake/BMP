import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PanelSupervisor, spawnPanelProcess } from '../src/panel.js';

function panelProcess(): ChildProcess {
  const process = new EventEmitter() as ChildProcess;
  process.unref = () => process;
  return process;
}

test('真实面板与 mpv 在隔离后台退出、后台与主 MCP 同时退出后均无残留',
  { skip: process.platform !== 'win32', timeout: 50_000 }, async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/acceptance-lifecycle.ts')],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, output);
});

test('后台存在时不因 GUI 消失退出，后台缺失三次后关闭且计数跨 Tick 保留', { skip: process.platform !== 'win32' }, async () => {
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    resolve('scripts', 'test-panel-lifecycle.ps1')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, output);
});

test('Windows 面板启动器会实际执行 PowerShell 脚本', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bmp-panel-spawn-'));
  const script = join(directory, 'probe.ps1');
  try {
    await writeFile(script, 'param([string]$PipeName,[int]$HostProcessId)\nif ($PipeName -ne "test-pipe" -or $HostProcessId -ne 42) { exit 99 }\nexit 13\n');
    const child = spawnPanelProcess(script, 'test-pipe', 42);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 13);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('面板意外退出后重新启动，服务关闭后停止重试', async () => {
  const processes: ChildProcess[] = [];
  const supervisor = new PanelSupervisor(() => {
    const process = panelProcess();
    processes.push(process);
    return process;
  }, 5);

  supervisor.start();
  assert.equal(processes.length, 1);
  processes[0].emit('exit', 1, null);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(processes.length, 2);

  supervisor.stop();
  processes[1].emit('exit', 1, null);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(processes.length, 2);
});

test('主 MCP 仍运行时面板以 0 退出也会重新启动', async () => {
  const processes: ChildProcess[] = [];
  const supervisor = new PanelSupervisor(() => {
    const process = panelProcess();
    processes.push(process);
    return process;
  }, 5);

  supervisor.start();
  processes[0].emit('exit', 0, null);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(processes.length, 2);
  supervisor.stop();
  processes[1].emit('exit', 0, null);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(processes.length, 2);
});

test('真实子进程启动后退出也会触发重试', async () => {
  let starts = 0;
  const supervisor = new PanelSupervisor(() => {
    starts++;
    return spawn(process.execPath, ['-e', 'process.exit(11)'], { stdio: 'ignore', windowsHide: true });
  }, 10);
  supervisor.start();
  const deadline = Date.now() + 2000;
  while (starts < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  supervisor.stop();
  assert.ok(starts >= 2);
});
