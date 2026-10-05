import { randomUUID } from 'node:crypto';
import type { Candidate } from './video.js';
import { canonicalVideoUrl } from './video.js';
import type { BilibiliSearch } from './search.js';
import type { PlaybackSnapshot, PlayerPort } from './player.js';

interface SearchRecord {
  id: string;
  query: string;
  createdAt: number;
  candidates: Candidate[];
}

export interface SearchResponse {
  search_id: string;
  query: string;
  candidates: Candidate[];
}

export type PlaybackMode = 'off' | 'single' | 'sequential';

interface ControllerState {
  search: { version: number; latest: SearchRecord | null };
  history: { items: Candidate[]; cursor: number };
  mode: PlaybackMode;
}

export interface StatusResponse extends PlaybackSnapshot {
  current: Candidate | null;
  history_position: number;
  history_length: number;
  mode: PlaybackMode;
}

export class PlaybackController {
  private readonly state: ControllerState = {
    search: { version: 0, latest: null },
    history: { items: [], cursor: -1 },
    mode: 'off'
  };
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly searcher: Pick<BilibiliSearch, 'search'>, private readonly player: PlayerPort) {
    player.onEnded?.(() => {
      const current = this.current;
      const cursor = this.state.history.cursor;
      this.ordered(() => this.onEnded(current, cursor)).catch(() => undefined);
    });
  }

  private get current(): Candidate | null {
    return this.state.history.items[this.state.history.cursor] ?? null;
  }

  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.catch(() => undefined);
    return result;
  }

  async search(query: string, limit = 5): Promise<SearchResponse> {
    const version = ++this.state.search.version;
    this.state.search.latest = null;
    const candidates = await this.searcher.search(query, limit);
    if (version !== this.state.search.version) throw new Error('这次搜索已被更新的搜索取代，请使用最新候选');
    const record: SearchRecord = { id: randomUUID(), query: query.trim(), createdAt: Date.now(), candidates };
    this.state.search.latest = record;
    return { search_id: record.id, query: record.query, candidates };
  }

  private remember(candidate: Candidate): void {
    const history = this.state.history;
    const previousIndex = history.items.findIndex((item) => item.bvid === candidate.bvid);
    if (previousIndex >= 0) history.items.splice(previousIndex, 1);
    history.items.push(candidate);
    history.cursor = history.items.length - 1;
  }

  private async onEnded(current: Candidate | null, cursor: number): Promise<void> {
    const history = this.state.history;
    if (!current || this.current !== current || history.cursor !== cursor || this.state.mode !== 'sequential') return;
    const next = cursor + 1;
    if (next >= history.items.length) return;
    await this.player.load(history.items[next].url);
    history.cursor = next;
  }

  playSelection(searchId: string, candidateId: string): Promise<StatusResponse> {
    return this.ordered(async () => {
      const latest = this.state.search.latest;
      const record = latest?.id === searchId ? latest : null;
      if (!record || Date.now() - record.createdAt > 30 * 60_000) throw new Error('候选列表已过期，请重新搜索并选择');
      const candidate = record.candidates.find((item) => item.candidate_id === candidateId);
      if (!candidate) throw new Error('候选编号不属于这次搜索，请重新选择');
      await this.player.load(candidate.url);
      this.remember(candidate);
      return this.status();
    });
  }

  playDirect(input: string): Promise<StatusResponse> {
    return this.ordered(async () => {
      const url = canonicalVideoUrl(input);
      const bvid = url.slice(url.lastIndexOf('/') + 1);
      const candidate = this.state.history.items.find((item) => item.bvid === bvid)
        ?? { candidate_id: 'direct', bvid, title: bvid, uploader: '未知 UP 主', duration_seconds: null, published_date: null, cover_url: null, url };
      await this.player.load(candidate.url);
      this.remember(candidate);
      return this.status();
    });
  }

  next(): Promise<StatusResponse> {
    return this.ordered(async () => {
      const history = this.state.history;
      const index = history.cursor + 1;
      if (index >= history.items.length) throw new Error('播放历史已在末尾，没有下一首');
      await this.player.load(history.items[index].url);
      history.cursor = index;
      return this.status();
    });
  }

  previous(): Promise<StatusResponse> {
    return this.ordered(async () => {
      const history = this.state.history;
      const index = history.cursor - 1;
      if (index < 0) throw new Error('播放历史已在开头，没有上一首');
      await this.player.load(history.items[index].url);
      history.cursor = index;
      return this.status();
    });
  }

  setMode(mode: PlaybackMode): Promise<StatusResponse> {
    return this.ordered(async () => {
      if (!['off', 'single', 'sequential'].includes(mode)) throw new Error('未知播放模式');
      await this.player.setLoop?.(mode === 'single');
      this.state.mode = mode;
      return this.status();
    });
  }

  setPaused(paused: boolean): Promise<StatusResponse> {
    return this.ordered(async () => {
      if (paused) {
        const playback = await this.player.status();
        if (playback.state !== 'playing' && playback.state !== 'paused') return this.status();
      }
      await this.player.setPaused(paused);
      return this.status();
    });
  }

  setVolume(volume: number): Promise<StatusResponse> {
    return this.ordered(async () => {
      if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw new Error('音量应为 0–100 的整数');
      await this.player.setVolume(volume);
      return this.status();
    });
  }

  async status(): Promise<StatusResponse> {
    const playback = await this.player.status();
    const history = this.state.history;
    return { ...playback, current: this.current, history_position: history.cursor + 1,
      history_length: history.items.length, mode: this.state.mode };
  }

  close(): void { this.player.close(); }
}
