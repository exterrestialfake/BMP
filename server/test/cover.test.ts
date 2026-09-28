import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { cacheCover } from '../src/cover.js';

test('封面由 B 站图片域名获取并缓存为本机图片，重复搜索复用缓存', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bmp-cover-test-'));
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
    assert.ok(path.startsWith(directory.replaceAll('\\', '/')));
    assert.ok(path.endsWith('.jpg'));
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(await cacheCover(url, directory, fetchImage), path);
    assert.equal(requests, 1);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
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
