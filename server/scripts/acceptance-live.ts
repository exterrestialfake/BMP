/** 验收现有源码，独立管道与播放器，不修改已安装插件或当前播放历史。 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { BilibiliSearch } from '../src/search.js';
import { PlaybackController } from '../src/controller.js';
import { SharedPlaybackController } from '../src/shared.js';
import { MpvPlayer } from '../src/player.js';
import { cacheCover } from '../src/cover.js';
import { presentSearchResults } from '../src/candidate-list.js';

const plugin = resolve('..', 'plugins', 'bilibili-audio');
const output = process.argv[2] ? resolve(process.argv[2]) : null;
const temporaryRoot = resolve(tmpdir());
const temporary = await mkdtemp(join(temporaryRoot, 'bmp-live-'));
assert.equal(dirname(temporary), temporaryRoot);
const ytDlp = join(plugin, 'vendor', 'yt-dlp', 'yt-dlp.exe');
const mpv = join(plugin, 'vendor', 'mpv', 'mpv.exe');
const player = new MpvPlayer(mpv, ytDlp);
const pipe = `\\\\.\\pipe\\bmp-acceptance-${randomUUID()}`;
const owner = new SharedPlaybackController(new PlaybackController(new BilibiliSearch(ytDlp), player), pipe);
const clientPlayer = new MpvPlayer(mpv, ytDlp);
const other = new SharedPlaybackController(new PlaybackController({ search: async () => [] }, clientPlayer), pipe);
const report: Record<string, unknown> = { tested_at: new Date().toISOString(), target: '工作区源码，独立共享管道，真实 B 站与 mpv' };
let mpvPid: number | undefined;
// 仅测试夹具使用 IPC seek，保留最后两秒让真实音频产生 EOF；没有增加产品接口。
const internal = player as unknown as { command: (parts: unknown[]) => Promise<unknown>; process?: { pid?: number } };
async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const result = await action();
    report[name] = { passed: true, elapsed_ms: Math.round(performance.now() - start), result };
    console.log(`PASS ${name}: ${Math.round(performance.now() - start)} ms`);
    return result;
  } catch (error) {
    report[name] = { passed: false, elapsed_ms: Math.round(performance.now() - start), error: String(error) };
    throw error;
  }
}
async function waitFor(test: (state: Awaited<ReturnType<typeof owner.status>>) => boolean, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let state = await owner.status();
  while (!test(state) && Date.now() < deadline) { await delay(100); state = await owner.status(); }
  assert.ok(test(state), JSON.stringify(state));
  return state;
}
try {
  report.source_hashes = Object.fromEntries(await Promise.all(['controller', 'player', 'shared', 'search', 'cover'].map(async name =>
    [name, createHash('sha256').update(await readFile(`src/${name}.ts`)).digest('hex')])));
  await owner.status();
  const found = await step('真实搜索', () => owner.search('琵琶曲DJ', 4));
  assert.equal(found.candidates.length, 4);
  try { await step('候选字段及本地封面', async () => {
    const candidates = await Promise.all(found.candidates.map(async candidate => ({
      ...candidate, cover_path: await cacheCover(candidate.cover_url, temporary)
    })));
    report.cover_attempts = candidates.map(c => ({ bvid: c.bvid, url: c.cover_url, cached: Boolean(c.cover_path) }));
    for (const c of candidates) {
      assert.ok(c.title && c.uploader && c.duration_seconds && c.published_date && c.cover_url);
      assert.ok(c.cover_path, `封面不可获取：${c.bvid}`);
      assert.ok((await stat(c.cover_path)).size > 0);
    }
    const compact = presentSearchResults(found.search_id, candidates);
    assert.deepEqual(Object.keys(compact).sort(), ['candidate_ids', 'display_markdown', 'search_id']);
    assert.equal([...compact.display_markdown.matchAll(/!\[/g)].length, 4);
    const compactBytes = Buffer.byteLength(JSON.stringify(compact));
    const duplicatedBytes = Buffer.byteLength(JSON.stringify({ ...compact, candidates }));
    return { count: candidates.length, covers: candidates.length, compact_bytes: compactBytes,
      with_duplicate_candidates_bytes: duplicatedBytes, saved_bytes: duplicatedBytes - compactBytes,
      note: '字节数比较不是 token 测量，也不是历史版本完整响应比较' };
  }); } catch { process.exitCode = 1; }
  await owner.setMode('single');
  await owner.setVolume(0);
  await step('真实点播及跨实例暂停恢复', async () => {
    const selected = found.candidates[0];
    await other.playSelection(found.search_id, selected.candidate_id);
    mpvPid = internal.process?.pid;
    assert.ok(mpvPid);
    assert.equal((await other.setPaused(true)).state, 'paused');
    assert.equal((await owner.status()).state, 'paused');
    assert.equal((await other.setPaused(false)).state, 'playing');
    await other.setVolume(37);
    assert.equal((await owner.status()).volume, 37);
    await other.setVolume(0);
    return { bvid: selected.bvid, mpv_pid: mpvPid, state_shared: true, volume_shared: true };
  });
  await step('历史去重及前后导航', async () => {
    await other.playSelection(found.search_id, found.candidates[1].candidate_id);
    assert.equal((await other.previous()).current?.bvid, found.candidates[0].bvid);
    assert.equal((await other.next()).current?.bvid, found.candidates[1].bvid);
    await owner.playSelection(found.search_id, found.candidates[0].candidate_id);
    assert.equal((await owner.status()).history_length, 2);
    assert.equal((await other.previous()).current?.bvid, found.candidates[1].bvid);
    await assert.rejects(other.previous(), /开头/);
    return { length: 2, order: [found.candidates[1].bvid, found.candidates[0].bvid] };
  });
  await step('真实视频 EOF 顺序前进及历史末尾停播', async () => {
    let eofCount = 0;
    player.onEnded(() => eofCount++);
    await other.setMode('sequential');
    assert.equal((await owner.status()).mode, 'sequential');
    const first = await owner.status();
    assert.ok(first.duration_seconds && first.duration_seconds > 3);
    await internal.command(['seek', first.duration_seconds - 2, 'absolute+exact']);
    const next = await waitFor(state => state.history_position === 2 && state.state === 'playing');
    assert.equal(next.current?.bvid, found.candidates[0].bvid);
    assert.equal(next.history_length, 2);
    assert.ok(next.duration_seconds && next.duration_seconds > 3);
    await internal.command(['seek', next.duration_seconds - 2, 'absolute+exact']);
    await waitFor(state => state.state === 'ended');
    await delay(1500);
    const ended = await owner.status();
    assert.equal(ended.state, 'ended');
    assert.equal(ended.history_position, 2);
    assert.equal(ended.history_length, 2);
    assert.equal(eofCount, 2);
    await assert.rejects(other.next(), /末尾/);
    assert.equal((await other.setPaused(true)).state, 'ended');
    return { eof_count: eofCount, tail: ended.state, note: 'seek 到最后两秒后自然 EOF，未等待视频全长' };
  });
  await step('关闭从实例不关闭主播放器', async () => {
    other.close();
    await owner.playSelection(found.search_id, found.candidates[0].candidate_id);
    assert.equal((await owner.status()).state, 'playing');
    return { mpv_pid_unchanged: internal.process?.pid === mpvPid };
  });
} catch (error) {
  report.failure = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  mpvPid ??= internal.process?.pid;
  other.close();
  owner.close();
  await delay(500);
  if (mpvPid) {
    let alive = true;
    try { process.kill(mpvPid, 0); } catch { alive = false; }
    report.player_cleanup = { passed: !alive, mpv_pid: mpvPid };
    if (alive) process.exitCode = 1;
  }
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2), 'utf8');
  }
  await rm(temporary, { recursive: true, force: true });
  console.log(output ? `验收记录：${output}` : JSON.stringify(report, null, 2));
}
