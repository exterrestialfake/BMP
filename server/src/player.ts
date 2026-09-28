import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';

type MpvEvent = { event: string; reason?: string; error?: string; [key: string]: unknown };
type MpvReply = { request_id: number; error: string; data?: unknown };

export interface PlaybackSnapshot {
  state: 'idle' | 'playing' | 'paused' | 'ended' | 'error';
  position_seconds: number | null;
  duration_seconds: number | null;
  volume: number | null;
  recent_error: string | null;
}

export interface PlayerPort {
  load(url: string): Promise<PlaybackSnapshot>;
  setPaused(paused: boolean): Promise<PlaybackSnapshot>;
  setVolume(volume: number): Promise<PlaybackSnapshot>;
  setLoop?(enabled: boolean): Promise<void>;
  stop(): Promise<PlaybackSnapshot>;
  status(): Promise<PlaybackSnapshot>;
  onEnded?(listener: () => void): void;
  close(): void;
}

export class MpvPlayer implements PlayerPort {
  private process?: ChildProcess;
  private socket?: Socket;
  private lineBuffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly events = new Set<(event: MpvEvent) => void>();
  private readonly endedListeners = new Set<() => void>();
  private state: PlaybackSnapshot['state'] = 'idle';
  private recentError: string | null = null;
  private starting?: Promise<void>;
  private readonly pipe = `\\\\.\\pipe\\bilibili-audio-${process.pid}-${randomUUID()}`;

  constructor(private readonly mpvExe: string, private readonly ytDlpExe: string) {}

