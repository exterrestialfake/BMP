import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { PlaybackController } from './controller.js';
import { MpvPlayer } from './player.js';
import { BilibiliSearch } from './search.js';
import { cacheCover } from './cover.js';
import { presentSearchResults } from './candidate-list.js';
import { PanelSupervisor, spawnPanelProcess } from './panel.js';
import { defaultControlPipe, SharedPlaybackController } from './shared.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ytDlp = resolve(root, 'vendor', 'yt-dlp', 'yt-dlp.exe');
const mpv = resolve(root, 'vendor', 'mpv', 'mpv.exe');
const controlPipe = defaultControlPipe();
const panelSupervisor = new PanelSupervisor(() => {
  const script = resolve(root, 'panel', 'panel.ps1');
  return spawnPanelProcess(script, controlPipe.slice('\\\\.\\pipe\\'.length));
}, 3000, (error) => process.stderr.write(`悬浮面板启动失败：${error.message}\n`));
function launchPanel(): void {
  if (process.platform !== 'win32' || process.env.BMP_DISABLE_PANEL === '1') return;
  const script = resolve(root, 'panel', 'panel.ps1');
  if (!existsSync(script)) return;
  panelSupervisor.start();
}
const controller = new SharedPlaybackController(new PlaybackController(new BilibiliSearch(ytDlp), new MpvPlayer(mpv, ytDlp)), controlPipe, launchPanel);

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
  const server = new McpServer({ name: 'bilibili-audio', version: '0.3.1' });
  server.server.onclose = () => { panelSupervisor.stop(); controller.close(); };
  server.registerTool('search', {
    description: '按关键词搜索 B 站视频并替换旧候选。直接向用户展示 display_markdown；用户选择展示编号后，用 candidate_ids 中相同位置的标识和 search_id 调用 play。',
    inputSchema: z.object({ query: z.string().min(1).max(120), limit: z.number().int().min(1).max(10).default(5) })
  }, async ({ query, limit }) => result(async () => {
    const found = await controller.search(query, limit);
    const candidates = await Promise.all(found.candidates.map(async (candidate) => ({
      ...candidate, cover_path: await cacheCover(candidate.cover_url)
    })));
    return presentSearchResults(found.search_id, candidates);
  })());
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
    description: '沿播放历史前进一首；已到历史末尾时不可用。',
    inputSchema: z.object({})
  }, async () => result(() => controller.next())());
  server.registerTool('previous', {
    description: '沿播放历史回退一首；已到历史开头时不可用。',
    inputSchema: z.object({})
  }, async () => result(() => controller.previous())());
  server.registerTool('set_mode', {
    description: '设置播放模式：off 自然结束即停、single 单曲循环、sequential 沿播放历史顺序前进，末尾停播。',
    inputSchema: z.object({ mode: z.enum(['off', 'single', 'sequential']) })
  }, async ({ mode }) => result(() => controller.setMode(mode))());
  server.registerTool('set_paused', {
    description: '明确暂停或恢复当前播放；停止播放也使用 paused=true，保留进度。空闲或已结束时暂停不报错。',
    inputSchema: z.object({ paused: z.boolean() })
  }, async ({ paused }) => result(() => controller.setPaused(paused))());
  server.registerTool('set_volume', {
    description: '将当前播放器音量设为 0–100。',
    inputSchema: z.object({ volume: z.number().int().min(0).max(100) })
  }, async ({ volume }) => result(() => controller.setVolume(volume))());
  server.registerTool('status', {
    description: '查询完整当前视频信息、播放状态、进度、音量、播放模式、历史位置与长度；不返回完整历史或搜索候选。',
    inputSchema: z.object({})
  }, async () => result(() => controller.status())());
  return server;
}

if (!existsSync(ytDlp) || !existsSync(mpv)) {
  process.stderr.write(`Bilibili Audio: 请将 yt-dlp.exe 与 mpv.exe 放入插件 vendor 目录。yt-dlp=${ytDlp}; mpv=${mpv}\n`);
}
process.once('exit', () => { panelSupervisor.stop(); controller.close(); });
process.once('SIGINT', () => { panelSupervisor.stop(); controller.close(); process.exit(0); });
process.once('SIGTERM', () => { panelSupervisor.stop(); controller.close(); process.exit(0); });
serveStdio(() => createServer());
void controller.status().catch((error) => process.stderr.write(`本地控制启动失败：${String(error)}\n`));
