import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const plugin = process.env.BMP_PLUGIN_ROOT ?? resolve('..', 'plugins', 'bilibili-audio');
const video = process.argv[2] ?? 'BV1vx411w7Hc';
const client = new Client({ name: 'bmp-smoke', version: '0.1.0' });

try {
  await client.connect(new StdioClientTransport({
    command: resolve(plugin, 'runtime', 'node.exe'),
    args: [resolve(plugin, 'server', 'index.mjs')]
  }));
  for (const [name, args] of [
    ['play', { video }],
    ['set_paused', { paused: true }],
    ['set_volume', { volume: 40 }],
    ['status', {}]
  ] as const) {
    const output = await client.callTool({ name, arguments: args });
    if (output.isError) throw new Error(`${name}: ${JSON.stringify(output.content)}`);
    process.stdout.write(`${name}: ${JSON.stringify(output.content)}\n`);
  }
} finally {
  await client.close();
}
