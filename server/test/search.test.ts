import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { BilibiliSearch } from '../src/search.js';

test('yt-dlp 返回 412 后，同一进程后续搜索复用已经成功的访客路径', async t => {
  let spawns = 0;
  t.mock.method(childProcess, 'spawn', () => {
    spawns++;
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill(): void };
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    process.nextTick(() => { child.stderr.write('ERROR: HTTP Error 412'); child.emit('close', 1); });
    return child;
  });
  syncBuiltinESMExports();
  let visitorRequests = 0;
  let rejectVisitor = false;
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    if (rejectVisitor) { rejectVisitor = false; throw new TypeError('临时网络错误'); }
    if (new URL(input).pathname.endsWith('/spi')) return Response.json({ code: 0, data: { b_3: 'test-visitor-3', b_4: 'test-visitor-4' } });
    visitorRequests++;
    return Response.json({ code: 0, data: { result: [{ bvid: 'BV1vx411w7Hc', title: '搜索结果', author: '作者', duration: '1:20' }] } });
  });
  try {
    const search = new BilibiliSearch('unused.exe');
    assert.equal((await search.search('第一次', 4)).length, 1);
    assert.equal((await search.search('第二次', 4)).length, 1);
    assert.equal(visitorRequests, 2);
    assert.equal(spawns, 1, '不应每次重新尝试已经被 412 拒绝的路径');
    rejectVisitor = true;
    assert.equal((await search.search('备用路径临时失败', 4)).length, 1);
    assert.equal(spawns, 2, '访客路径失败时应允许重新尝试原路径');
    assert.equal(visitorRequests, 3);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
