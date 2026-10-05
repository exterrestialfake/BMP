/** 两个独立 stdio MCP 进程接入已安装主实例；最终暂停，不更新插件。 */
import assert from 'node:assert/strict';
import { writeFile, stat, mkdir, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
const plugin = resolve(process.env.USERPROFILE!, '.codex/plugins/cache/personal/bilibili-audio/0.3.4');
const output = process.argv[2] ? resolve(process.argv[2]) : null;
const a = new Client({ name: 'bmp-acceptance-a', version: '1.0.0' });
const b = new Client({ name: 'bmp-acceptance-b', version: '1.0.0' });
const transport = () => new StdioClientTransport({ command: resolve(plugin, 'runtime/node.exe'),
  args: [resolve(plugin, 'server/index.mjs')], env: { ...process.env, BMP_DISABLE_PANEL: '1' } });
const report: Record<string, unknown> = { tested_at: new Date().toISOString(), target: '已安装 0.3.4，两个真实独立 stdio MCP 进程，不等同于桌面聊天切换' };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const start = performance.now();
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, `${name}: ${JSON.stringify(response.content)}`);
  assert.equal(response.content[0]?.type, 'text');
  const result = JSON.parse((response.content[0] as { text: string }).text);
  report[`${Object.keys(report).length}-${name}`] = { elapsed_ms: Math.round(performance.now() - start), result };
  return result;
}
let original: any;
let changedPlayback = false;
try {
  await a.connect(transport());
  await b.connect(transport());
  const names = (await a.listTools()).tools.map(t => t.name);
  assert.equal(names.length, 9, '安装版尚有 stop，与工作区八工具版区分记录');
  report.tools = names;
  original = await call(a, 'status');
  assert.equal(original.state, 'idle', '只允许在原播放空闲时运行这组测试');
  const found = await call(a, 'search', { query: '琵琶曲DJ', limit: 4 });
  const covers = [...found.display_markdown.matchAll(/!\[第 \d+ 项封面\]\(<([^>]+)>\)/g)];
  assert.equal(covers.length, found.candidate_ids.length);
  for (const [, path] of covers) {
    assert.equal(path, (await realpath(path)).replaceAll('\\', '/'));
    assert.ok((await stat(path)).size > 0);
  }
  report.installed_covers = { passed: true, count: covers.length, note: '实际文件可读，本脚本不验证聊天像素渲染' };
  changedPlayback = true;
  await call(a, 'set_mode', { mode: 'single' });
  await call(a, 'set_volume', { volume: 0 });
  await call(a, 'play', { search_id: found.search_id, candidate_id: found.candidate_ids[0] });
  assert.equal((await call(b, 'set_paused', { paused: true })).state, 'paused');
  assert.equal((await call(a, 'status')).state, 'paused');
  assert.equal((await call(b, 'set_paused', { paused: false })).state, 'playing');
  await call(b, 'set_volume', { volume: 29 });
  assert.equal((await call(a, 'status')).volume, 29);
  await call(a, 'set_volume', { volume: 0 });
  await call(b, 'play', { search_id: found.search_id, candidate_id: found.candidate_ids[1] });
  assert.equal((await call(a, 'previous')).history_position, 1);
  assert.equal((await call(b, 'next')).history_position, 2);
  await b.close();
  assert.equal((await call(a, 'status')).state, 'playing', '关闭从 MCP 进程不应停止主播放器');
  report.passed = true;
} catch (error) { report.failure = String(error); process.exitCode = 1; console.error(error); }
finally {
  if (original && changedPlayback) {
    try {
      await call(a, 'set_paused', { paused: true });
      await call(a, 'set_mode', { mode: original.mode });
      await call(a, 'set_volume', { volume: original.volume ?? 100 });
    } catch (error) { report.cleanup_error = String(error); process.exitCode = 1; }
  }
  await b.close(); await a.close();
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2), 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
}
