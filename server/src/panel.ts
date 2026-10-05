import { spawn, type ChildProcess } from 'node:child_process';

/** 启动 Windows 悬浮面板。 */
export function spawnPanelProcess(script: string, pipeName: string, hostProcessId = process.ppid): ChildProcess {
  return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script,
    '-PipeName', pipeName, '-HostProcessId', String(hostProcessId)], {
    shell: false, windowsHide: true, stdio: 'ignore'
  });
}

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

  private retry(delayMs = this.retryMs): void {
    if (!this.active || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.launch();
    }, delayMs);
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
    const finish = (delayMs = this.retryMs): void => {
      if (finished) return;
      finished = true;
      this.retry(delayMs);
    };
    child.once('error', (error) => {
      this.reportError(error);
      finish();
    });
    // 主 MCP 仍运行时继续监督；互斥锁占用或宿主已退出时放慢重试。
    child.once('exit', (code) => finish(code === 10 || code === 11 ? this.retryMs * 5 : this.retryMs));
    child.unref();
  }
}
