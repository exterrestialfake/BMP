/** 在独立冷缓存中探测单张封面的 HTTP 与超时，不依赖旧验收文件。 */
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { cacheCover } from '../src/cover.js';
const url = process.argv[2] ?? 'https://i1.hdslb.com/bfs/archive/c7ab4860c7c4c76d11e1ac14fd1545a124c32e4e.jpg';
const count = Number(process.argv[3] ?? 3);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 30);
const attempts: Record<string, unknown>[] = [];
function describe(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message, cause: String(error.cause ?? '') } : String(error);
}
for (let i = 0; i < count; i++) {
  const temporary = await mkdtemp(join(tmpdir(), 'bmp-cover-probe-'));
  assert.equal(dirname(temporary), resolve(tmpdir()));
  const start = performance.now();
  const attempt: Record<string, unknown> = { attempt: i + 1 };
  try {
    const path = await cacheCover(url, temporary, async (requested, options) => {
      try {
        const response = await fetch(requested, options);
        attempt.http_status = response.status;
        attempt.content_type = response.headers.get('content-type');
        attempt.headers_elapsed_ms = Math.round(performance.now() - start);
        if (!response.body) return response;
        const reader = response.body.getReader();
        let received = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const result = await reader.read();
              if (result.done) controller.close();
              else { received += result.value.length; attempt.received_bytes = received; controller.enqueue(result.value); }
            } catch (error) { attempt.body_error = describe(error); controller.error(error); }
          },
          async cancel() { await reader.cancel().catch(() => undefined); }
        });
        return new Response(body, { status: response.status, headers: response.headers });
      } catch (error) { attempt.fetch_error = describe(error); throw error; }
    });
    attempt.cached = Boolean(path);
    attempt.elapsed_ms = Math.round(performance.now() - start);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  attempts.push(attempt);
  console.log(JSON.stringify(attempt));
}
console.log(JSON.stringify({ url, attempts, successful: attempts.filter(a => a.cached).length,
  limitation: '当前探测不能倒推未采集异常的旧失败原因' }));
