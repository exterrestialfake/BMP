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
}

export class PlaybackController {
  private readonly searches = new Map<string, SearchRecord>();
  private current: Candidate | null = null;
  private active: { candidates: Candidate[]; index: number } | null = null;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(private readonly searcher: Pick<BilibiliSearch, 'search'>, private readonly player: PlayerPort) {}

  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.catch(() => undefined);
    return result;
  }

  async search(query: string, limit = 5): Promise<SearchResponse> {
    const candidates = await this.searcher.search(query, limit);
    const record: SearchRecord = { id: randomUUID(), query: query.trim(), createdAt: Date.now(), candidates };
    for (const [id, old] of this.searches) {
      if (Date.now() - old.createdAt > 30 * 60_000 || this.searches.size >= 20) this.searches.delete(id);
    }
    this.searches.set(record.id, record);
    return { search_id: record.id, query: record.query, candidates };
  }

  playSelection(searchId: string, candidateId: string): Promise<StatusResponse> {
    return this.ordered(async () => {
      const record = this.searches.get(searchId);
      if (!record || Date.now() - record.createdAt > 30 * 60_000) throw new Error('候选列表已过期，请重新搜索并选择');
      const index = record.candidates.findIndex((candidate) => candidate.candidate_id === candidateId);
      if (index < 0) throw new Error('候选编号不属于这次搜索，请重新选择');
      const candidate = record.candidates[index];
      await this.player.load(candidate.url);
      this.current = candidate;
      this.active = { candidates: record.candidates, index };
      return this.status();
    });
  }

  playDirect(input: string): Promise<StatusResponse> {
    return this.ordered(async () => {
      const url = canonicalVideoUrl(input);
      const bvid = url.slice(url.lastIndexOf('/') + 1);
      await this.player.load(url);
      this.current = { candidate_id: 'direct', bvid, title: bvid, uploader: '未知 UP 主', duration_seconds: null, url };
      this.active = null;
      return this.status();
    });
  }

  next(): Promise<StatusResponse> {
    return this.ordered(async () => {
      if (!this.active) throw new Error('当前没有同次搜索的下一候选');
      const index = this.active.index + 1;
      if (index >= this.active.candidates.length) throw new Error('本次搜索已没有下一条');
      const candidate = this.active.candidates[index];
      await this.player.load(candidate.url);
      this.active.index = index;
      this.current = candidate;
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
      await this.player.stop();
      return this.status();
    });
  }

  async status(): Promise<StatusResponse> {
    const playback = await this.player.status();
    return { ...playback, current: this.current, remaining_candidates: this.active ? this.active.candidates.length - this.active.index - 1 : 0 };
  }

  close(): void { this.player.close(); }
}
