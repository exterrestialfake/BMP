/** 按阶段测量真实搜索，不点播，不修改安装版；毫秒不是聊天整轮时间。 */
import { resolve } from 'node:path';
import { BilibiliSearch } from '../src/search.js';
import { cacheCover } from '../src/cover.js';
import { presentSearchResults } from '../src/candidate-list.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const search = new BilibiliSearch(resolve('../plugins/bilibili-audio/vendor/yt-dlp/yt-dlp.exe'));
const directory = await mkdtemp(join(tmpdir(), 'bmp-search-perf-'));
const fetchOriginal = globalThis.fetch;
let requests: { path: string; elapsed_ms: number; http: number }[] = [];
globalThis.fetch = async (input, options) => {
  const start = performance.now();
  const response = await fetchOriginal(input, options);
  const path = new URL(String(input)).pathname;
  requests.push({ path, elapsed_ms: Math.round(performance.now() - start), http: response.status });
  return response;
};
try {
  for (let n = 0; n < 2; n++) {
    requests = [];
    const start = performance.now();
    const candidates = await search.search('琵琶曲DJ', 4);
    const searchMs = performance.now() - start;
    const coverStart = performance.now();
    const ready = await Promise.all(candidates.map(async c => ({ ...c, cover_path: await cacheCover(c.cover_url, directory) })));
    const display = presentSearchResults('benchmark', ready);
    console.log(JSON.stringify({ run: n + 1, search_ms: Math.round(searchMs), cover_ms: Math.round(performance.now() - coverStart),
      total_ms: Math.round(performance.now() - start), candidates: candidates.length, covers: ready.filter(c => c.cover_path).length,
      response_bytes: Buffer.byteLength(JSON.stringify(display)), requests }));
  }
} finally {
  globalThis.fetch = fetchOriginal;
  if (dirname(directory) !== resolve(tmpdir())) throw new Error('意外的清理目录');
  await rm(directory, { recursive: true, force: true });
}
