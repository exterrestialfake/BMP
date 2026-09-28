import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PlaybackController } from '../src/controller.js';
import { SharedPlaybackController } from '../src/shared.js';
import type { PlayerPort, PlaybackSnapshot } from '../src/player.js';
import type { Candidate } from '../src/video.js';

const candidates: Candidate[] = [1, 2].map((n) => ({
  candidate_id: String(n), bvid: `BV1vx411w7H${n}`, title: `候选 ${n}`,
  uploader: 'UP 主', duration_seconds: 100, published_date: null, cover_url: null, url: `https://www.bilibili.com/video/BV1vx411w7H${n}`
}));

class FakePlayer implements PlayerPort {
  loaded: string[] = [];
  snapshot: PlaybackSnapshot = { state: 'idle', position_seconds: null, duration_seconds: null, volume: 50, recent_error: null };
  async load(url: string) { this.loaded.push(url); this.snapshot.state = 'playing' as const; return this.snapshot; }
  async setPaused(paused: boolean) { this.snapshot.state = paused ? 'paused' : 'playing'; return this.snapshot; }
  async setVolume(volume: number) { this.snapshot.volume = volume; return this.snapshot; }
  async stop() { this.snapshot.state = 'idle' as const; return this.snapshot; }
  async status() { return this.snapshot; }
  close() {}
}

test('不同 MCP 实例共享候选、播放状态和停止命令', async () => {
  const pipe = `\\\\.\\pipe\\bilibili-audio-test-${randomUUID()}`;
  const ownerPlayer = new FakePlayer();
  const otherPlayer = new FakePlayer();
  const owner = new SharedPlaybackController(new PlaybackController({ search: async () => candidates }, ownerPlayer), pipe);
  const other = new SharedPlaybackController(new PlaybackController({ search: async () => candidates }, otherPlayer), pipe);
  try {
    await owner.status();
    const search = await owner.search('琵琶曲');
    await other.playSelection(search.search_id, '1');
    assert.deepEqual(ownerPlayer.loaded, [candidates[0].url]);
    assert.deepEqual(otherPlayer.loaded, []);
    assert.equal((await other.setPaused(true)).state, 'paused');
    assert.equal((await owner.status()).state, 'paused');
    await other.playSelection(search.search_id, '2');
    assert.equal((await other.previous()).current?.candidate_id, '1');
    assert.equal((await other.next()).current?.candidate_id, '2');
    assert.equal((await owner.stop()).state, 'paused');
    assert.equal((await other.status()).state, 'paused');
  } finally {
    other.close();
    owner.close();
  }
});

test('独立进程中的新会话可控制主实例', async () => {
  const pipe = `\\\\.\\pipe\\bilibili-audio-test-${randomUUID()}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/shared-owner.ts', pipe], {
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
  });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('主实例启动超时')), 10_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (chunk.includes('READY')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`主实例提前退出 ${code}: ${stderr}`)); });
  });
  const localPlayer = new FakePlayer();
  const other = new SharedPlaybackController(new PlaybackController({ search: async () => [] }, localPlayer), pipe);
  try {
    await ready;
    const search = await other.search('琵琶曲');
    assert.equal(search.candidates.length, 2);
    await other.playSelection(search.search_id, '1');
    assert.equal((await other.setPaused(true)).state, 'paused');
    await other.playSelection(search.search_id, '2');
    assert.equal((await other.previous()).current?.candidate_id, '1');
    assert.equal((await other.stop()).state, 'paused');
    assert.deepEqual(localPlayer.loaded, []);
  } finally {
    other.close();
    const exit = once(child, 'exit');
    child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([exit, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('测试主实例未退出')), 5_000);
      })]);
    } finally {
      if (timer) clearTimeout(timer);
      if (child.exitCode === null) child.kill();
    }
  }
});
