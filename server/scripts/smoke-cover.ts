import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const plugin = process.env.BMP_PLUGIN_ROOT ?? resolve('..', 'plugins', 'bilibili-audio');
const query = process.argv[2] ?? '琵琶曲DJ';
const client = new Client({ name: 'bmp-cover-smoke', version: '0.3.1' });

try {
  await client.connect(new StdioClientTransport({
    command: resolve(plugin, 'runtime', 'node.exe'),
    args: [resolve(plugin, 'server', 'index.mjs')],
    env: { ...process.env, BMP_DISABLE_PANEL: '1' }
  }));
  const output = await client.callTool({ name: 'search', arguments: { query, limit: 4 } });
  if (output.isError || output.content[0]?.type !== 'text') throw new Error(JSON.stringify(output.content));
  const found = JSON.parse(output.content[0].text) as {
    candidates: Array<{ bvid: string; title: string; uploader: string; duration_seconds: number | null;
      published_date: string | null; cover_url: string | null; cover_path: string | null }>;
    display_markdown: string;
  };
  if (found.candidates.length === 0) throw new Error('未获得候选，无法验证封面');
  if (!found.display_markdown.startsWith('找到这些版本，请回复编号选择：')) throw new Error('候选列表缺少用户展示内容');
  let cached = 0;
  for (const candidate of found.candidates) {
    if (!candidate.title || !candidate.uploader || !candidate.bvid) throw new Error('候选基本信息缺失');
    if (!found.display_markdown.includes(candidate.bvid)) throw new Error(`候选列表缺少 ${candidate.bvid}`);
    if (!found.display_markdown.includes(candidate.uploader)) throw new Error(`候选列表缺少 ${candidate.bvid} 的 UP 主`);
    if (!found.display_markdown.includes(candidate.published_date ?? '日期未知')) throw new Error(`候选列表缺少 ${candidate.bvid} 的日期`);
    if (candidate.cover_path && !found.display_markdown.includes(`(<${candidate.cover_path}>)`)) {
      throw new Error(`候选列表没有引用 ${candidate.bvid} 的本机封面`);
    }
    const size = candidate.cover_path ? (await stat(candidate.cover_path)).size : 0;
    if (size > 0) cached++;
    process.stdout.write(`${candidate.bvid}: ${candidate.title} | ${candidate.uploader} | ${candidate.duration_seconds ?? '未知'} 秒 | ${candidate.published_date ?? '日期未知'} | ${size} bytes\n`);
  }
  if (cached === 0) throw new Error('没有候选封面成功写入本机缓存');
  process.stdout.write(`已验证 ${found.candidates.length} 条候选和 ${cached} 张本机封面。\n`);
} finally {
  await client.close();
}
