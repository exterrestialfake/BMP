import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('发布文件能经 Windows stdio 握手并列出八个工具', async () => {
  const plugin = process.env.BMP_PLUGIN_ROOT ?? resolve('..', 'plugins', 'bilibili-audio');
  const client = new Client({ name: 'bmp-test', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: resolve(plugin, 'runtime', 'node.exe'),
    args: [resolve(plugin, 'server', 'index.mjs')],
    env: { ...process.env, BMP_DISABLE_PANEL: '1' }
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['next', 'play', 'previous', 'search', 'set_mode', 'set_paused', 'set_volume', 'status']);
    const status = await client.callTool({ name: 'status', arguments: {} });
    assert.equal(status.isError, undefined);
    assert.equal(status.content[0]?.type, 'text');
    if (status.content[0]?.type === 'text') {
      assert.match(JSON.parse(status.content[0].text).state, /^(idle|playing|paused|ended|error)$/);
    }
    const invalid = await client.callTool({ name: 'play', arguments: { video: 'https://example.com/video/BV1vx411w7Hc' } });
    assert.equal(invalid.isError, true);
    const ambiguous = await client.callTool({ name: 'play', arguments: { video: 'BV1vx411w7Hc', search_id: 'other' } });
    assert.equal(ambiguous.isError, true);
  } finally {
    await client.close();
  }
});
