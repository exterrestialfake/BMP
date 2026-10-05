import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, realpath, rm, writeFile, utimes, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { cacheCover } from '../src/cover.js';
import { presentSearchResults } from '../src/candidate-list.js';
import { createServer } from 'node:http';

test('失败原因写入 stderr，候选返回仍只有文字回退', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bmp-cover-diagnostic-'));
  const saved = process.stderr.write;
  let output = '';
  process.stderr.write = ((chunk: string | Uint8Array) => { output += String(chunk); return true; }) as typeof saved;
  try {
    assert.equal(await cacheCover('https://i0.hdslb.com/bfs/archive/denied.jpg', directory,
      async () => new Response('Forbidden', { status: 403 })), null);
    assert.match(output, /封面缓存失败.*HTTP 403/);
    output = '';
    assert.equal(await cacheCover('https://i0.hdslb.com/bfs/archive/offline.jpg', directory,
      async () => { throw new TypeError('fetch failed'); }), null);
    assert.match(output, /TypeError: fetch failed/);
  } finally {
    process.stderr.write = saved;
    assert.equal(dirname(directory), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('收到 HTTP 200 后图片流卡住也在总计 5 秒内中止且不残留临时文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bmp-cover-body-timeout-'));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/jpeg' });
    response.write(Buffer.from([0xff, 0xd8, 0xff]));
    // 不结束响应，验证真正的 fetch 响应流中止。
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const start = performance.now();
  try {
    const path = await cacheCover('https://i0.hdslb.com/bfs/archive/stalled.jpg', directory,
      async (_url, options) => fetch(`http://127.0.0.1:${address.port}/cover`, options));
    assert.equal(path, null);
    assert.ok(performance.now() - start >= 3000 && performance.now() - start < 7000);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(accept => server.close(() => accept()));
    assert.equal(dirname(directory), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('首次图片响应流超时、第二次正常时仍展示封面', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bmp-cover-retry-'));
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'Content-Type': 'image/jpeg' });
    if (requests === 1) response.write(bytes.subarray(0, 3));
    else response.end(bytes);
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const path = await cacheCover('https://i0.hdslb.com/bfs/archive/retry.jpg', directory,
      async (_url, options) => fetch(`http://127.0.0.1:${address.port}/cover`, options));
    assert.ok(path, '短暂超时后应恢复封面');
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(requests, 2);
    assert.equal((await readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(accept => server.close(() => accept()));
    assert.equal(dirname(directory), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('断网和真实超时保留完整文字候选，不留下临时图片', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bmp-cover-failure-'));
  try {
    const url = 'https://i0.hdslb.com/bfs/archive/timeout.jpg';
    assert.equal(await cacheCover(url, directory, async () => { throw new TypeError('network unavailable'); }), null);
    const start = performance.now();
    const keepAlive = setInterval(() => {}, 1000);
    let cover: string | null;
    try {
      cover = await cacheCover(url, directory, async (_, options) => {
        await delay(60_000, undefined, { signal: options.signal! });
        throw new Error('超时请求不应完成');
      });
    } finally { clearInterval(keepAlive); }
    const elapsed = performance.now() - start;
    assert.equal(cover, null);
    assert.ok(elapsed >= 3000 && elapsed < 7000, `超时耗时 ${elapsed} ms`);
    const display = presentSearchResults('test-search', [{
      candidate_id: '1', bvid: 'BV1vx411w7Hc', title: '断网仍可选', uploader: '测试作者',
      duration_seconds: 65, published_date: '2026-10-04', cover_url: url,
      cover_path: cover, url: 'https://www.bilibili.com/video/BV1vx411w7Hc'
    }]);
    assert.deepEqual(display.candidate_ids, ['1']);
    for (const field of ['断网仍可选', '测试作者', '1分05秒', '2026-10-04', 'BV1vx411w7Hc', '封面暂不可用。']) {
      assert.ok(display.display_markdown.includes(field), field);
    }
    assert.deepEqual(await readdir(directory), []);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('30 天过期图片被清理，未过期缓存断网仍可用，无关文件不删除', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bmp-cover-expiry-'));
  try {
    const expiredUrl = 'https://i0.hdslb.com/bfs/archive/expired.jpg';
    const freshUrl = 'https://i0.hdslb.com/bfs/archive/fresh.jpg';
    const name = (url: string) => `${createHash('sha256').update(url).digest('hex')}.jpg`;
    const expired = join(directory, name(expiredUrl));
    const fresh = join(directory, name(freshUrl));
    const unrelated = join(directory, '用户文件.jpg');
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    await Promise.all([expired, fresh, unrelated].map(path => writeFile(path, bytes)));
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await Promise.all([expired, unrelated].map(path => utimes(path, old, old)));
    let fetched = 0;
    const cached = await cacheCover(freshUrl, directory, async () => { fetched++; throw new Error('离线'); });
    assert.equal(cached, (await realpath(fresh)).replaceAll('\\', '/'));
    assert.equal(fetched, 0);
    assert.deepEqual((await readdir(directory)).sort(), [name(freshUrl), '用户文件.jpg'].sort());
    assert.equal(await cacheCover(expiredUrl, directory, async () => { fetched++; throw new Error('离线'); }), null);
    assert.equal(fetched, 1);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('封面由 B 站图片域名获取并缓存为本机图片，重复搜索复用缓存', async () => {
  const parent = join(process.env.LOCALAPPDATA ?? tmpdir(), 'bilibili-audio');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'bmp-cover-test-'));
  try {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    let requests = 0;
    const url = 'https://i2.hdslb.com/bfs/archive/cover-test.jpg';
    const fetchImage = async (requested: string, options: RequestInit) => {
      requests++;
      assert.equal(requested, url);
      assert.equal(options.redirect, 'manual');
      assert.equal((options.headers as Record<string, string>).Referer, 'https://www.bilibili.com/');
      return new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    };
    const path = await cacheCover(url, directory, fetchImage);
    assert.ok(path);
    assert.ok(path.startsWith((await realpath(directory)).replaceAll('\\', '/')));
    assert.ok(path.endsWith('.jpg'));
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(await cacheCover(url, directory, fetchImage), path);
    assert.equal(requests, 1);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(parent));
    await rm(directory, { recursive: true, force: true });
  }
});

test('非法域名、拒绝请求、伪装图片和过大响应仅退化为文字候选', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bmp-cover-test-'));
  try {
    let requests = 0;
    const forbidden = await cacheCover('https://example.com/cover.jpg', directory, async () => {
      requests++;
      throw new Error('不应发起请求');
    });
    assert.equal(forbidden, null);
    assert.equal(requests, 0);
    const denied = await cacheCover('https://i0.hdslb.com/bfs/archive/denied.jpg', directory,
      async () => new Response('Forbidden', { status: 403 }));
    assert.equal(denied, null);
    const html = await cacheCover('https://i0.hdslb.com/bfs/archive/html.jpg', directory,
      async () => new Response('<html>error</html>', { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    assert.equal(html, null);
    const oversized = await cacheCover('https://i0.hdslb.com/bfs/archive/oversized.jpg', directory,
      async () => new Response(Buffer.alloc(1_500_001, 0xff), { status: 200 }));
    assert.equal(oversized, null);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
