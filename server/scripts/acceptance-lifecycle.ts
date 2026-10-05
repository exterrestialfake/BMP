/** 检查后台退出时的真实进程清理，不退出 Codex，不修改已安装插件。 */
import assert from 'node:assert/strict';
import { spawn, fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'bmp-lifecycle-test-'));
const audio = join(directory, 'silence.wav');
const data = Buffer.alloc(44 + 8000 * 2 * 30);
data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
data.write('data', 36); data.writeUInt32LE(data.length - 44, 40);
await writeFile(audio, data);
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
function terminate(pid?: number): void { if (pid && alive(pid)) process.kill(pid); }
type FixturePids = { mpv: number; panel: number; owner: number };
async function exitWithin(pids: number[], timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (pids.some(alive) && Date.now() < deadline) await delay(100);
  return !pids.some(alive);
}
try {
  for (const forceOwner of [false, true]) {
    const host = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    let owner: ChildProcess | undefined;
    let pids: FixturePids | undefined;
    let errors = '';
    try {
      assert.ok(host.pid);
      owner = fork(resolve('test/fixtures/lifecycle-owner.ts'), ['bmp-lifecycle-' + randomUUID(), String(host.pid), audio],
        { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
      owner.stderr!.on('data', chunk => { errors += String(chunk); });
      pids = await new Promise<FixturePids>((accept, reject) => {
        const timer = setTimeout(() => reject(new Error('退出夹具启动超时：' + errors)), 15_000);
        owner!.once('message', message => { clearTimeout(timer); accept(message as FixturePids); });
        owner!.once('exit', code => { clearTimeout(timer); reject(new Error(`退出夹具提前结束 ${code}：${errors}`)); });
      });
      assert.ok(pids.mpv && pids.panel && alive(pids.mpv) && alive(pids.panel));
      // 给真实面板完成 WPF 初始化和第一次 Tick 的时间。
      await delay(4500);
      assert.ok(alive(pids.panel), '面板在宿主存活时应持续运行：' + errors);
      const start = performance.now();
      terminate(host.pid);
      if (forceOwner) terminate(pids.owner);
      const passed = await exitWithin([pids.mpv, pids.panel], 15_000);
      console.log(JSON.stringify({ scenario: forceOwner ? '后台与主 MCP 同时被结束' : '后台退出、主 MCP 暂时仍存活',
        pids, elapsed_ms: Math.round(performance.now() - start), passed,
        remaining: [pids.mpv, pids.panel].filter(alive) }));
      assert.ok(passed, '退出后不能留下 mpv 或面板');
    } finally {
      if (owner?.connected) owner.send('close');
      terminate(host.pid);
      if (pids) {
        await exitWithin([pids.owner, pids.mpv, pids.panel], 2000);
        [pids.owner, pids.mpv, pids.panel].forEach(terminate);
      } else terminate(owner?.pid);
    }
  }
} finally {
  assert.equal(dirname(directory), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
}
