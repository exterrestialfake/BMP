import type { ChildProcess } from 'node:child_process';

/** 只有主 MCP 实例负责维持一个桌面面板；短暂启动失败后会重试。 */
export class PanelSupervisor {
  private active = false;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly spawnPanel: () => ChildProcess,
    private readonly retryMs = 3000,
    private readonly reportError: (error: Error) => void = () => undefined
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.launch();
  }

  stop(): void {
    this.active = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private retry(): void {
    if (!this.active || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.launch();
    }, this.retryMs);
    this.retryTimer.unref();
  }

  private launch(): void {
    if (!this.active) return;
    let child: ChildProcess;
    try {
      child = this.spawnPanel();
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)));
      this.retry();
      return;
    }

    let finished = false;
    const finish = (restart: boolean): void => {
      if (finished) return;
      finished = true;
      if (restart) this.retry();
    };
    child.once('error', (error) => {
      this.reportError(error);
      finish(true);
    });
    child.once('exit', (code, signal) => finish(code !== 0 || signal !== null));
    child.unref();
  }
}
