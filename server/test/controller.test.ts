import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackController } from '../src/controller.js';
import { canonicalVideoUrl, type Candidate } from '../src/video.js';
import type { PlayerPort, PlaybackSnapshot } from '../src/player.js';

const candidates: Candidate[] = [1, 2, 3].map((n) => ({
  candidate_id: String(n), bvid: `BV1vx411w7H${n}`, title: `候选 ${n}`,
  uploader: 'UP 主', duration_seconds: 100, url: `https://www.bilibili.com/video/BV1vx411w7H${n}`
}));

class FakePlayer implements PlayerPort {
  loaded: string[] = [];
  failUrl: string | null = null;
  snapshot: PlaybackSnapshot = { state: 'idle', position_seconds: null, duration_seconds: null, volume: 50, recent_error: null };
  async load(url: string): Promise<PlaybackSnapshot> {
    if (url === this.failUrl) throw new Error('模拟加载失败');
    this.loaded.push(url);
    this.snapshot.state = 'playing';
    return this.snapshot;
  }
  async setPaused(paused: boolean) { this.snapshot.state = paused ? 'paused' : 'playing'; return this.snapshot; }
  async setVolume(volume: number) { this.snapshot.volume = volume; return this.snapshot; }
  async stop() { this.snapshot.state = 'idle'; return this.snapshot; }
  async status() { return this.snapshot; }
  close() {}
}

test('搜索只返回候选；选定后 next 按同次顺序播放，不自动切歌', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('十面埋伏', 3);
  assert.equal(player.loaded.length, 0);
  await controller.playSelection(search.search_id, '2');
  assert.deepEqual(player.loaded, [candidates[1].url]);
  assert.equal((await controller.status()).remaining_candidates, 1);
  await controller.next();
  assert.deepEqual(player.loaded, [candidates[1].url, candidates[2].url]);
  await assert.rejects(controller.next(), /没有下一条/);
});

test('加载失败时保留当前候选位置；直接播放清除下一候选', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  player.failUrl = candidates[1].url;
  await assert.rejects(controller.next(), /模拟加载失败/);
  assert.equal((await controller.status()).current?.candidate_id, '1');
  player.failUrl = null;
  await controller.next();
  assert.equal((await controller.status()).current?.candidate_id, '2');
  await controller.playDirect('BV1vx411w7Hc');
  await assert.rejects(controller.next(), /没有同次搜索/);
});

test('视频输入只接受 BV 或精确的 HTTPS B 站视频地址', () => {
  assert.equal(canonicalVideoUrl('BV1vx411w7Hc'), 'https://www.bilibili.com/video/BV1vx411w7Hc');
  assert.equal(canonicalVideoUrl('https://m.bilibili.com/video/BV1vx411w7Hc?p=1'), 'https://www.bilibili.com/video/BV1vx411w7Hc');
  for (const input of ['https://bilibili.com.evil.test/video/BV1vx411w7Hc', 'http://www.bilibili.com/video/BV1vx411w7Hc', 'https://www.bilibili.com/read/BV1vx411w7Hc', '十面埋伏']) {
    assert.throws(() => canonicalVideoUrl(input));
  }
});
