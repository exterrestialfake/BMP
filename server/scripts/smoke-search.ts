import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const plugin = process.env.BMP_PLUGIN_ROOT ?? resolve('..', 'plugins', 'bilibili-audio');
const query = process.argv[2] ?? '十面埋伏 琵琶';
const client = new Client({ name: 'bmp-search-smoke', version: '0.1.0' });

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const output = await client.callTool({ name, arguments: args });
  if (output.isError || output.content[0]?.type !== 'text') throw new Error(`${name}: ${JSON.stringify(output.content)}`);
  return JSON.parse(output.content[0].text);
}

try {
  await client.connect(new StdioClientTransport({
    command: resolve(plugin, 'runtime', 'node.exe'),
    args: [resolve(plugin, 'server', 'index.mjs')]
  }));
  const found = await call('search', { query, limit: 2 });
  process.stdout.write(`search: ${found.candidates.map((x: any) => `${x.candidate_id}. ${x.title} (${x.bvid})`).join(' | ')}\n`);
  if (found.candidates.length < 2) throw new Error('候选不足两条，无法验证播放历史');
  const first = await call('play', { search_id: found.search_id, candidate_id: found.candidates[0].candidate_id });
  process.stdout.write(`play: ${first.state} ${first.current.bvid}\n`);
  const second = await call('play', { search_id: found.search_id, candidate_id: found.candidates[1].candidate_id });
  process.stdout.write(`play: ${second.state} ${second.current.bvid}\n`);
  const previous = await call('previous', {});
  process.stdout.write(`previous: ${previous.state} ${previous.current.bvid}\n`);
  const next = await call('next', {});
  process.stdout.write(`next: ${next.state} ${next.current.bvid}\n`);
  await call('set_paused', { paused: true });
} finally {
  await client.close();
}
