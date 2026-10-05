/** 隔离退出验收：真实控制器、播放器和面板，不连接用户的控制管道。 */
import { resolve } from 'node:path';
import { PlaybackController } from '../../src/controller.js';
import { SharedPlaybackController } from '../../src/shared.js';
import { MpvPlayer } from '../../src/player.js';
import { PanelSupervisor, spawnPanelProcess } from '../../src/panel.js';

const [pipeName, hostPid, audio] = process.argv.slice(2);
const plugin = resolve('..', 'plugins', 'bilibili-audio');
const player = new MpvPlayer(resolve(plugin, 'vendor/mpv/mpv.exe'), resolve(plugin, 'vendor/yt-dlp/yt-dlp.exe'));
let panelPid: number | undefined;
const panel = new PanelSupervisor(() => {
  const child = spawnPanelProcess(resolve(plugin, 'panel/panel.ps1'), pipeName, Number(hostPid));
  panelPid = child.pid;
  return child;
});
const control = new SharedPlaybackController(new PlaybackController({ search: async () => [] }, player), `\\\\.\\pipe\\${pipeName}`, () => panel.start());
const internal = player as unknown as { process?: { pid?: number }; command(parts: unknown[]): Promise<unknown> };
process.on('message', async (message) => {
  if (message === 'close') { panel.stop(); control.close(); process.exit(0); }
});
process.on('exit', () => { panel.stop(); control.close(); });
await control.status();
await player.setLoop(true);
await player.setVolume(0);
await player.load(audio);
process.send?.({ mpv: internal.process?.pid, panel: panelPid, owner: process.pid });
