import { createHash } from 'node:crypto';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { homedir } from 'node:os';
import type { PlaybackController } from './controller.js';

type Method = 'search' | 'playSelection' | 'playDirect' | 'next' | 'setPaused' | 'setVolume' | 'status' | 'stop';
type Request = { method: Method; args: unknown[] };
type Reply = { ok: true; data: unknown } | { ok: false; error: string };

/** 同一 Windows 用户的 MCP 实例使用同一个本机控制管道。 */
export function defaultControlPipe(): string {
  const user = createHash('sha256').update(homedir().toLowerCase()).digest('hex').slice(0, 20);
  return `\\\\.\\pipe\\bilibili-audio-control-v1-${user}`;
}

export class SharedPlaybackController {
  private server?: Server;
  private role?: Promise<'owner' | 'client'>;
  private closed = false;

  constructor(private readonly local: PlaybackController, private readonly pipe = defaultControlPipe()) {}

  private async elect(): Promise<'owner' | 'client'> {
    const server = createServer((socket) => this.handle(socket));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.pipe, () => {
          server.off('error', reject);
          resolve();
        });
      });
      if (this.closed) { server.close(); throw new Error('控制服务已关闭'); }
      this.server = server;
      server.on('error', () => { this.server = undefined; this.role = undefined; });
      return 'owner';
    } catch (error) {
      server.close();
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') return 'client';
      throw error;
    }
  }

  private async invokeLocal({ method, args }: Request): Promise<unknown> {
    switch (method) {
      case 'search': return this.local.search(args[0] as string, args[1] as number | undefined);
      case 'playSelection': return this.local.playSelection(args[0] as string, args[1] as string);
      case 'playDirect': return this.local.playDirect(args[0] as string);
      case 'next': return this.local.next();
      case 'setPaused': return this.local.setPaused(args[0] as boolean);
      case 'setVolume': return this.local.setVolume(args[0] as number);
      case 'status': return this.local.status();
      case 'stop': return this.local.stop();
      default: throw new Error('未知控制命令');
    }
  }

  private handle(socket: Socket): void {
    let input = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      input += chunk;
      if (input.length > 64_000) { socket.destroy(); return; }
      const end = input.indexOf('\n');
      if (end < 0) return;
      socket.removeAllListeners('data');
      let request: Request;
      try { request = JSON.parse(input.slice(0, end)) as Request; }
      catch { socket.end(JSON.stringify({ ok: false, error: '无效控制请求' }) + '\n'); return; }
      if (!request || !Array.isArray(request.args)) {
        socket.end(JSON.stringify({ ok: false, error: '无效控制请求' }) + '\n');
        return;
      }
      this.invokeLocal(request).then(
        (data) => socket.end(JSON.stringify({ ok: true, data }) + '\n'),
        (error) => socket.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + '\n')
      );
    });
  }

  private remote(request: Request): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = connect(this.pipe);
      let output = '';
      let done = false;
      const finish = (error?: Error, data?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(data);
      };
      const timer = setTimeout(() => finish(new Error('跨会话控制超时')), 120_000);
      socket.setEncoding('utf8');
      socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
      socket.on('data', (chunk: string) => {
        output += chunk;
        if (output.length > 1_000_000) { finish(new Error('控制结果过大')); return; }
        const end = output.indexOf('\n');
        if (end < 0) return;
        try {
          const reply = JSON.parse(output.slice(0, end)) as Reply;
          if (reply.ok) finish(undefined, reply.data);
          else finish(new Error(reply.error));
        } catch { finish(new Error('无效控制结果')); }
      });
      socket.once('error', (error) => {
        this.role = undefined;
        finish(error);
      });
      socket.once('close', () => { if (!done) finish(new Error('控制连接已关闭')); });
    });
  }

  private async call<T>(method: Method, ...args: unknown[]): Promise<T> {
    if (this.closed) throw new Error('控制服务已关闭');
    this.role ??= this.elect();
    const request: Request = { method, args };
    return (await this.role === 'owner' ? this.invokeLocal(request) : this.remote(request)) as Promise<T>;
  }

  search(query: string, limit?: number) { return this.call<Awaited<ReturnType<PlaybackController['search']>>>('search', query, limit); }
  playSelection(searchId: string, candidateId: string) { return this.call<Awaited<ReturnType<PlaybackController['playSelection']>>>('playSelection', searchId, candidateId); }
  playDirect(video: string) { return this.call<Awaited<ReturnType<PlaybackController['playDirect']>>>('playDirect', video); }
  next() { return this.call<Awaited<ReturnType<PlaybackController['next']>>>('next'); }
  setPaused(paused: boolean) { return this.call<Awaited<ReturnType<PlaybackController['setPaused']>>>('setPaused', paused); }
  setVolume(volume: number) { return this.call<Awaited<ReturnType<PlaybackController['setVolume']>>>('setVolume', volume); }
  status() { return this.call<Awaited<ReturnType<PlaybackController['status']>>>('status'); }
  stop() { return this.call<Awaited<ReturnType<PlaybackController['stop']>>>('stop'); }

  close(): void {
    this.closed = true;
    this.server?.close();
    this.local.close();
  }
}
