import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PlaybackController } from '../src/controller.js';
import { MpvPlayer } from '../src/player.js';
import type { Candidate } from '../src/video.js';

function silentWav(seconds: number): Buffer {
  const sampleRate = 44100;
  const samples = Math.round(seconds * sampleRate);
  const pcmBytes = samples * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBytes, 40);
  return wav;
}

const dist = resolve('..', 'dist');
const temp = await mkdtemp(join(dist, 'smoke-sequential-'));
if (dirname(temp) !== dist) throw new Error('临时目录路径越界');
const player = new MpvPlayer(resolve('..', 'plugins', 'bilibili-audio', 'vendor', 'mpv', 'mpv.exe'),
  resolve('..', 'plugins', 'bilibili-audio', 'vendor', 'yt-dlp', 'yt-dlp.exe'));
try {
  const first = join(temp, 'one.wav');
  const second = join(temp, 'two.wav');
  await Promise.all([writeFile(first, silentWav(1)), writeFile(second, silentWav(1))]);
  const candidates: Candidate[] = [first, second].map((path, index) => ({
    candidate_id: String(index + 1), bvid: `BV1vx411w7H${index + 1}`, title: `静音 ${index + 1}`,
    uploader: '测试', duration_seconds: 1, published_date: null, cover_url: null, url: pathToFileURL(path).href
  }));
  const controller = new PlaybackController({ search: async () => candidates }, player);
  const found = await controller.search('顺序切歌', 2);
  await controller.setMode('single');
  await controller.playSelection(found.search_id, '1');
  await controller.playSelection(found.search_id, '2');
  await controller.previous();
  await controller.setMode('sequential');
  const deadline = Date.now() + 4500;
  let state = await controller.status();
  while (state.history_position < 2 && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
    state = await controller.status();
  }
  console.log(JSON.stringify({ state: state.state, mode: state.mode, current: state.current?.candidate_id,
    history_position: state.history_position, history_length: state.history_length,
    position_seconds: state.position_seconds, recent_error: state.recent_error }));
  assert.equal(state.current?.candidate_id, '2', '顺序模式在第一段 EOF 后应切到第二候选');
  assert.equal(state.history_length, 2, '自动切歌应添加播放历史');
} finally {
  player.close();
  if (dirname(temp) === dist) await rm(temp, { recursive: true, force: true });
}
