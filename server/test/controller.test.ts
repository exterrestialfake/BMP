import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackController } from '../src/controller.js';
import { candidateFromYtDlp, canonicalVideoUrl, type Candidate } from '../src/video.js';
import type { PlayerPort, PlaybackSnapshot } from '../src/player.js';

const candidates: Candidate[] = [1, 2, 3].map((n) => ({
  candidate_id: String(n), bvid: `BV1vx411w7H${n}`, title: `候选 ${n}`,
  uploader: 'UP 主', duration_seconds: 100, published_date: null, cover_url: null, url: `https://www.bilibili.com/video/BV1vx411w7H${n}`
}));

class FakePlayer implements PlayerPort {
  loaded: string[] = [];
  failUrl: string | null = null;
  snapshot: PlaybackSnapshot = { state: 'idle', position_seconds: null, duration_seconds: null, volume: 50, recent_error: null };
  ended?: () => void;
  loop = false;
  pauseRequests: boolean[] = [];
  onEnded(listener: () => void) { this.ended = listener; }
  async setLoop(enabled: boolean) { this.loop = enabled; }
  async load(url: string): Promise<PlaybackSnapshot> {
    if (url === this.failUrl) throw new Error('模拟加载失败');
    this.loaded.push(url);
    this.snapshot.state = 'playing';
    return this.snapshot;
  }
  async setPaused(paused: boolean) {
    if (this.snapshot.state !== 'playing' && this.snapshot.state !== 'paused') throw new Error('当前视频未在播放');
    this.pauseRequests.push(paused);
    this.snapshot.state = paused ? 'paused' : 'playing';
    return this.snapshot;
  }
  async setVolume(volume: number) { this.snapshot.volume = volume; return this.snapshot; }
  async status() { return this.snapshot; }
  close() {}
}

test('搜索只返回候选；播放历史导航不自动选取搜索候选', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('十面埋伏', 3);
  assert.equal(player.loaded.length, 0);
  await controller.playSelection(search.search_id, '2');
  assert.deepEqual(player.loaded, [candidates[1].url]);
  const state = await controller.status();
  assert.deepEqual(state.current, candidates[1], '当前视频应保留完整候选信息');
  assert.equal('remaining_candidates' in state, false);
  assert.equal('history' in state, false, '快照不传输完整历史');
  await assert.rejects(controller.next(), /历史已在末尾/);
  await controller.playSelection(search.search_id, '3');
  await controller.previous();
  await controller.next();
  assert.deepEqual(player.loaded, [candidates[1].url, candidates[2].url, candidates[1].url, candidates[2].url]);
  assert.equal((await controller.status()).history_length, 2);
  await assert.rejects(controller.next(), /历史已在末尾/);
});

test('新搜索使旧候选失效；加载失败不追加历史；暂停保留历史', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  player.failUrl = candidates[1].url;
  await assert.rejects(controller.playSelection(search.search_id, '2'), /模拟加载失败/);
  assert.equal((await controller.status()).current?.candidate_id, '1');
  assert.equal((await controller.status()).history_length, 1);
  player.failUrl = null;
  const fresh = await controller.search('另一首');
  assert.deepEqual((await controller.status()).current, candidates[0], '新搜索不改变当前播放');
  await assert.rejects(controller.playSelection(search.search_id, '2'), /候选列表已过期/);
  await controller.playSelection(fresh.search_id, '2');
  await controller.playDirect('BV1vx411w7Hc');
  assert.equal((await controller.setPaused(true)).state, 'paused');
  assert.equal((await controller.status()).history_length, 3);
});

test('空闲、结束或失败时暂停不报错；恢复仍要求可播放的视频', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  for (const state of ['idle', 'ended', 'error'] as const) {
    player.snapshot.state = state;
    assert.equal((await controller.setPaused(true)).state, state);
    await assert.rejects(controller.setPaused(false), /当前视频未在播放/);
  }
  assert.deepEqual(player.pauseRequests, [], '空闲暂停不应向播放器发出无效命令');
  await controller.playDirect(candidates[0].bvid);
  assert.equal((await controller.setPaused(true)).state, 'paused');
  assert.equal((await controller.setPaused(false)).state, 'playing');
  assert.deepEqual(player.pauseRequests, [true, false]);
});

test('并发搜索只保留最新候选，较早发起的搜索不能覆盖它', async () => {
  let completeFirst!: (value: Candidate[]) => void;
  const controller = new PlaybackController({ search: async (query: string) => query === '旧搜索'
    ? new Promise<Candidate[]>((resolve) => { completeFirst = resolve; })
    : [candidates[1]] }, new FakePlayer());
  const first = controller.search('旧搜索');
  const rejected = assert.rejects(first, /被更新的搜索取代/);
  const latest = await controller.search('新搜索');
  completeFirst([candidates[0]]);
  await rejected;
  assert.deepEqual((await controller.playSelection(latest.search_id, '2')).current, candidates[1]);
  await assert.rejects(controller.playSelection(latest.search_id, '1'), /候选编号不属于/);
});

test('手动和顺序切歌加载失败时保留历史游标及当前视频', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  await controller.playSelection(search.search_id, '2');
  await controller.previous();
  player.failUrl = candidates[1].url;
  await assert.rejects(controller.next(), /模拟加载失败/);
  await controller.setMode('sequential');
  player.ended?.();
  await new Promise((resolve) => setImmediate(resolve));
  const failed = await controller.status();
  assert.equal(failed.history_position, 1);
  assert.equal(failed.history_length, 2);
  assert.deepEqual(failed.current, candidates[0]);
  player.failUrl = null;
  await controller.next();
  player.failUrl = candidates[0].url;
  await assert.rejects(controller.previous(), /模拟加载失败/);
  assert.equal((await controller.status()).history_position, 2);
  assert.deepEqual((await controller.status()).current, candidates[1]);
});

