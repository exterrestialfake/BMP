import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { PanelSupervisor } from '../src/panel.js';

function panelProcess(): ChildProcess {
  const process = new EventEmitter() as ChildProcess;
  process.unref = () => process;
  return process;
}

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

test('Codex 正常退出导致面板关闭时不重新启动', async () => {
  const processes: ChildProcess[] = [];
  const supervisor = new PanelSupervisor(() => {
    const process = panelProcess();
    processes.push(process);
    return process;
  }, 5);

  supervisor.start();
  processes[0].emit('exit', 0, null);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(processes.length, 1);
  supervisor.stop();
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
