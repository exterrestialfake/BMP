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
    search_id: string;
    candidate_ids: string[];
    display_markdown: string;
  };
  if (!found.search_id || found.candidate_ids.length === 0) throw new Error('未获得候选，无法验证封面');
  if (new Set(found.candidate_ids).size !== found.candidate_ids.length) throw new Error('候选标识重复');
  if (!found.display_markdown.startsWith('找到这些版本，请回复编号选择：')) throw new Error('候选列表缺少用户展示内容');
  let cached = 0;
  const covers = new Map([...found.display_markdown.matchAll(/!\[第 (\d+) 项封面\]\(<([^>]+)>\)/g)]
    .map((match) => [Number(match[1]), match[2]]));
  for (const [index, candidateId] of found.candidate_ids.entries()) {
    const number = index + 1;
    if (!found.display_markdown.includes(`**${number}. `)) throw new Error(`候选 ${number} 缺少展示段落`);
    if (!found.display_markdown.includes('UP 主：') || !found.display_markdown.includes('发布日期：')) {
      throw new Error('候选列表缺少基本展示字段');
    }
    const coverPath = covers.get(number);
    const size = coverPath ? (await stat(coverPath)).size : 0;
    if (size > 0) cached++;
    process.stdout.write(`候选 ${number} (${candidateId}): ${size} bytes\n`);
  }
  if (covers.size > found.candidate_ids.length) throw new Error('候选展示包含多余封面');
  if (cached === 0) throw new Error('没有候选封面成功写入本机缓存');
  process.stdout.write(`已验证 ${found.candidate_ids.length} 条候选和 ${cached} 张本机封面。\n`);
} finally {
  await client.close();
}
