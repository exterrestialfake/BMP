import { PlaybackController } from '../../src/controller.js';
import { SharedPlaybackController } from '../../src/shared.js';
import type { PlaybackSnapshot, PlayerPort } from '../../src/player.js';
import type { Candidate } from '../../src/video.js';

const candidates: Candidate[] = [1, 2].map((n) => ({
  candidate_id: String(n), bvid: `BV1vx411w7H${n}`, title: `候选 ${n}`,
  uploader: 'UP 主', duration_seconds: 100, published_date: null, cover_url: null, url: `https://www.bilibili.com/video/BV1vx411w7H${n}`
}));

class FakePlayer implements PlayerPort {
  snapshot: PlaybackSnapshot = { state: 'idle', position_seconds: null, duration_seconds: null, volume: 50, recent_error: null };
  async load(_url: string) { this.snapshot.state = 'playing' as const; return this.snapshot; }
  async setPaused(paused: boolean) { this.snapshot.state = paused ? 'paused' : 'playing'; return this.snapshot; }
  async setVolume(volume: number) { this.snapshot.volume = volume; return this.snapshot; }
  async status() { return this.snapshot; }
  close() {}
}

const pipe = process.argv[2];
if (!pipe) throw new Error('缺少测试管道名');
const hub = new SharedPlaybackController(new PlaybackController({ search: async () => candidates }, new FakePlayer()), pipe);
await hub.status();
process.stdout.write('READY\n');
process.stdin.resume();
process.stdin.on('end', () => hub.close());
