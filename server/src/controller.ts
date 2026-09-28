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

export interface StatusResponse extends PlaybackSnapshot {
  current: Candidate | null;
  remaining_candidates: number;
  history_position: number;
  history_length: number;
  mode: 'off' | 'single' | 'sequential';
}

export class PlaybackController {
  private searchRecord: SearchRecord | null = null;
  private searchGeneration = 0;
  private current: Candidate | null = null;
  private active: { candidates: Candidate[]; index: number } | null = null;
  private readonly history: Candidate[] = [];
  private historyCursor = -1;
  private mode: StatusResponse['mode'] = 'off';
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(private readonly searcher: Pick<BilibiliSearch, 'search'>, private readonly player: PlayerPort) {
    player.onEnded?.(() => {
      const current = this.current;
      const cursor = this.historyCursor;
      void this.ordered(() => this.onEnded(current, cursor)).catch(() => undefined);
    });
  }

  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.catch(() => undefined);
    return result;
  }

  async search(query: string, limit = 5): Promise<SearchResponse> {
    const generation = ++this.searchGeneration;
    this.searchRecord = null;
    this.active = null;
    const candidates = await this.searcher.search(query, limit);
    if (generation !== this.searchGeneration) throw new Error('这次搜索已被更新的搜索取代，请使用最新候选');
    const record: SearchRecord = { id: randomUUID(), query: query.trim(), createdAt: Date.now(), candidates };
    this.searchRecord = record;
    return { search_id: record.id, query: record.query, candidates };
  }

  private remember(candidate: Candidate): void {
    const previousIndex = this.history.findIndex((item) => item.bvid === candidate.bvid);
    if (previousIndex >= 0) this.history.splice(previousIndex, 1);
    this.history.push(candidate);
    this.historyCursor = this.history.length - 1;
  }

  private async onEnded(current: Candidate | null, cursor: number): Promise<void> {
    if (!current || this.current !== current || this.historyCursor !== cursor || this.mode !== 'sequential') return;
    const next = cursor + 1;
    if (next >= this.history.length) return;
    const candidate = this.history[next];
    await this.player.load(candidate.url);
    this.historyCursor = next;
    this.active = null;
    this.current = candidate;
  }

  playSelection(searchId: string, candidateId: string): Promise<StatusResponse> {
    return this.ordered(async () => {
      const record = this.searchRecord?.id === searchId ? this.searchRecord : null;
      if (!record || Date.now() - record.createdAt > 30 * 60_000) throw new Error('候选列表已过期，请重新搜索并选择');
      const index = record.candidates.findIndex((candidate) => candidate.candidate_id === candidateId);
      if (index < 0) throw new Error('候选编号不属于这次搜索，请重新选择');
      const candidate = record.candidates[index];
      await this.player.load(candidate.url);
      this.current = candidate;
      this.active = { candidates: record.candidates, index };
      this.remember(candidate);
      return this.status();
    });
  }

  playDirect(input: string): Promise<StatusResponse> {
    return this.ordered(async () => {
      const url = canonicalVideoUrl(input);
      const bvid = url.slice(url.lastIndexOf('/') + 1);
      await this.player.load(url);
      this.current = this.history.find((item) => item.bvid === bvid)
        ?? { candidate_id: 'direct', bvid, title: bvid, uploader: '未知 UP 主', duration_seconds: null, published_date: null, cover_url: null, url };
      this.active = null;
      this.remember(this.current);
      return this.status();
    });
  }

  next(): Promise<StatusResponse> {
    return this.ordered(async () => {
      const index = this.historyCursor + 1;
      if (index >= this.history.length) throw new Error('播放历史已在末尾，没有下一首');
      const candidate = this.history[index];
      await this.player.load(candidate.url);
      this.historyCursor = index;
      this.active = null;
      this.current = candidate;
      return this.status();
    });
  }

  previous(): Promise<StatusResponse> {
    return this.ordered(async () => {
      const index = this.historyCursor - 1;
      if (index < 0) throw new Error('播放历史已在开头，没有上一首');
      const candidate = this.history[index];
      await this.player.load(candidate.url);
      this.historyCursor = index;
      this.active = null;
      this.current = candidate;
      return this.status();
    });
  }

  setMode(mode: StatusResponse['mode']): Promise<StatusResponse> {
    return this.ordered(async () => {
      if (!['off', 'single', 'sequential'].includes(mode)) throw new Error('未知播放模式');
      await this.player.setLoop?.(mode === 'single');
      this.mode = mode;
      return this.status();
    });
  }

  setPaused(paused: boolean): Promise<StatusResponse> {
    return this.ordered(async () => {
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

  stop(): Promise<StatusResponse> {
    return this.ordered(async () => {
      const state = (await this.player.status()).state;
      if (state === 'playing' || state === 'paused') await this.player.setPaused(true);
      return this.status();
    });
  }

  async status(): Promise<StatusResponse> {
    const playback = await this.player.status();
    return { ...playback, current: this.current, remaining_candidates: this.active ? this.active.candidates.length - this.active.index - 1 : 0,
      history_position: this.historyCursor + 1, history_length: this.history.length, mode: this.mode };
  }

  close(): void { this.player.close(); }
}