test('排队中的历史导航完成后忽略旧视频的自然结束事件', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  await controller.playSelection(search.search_id, '2');
  await controller.setMode('sequential');
  const previous = controller.previous();
  player.ended?.();
  await previous;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await controller.status()).history_position, 1);
  assert.deepEqual(player.loaded, [candidates[0].url, candidates[1].url, candidates[0].url]);
});

test('单曲循环不追加历史', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  await controller.setMode('single');
  assert.equal(player.loop, true);
  assert.equal((await controller.status()).history_length, 1);
  assert.deepEqual(player.loaded, [candidates[0].url]);
});

test('重复点播同一 BV 时删除旧位置并移到历史末尾', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  await controller.playSelection(search.search_id, '2');
  await controller.playSelection(search.search_id, '3');
  await controller.previous();
  const moved = await controller.playSelection(search.search_id, '1');
  assert.equal(moved.history_length, 3);
  assert.equal(moved.history_position, 3);
  assert.equal(moved.current?.bvid, candidates[0].bvid);
  await controller.previous();
  assert.equal((await controller.status()).current?.bvid, candidates[2].bvid);
  await controller.previous();
  assert.equal((await controller.status()).current?.bvid, candidates[1].bvid);
  await controller.next();
  assert.equal((await controller.status()).current?.bvid, candidates[2].bvid);
  await controller.next();
  assert.equal((await controller.status()).current?.bvid, candidates[0].bvid);
  await assert.rejects(controller.next(), /历史已在末尾/);
  await controller.previous();
  await controller.previous();
  await controller.setMode('sequential');
  player.ended?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await controller.status()).current?.bvid, candidates[2].bvid);
  player.ended?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await controller.status()).current?.bvid, candidates[0].bvid);
});

test('搜索候选与直接 BV 点播同一视频也只保留一条；加载失败不移动旧记录', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  await controller.playSelection(search.search_id, '2');
  player.failUrl = candidates[0].url;
  await assert.rejects(controller.playDirect(candidates[0].bvid), /模拟加载失败/);
  assert.equal((await controller.status()).history_position, 2);
  assert.equal((await controller.status()).history_length, 2);
  player.failUrl = null;
  await controller.playDirect(candidates[0].bvid);
  assert.equal((await controller.status()).history_length, 2);
  assert.equal((await controller.status()).current?.title, candidates[0].title);
  await controller.previous();
  assert.equal((await controller.status()).current?.bvid, candidates[1].bvid);
});

test('顺序模式沿播放历史前进，与下一首使用同一游标', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  await controller.playSelection(search.search_id, '2');
  await controller.previous();
  await controller.setMode('sequential');
  player.ended?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await controller.status()).current?.candidate_id, '2');
  assert.equal((await controller.status()).history_position, 2);
  assert.equal((await controller.status()).history_length, 2);
  player.ended?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await controller.status()).current?.candidate_id, '2');
  assert.equal(player.loaded.length, 4, '历史末尾应停播，不循环或自动读取搜索候选');
});

test('只有一条播放历史时，顺序模式不自动选择未点播的搜索候选', async () => {
  const player = new FakePlayer();
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const search = await controller.search('琵琶');
  await controller.playSelection(search.search_id, '1');
  await controller.setMode('sequential');
  player.ended?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(player.loaded, [candidates[0].url]);
  assert.equal((await controller.status()).history_length, 1);
});

test('视频输入只接受 BV 或精确的 HTTPS B 站视频地址', () => {
  assert.equal(canonicalVideoUrl('BV1vx411w7Hc'), 'https://www.bilibili.com/video/BV1vx411w7Hc');
  assert.equal(canonicalVideoUrl('https://m.bilibili.com/video/BV1vx411w7Hc?p=1'), 'https://www.bilibili.com/video/BV1vx411w7Hc');
  for (const input of ['https://bilibili.com.evil.test/video/BV1vx411w7Hc', 'http://www.bilibili.com/video/BV1vx411w7Hc', 'https://www.bilibili.com/read/BV1vx411w7Hc', '十面埋伏']) {
    assert.throws(() => canonicalVideoUrl(input));
  }
});

test('候选日期与封面规范化，缺失或非 B 站封面退化为文字', () => {
  const candidate = candidateFromYtDlp({ id: 'BV1vx411w7Hc', pubdate: 1336233244, pic: '//i0.hdslb.com/bfs/archive/example.jpg' }, 1);
  assert.equal(candidate?.published_date, '2012-05-05');
  assert.equal(candidate?.cover_url, 'https://i0.hdslb.com/bfs/archive/example.jpg');
  const midnight = candidateFromYtDlp({ id: 'BV1vx411w7Hc', pubdate: Date.UTC(2026, 8, 15, 17) / 1000 }, 1);
  assert.equal(midnight?.published_date, '2026-09-16');
  const invalid = candidateFromYtDlp({ id: 'BV1vx411w7Hc', pic: 'https://example.com/image.jpg' }, 2);
  assert.equal(invalid?.published_date, null);
  assert.equal(invalid?.cover_url, null);
});
