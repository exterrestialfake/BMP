import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { PlaybackController } from './controller.js';
import { MpvPlayer } from './player.js';
import { BilibiliSearch } from './search.js';
import { SharedPlaybackController } from './shared.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ytDlp = resolve(root, 'vendor', 'yt-dlp', 'yt-dlp.exe');
const mpv = resolve(root, 'vendor', 'mpv', 'mpv.exe');
const controller = new SharedPlaybackController(new PlaybackController(new BilibiliSearch(ytDlp), new MpvPlayer(mpv, ytDlp)));

function result<T>(operation: () => Promise<T>) {
  return async () => {
    try {
      const data = await operation();
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
  };
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'bilibili-audio', version: '0.1.0' });
  server.server.onclose = () => controller.close();
  server.registerTool('search', {
    description: '按关键词搜索 B 站视频，返回有序候选。只展示候选，等待用户选择后再播放。',
    inputSchema: z.object({ query: z.string().min(1).max(120), limit: z.number().int().min(1).max(10).default(5) })
  }, async ({ query, limit }) => result(() => controller.search(query, limit))());
  server.registerTool('play', {
    description: '播放用户明确选择的候选，或直接播放明确提供的 BV 号/视频链接。两种输入只能选一种。',
    inputSchema: z.object({
      search_id: z.string().optional(),
      candidate_id: z.string().optional(),
      video: z.string().optional()
    }).refine((v) =>
      (Boolean(v.video?.trim()) && !v.search_id && !v.candidate_id)
      || (!v.video && Boolean(v.search_id && v.candidate_id)),
    '只能提供完整的候选标识或视频地址之一')
  }, async ({ search_id, candidate_id, video }) => result(() => video ? controller.playDirect(video) : controller.playSelection(search_id!, candidate_id!))());
  server.registerTool('next', {
    description: '播放当前所选搜索的下一候选；视频自然结束不会自动切歌。',
    inputSchema: z.object({})
  }, async () => result(() => controller.next())());
  server.registerTool('set_paused', {
    description: '明确暂停或恢复当前播放。',
    inputSchema: z.object({ paused: z.boolean() })
  }, async ({ paused }) => result(() => controller.setPaused(paused))());
  server.registerTool('set_volume', {
    description: '将当前播放器音量设为 0–100。',
    inputSchema: z.object({ volume: z.number().int().min(0).max(100) })
  }, async ({ volume }) => result(() => controller.setVolume(volume))());
  server.registerTool('stop', {
    description: '停止当前音频播放，保留本次搜索候选，之后仍可选择下一首。',
    inputSchema: z.object({})
  }, async () => result(() => controller.stop())());
  server.registerTool('status', {
    description: '查询当前视频、播放状态、进度、音量与剩余候选数。',
    inputSchema: z.object({})
  }, async () => result(() => controller.status())());
  return server;
}

if (!existsSync(ytDlp) || !existsSync(mpv)) {
  process.stderr.write(`Bilibili Audio: 请将 yt-dlp.exe 与 mpv.exe 放入插件 vendor 目录。yt-dlp=${ytDlp}; mpv=${mpv}\n`);
}
process.once('exit', () => controller.close());
process.once('SIGINT', () => { controller.close(); process.exit(0); });
process.once('SIGTERM', () => { controller.close(); process.exit(0); });
serveStdio(() => createServer());