  private async start(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.starting) return this.starting;
    this.starting = this.startProcess();
    try { await this.starting; } finally { this.starting = undefined; }
  }

  private async startProcess(): Promise<void> {
    const args = [
      '--idle=yes', '--no-video', '--force-window=no', '--no-terminal', '--ytdl=yes',
      `--input-ipc-server=${this.pipe}`,
      `--script-opts=ytdl_hook-ytdl_path=${this.ytDlpExe}`
    ];
    const child = spawn(this.mpvExe, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    this.process = child;
    let stderr = '';
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
    child.on('error', (error) => {
      this.state = 'error';
      this.recentError = `无法启动 mpv：${error.message}`;
    });
    child.on('close', (code) => {
      this.socket?.destroy();
      this.socket = undefined;
      this.process = undefined;
      if (this.state !== 'idle') {
        this.state = 'error';
        this.recentError = `mpv 已退出（${code ?? '未知'}）：${stderr.trim()}`;
      }
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error(this.recentError ?? 'mpv 已退出'));
      }
      this.pending.clear();
    });

    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || this.recentError?.startsWith('无法启动')) throw new Error(this.recentError ?? `mpv 启动失败：${stderr}`);
      try {
        const socket = await new Promise<Socket>((resolve, reject) => {
          const candidate = connect(this.pipe);
          candidate.once('connect', () => resolve(candidate));
          candidate.once('error', reject);
        });
        this.socket = socket;
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => this.onData(chunk));
        socket.on('error', (error) => { this.recentError = `mpv IPC 错误：${error.message}`; });
        socket.on('close', () => { this.socket = undefined; });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    child.kill();
    throw new Error(`mpv IPC 连接超时：${stderr.trim()}`);
  }

  private onData(chunk: string): void {
    this.lineBuffer += chunk;
    while (true) {
      const end = this.lineBuffer.indexOf('\n');
      if (end < 0) break;
      const line = this.lineBuffer.slice(0, end);
      this.lineBuffer = this.lineBuffer.slice(end + 1);
      let message: Record<string, unknown>;
      try { message = JSON.parse(line); } catch { continue; }
      if (typeof message.request_id === 'number') {
        const reply = message as MpvReply;
        const item = this.pending.get(reply.request_id);
        if (!item) continue;
        this.pending.delete(reply.request_id);
        clearTimeout(item.timer);
        if (reply.error === 'success') item.resolve(reply.data);
        else item.reject(new Error(`mpv 命令失败：${reply.error}`));
      } else if (typeof message.event === 'string') {
        const event = message as MpvEvent;
        if (event.event === 'playback-restart') this.state = 'playing';
        if (event.event === 'end-file') {
          this.state = event.reason === 'error' ? 'error' : 'ended';
          if (event.reason === 'error') this.recentError = `播放失败：${event.error ?? '未知错误'}`;
        }
        for (const listener of this.events) listener(event);
        if (event.event === 'end-file' && event.reason === 'eof') {
          for (const listener of this.endedListeners) listener();
        }
      }
    }
  }

  private async command(parts: unknown[], timeoutMs = 5000): Promise<unknown> {
    await this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('mpv 命令超时'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket!.write(JSON.stringify({ command: parts, request_id: id }) + '\n', (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async load(url: string): Promise<PlaybackSnapshot> {
    await this.start();
    this.recentError = null;
    this.state = 'idle';
    let cancelWait = () => {};
    const eventResult = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.events.delete(listener);
        reject(new Error('等待音频开始播放超时'));
      }, 30000);
      const listener = (event: MpvEvent) => {
        if (event.event === 'playback-restart') {
          clearTimeout(timer);
          this.events.delete(listener);
          resolve();
        } else if (event.event === 'end-file' && event.reason === 'error') {
          clearTimeout(timer);
          this.events.delete(listener);
          reject(new Error(this.recentError ?? '视频无法播放'));
        }
      };
      this.events.add(listener);
      cancelWait = () => { clearTimeout(timer); this.events.delete(listener); };
    });
    try {
      const loadAndResume = async () => {
        await this.command(['loadfile', url, 'replace']);
        // mpv 会把暂停属性带到下一条；明确的点播／下一首应开始播放。
        await this.command(['set_property', 'pause', false]);
      };
      await Promise.all([loadAndResume(), eventResult]);
    } catch (error) {
      cancelWait();
      throw error;
    }
    return this.status();
  }

  async setPaused(paused: boolean): Promise<PlaybackSnapshot> {
    if (!this.process) throw new Error('当前没有正在运行的播放器');
    if (this.state !== 'playing' && this.state !== 'paused') throw new Error('当前视频未在播放；请重新点播或选择播放历史中的其他视频');
    await this.command(['set_property', 'pause', paused]);
    this.state = paused ? 'paused' : 'playing';
    return this.status();
  }

  onEnded(listener: () => void): void { this.endedListeners.add(listener); }

  async setVolume(volume: number): Promise<PlaybackSnapshot> {
    if (!this.process) throw new Error('当前没有正在运行的播放器');
    await this.command(['set_property', 'volume', volume]);
    return this.status();
  }

  async setLoop(enabled: boolean): Promise<void> {
    await this.command(['set_property', 'loop-file', enabled ? 'inf' : 'no']);
  }

  async stop(): Promise<PlaybackSnapshot> {
    if (!this.process) return this.status();
    await this.command(['stop']);
    this.state = 'idle';
    return this.status();
  }

  async status(): Promise<PlaybackSnapshot> {
    if (!this.process || !this.socket) return { state: this.state, position_seconds: null, duration_seconds: null, volume: null, recent_error: this.recentError };
    const safeGet = async (property: string): Promise<number | boolean | null> => {
      try {
        const data = await this.command(['get_property', property]);
        return typeof data === 'number' || typeof data === 'boolean' ? data : null;
      } catch { return null; }
    };
    const [position, duration, volume, paused] = await Promise.all([
      safeGet('time-pos'), safeGet('duration'), safeGet('volume'), safeGet('pause')
    ]);
    if (this.state === 'playing' || this.state === 'paused') this.state = paused === true ? 'paused' : 'playing';
    return {
      state: this.state,
      position_seconds: typeof position === 'number' ? position : null,
      duration_seconds: typeof duration === 'number' ? duration : null,
      volume: typeof volume === 'number' ? volume : null,
      recent_error: this.recentError
    };
  }

  close(): void {
    this.socket?.destroy();
    this.process?.kill();
    this.socket = undefined;
    this.process = undefined;
    this.state = 'idle';
  }
}
