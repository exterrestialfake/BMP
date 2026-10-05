import { spawn } from 'node:child_process';
import { candidateFromYtDlp, type Candidate } from './video.js';

export class BilibiliSearch {
  private preferVisitor = false;
  constructor(private readonly executable: string) {}

  async search(query: string, limit: number): Promise<Candidate[]> {
    const keyword = query.trim();
    if (!keyword || keyword.length > 120) throw new Error('检索词应为 1–120 个字符');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('结果数应为 1–10');

    // 同一进程已遇到 412 且备用路径可用时，省去反复启动失败搜索的等待。
    if (this.preferVisitor) {
      try { return await this.searchWithVisitorCookie(keyword, limit); }
      catch { this.preferVisitor = false; }
    }

    let output: string;
    try {
      output = await new Promise<string>((resolve, reject) => {
      const args = ['--flat-playlist', '--dump-json', '--no-warnings', `bilisearch${limit}:${keyword}`];
      const child = spawn(this.executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(stdout);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error('B 站搜索超时'));
      }, 30000);
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > 2_000_000) {
          child.kill();
          finish(new Error('搜索结果过大'));
        }
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-3000); });
      child.on('error', (err) => finish(new Error(`无法启动 yt-dlp：${err.message}`)));
      child.on('close', (code) => {
        if (code !== 0 && /HTTP Error 412/.test(stderr)) finish(new Error('B 站搜索接口拒绝请求（HTTP 412）；可直接提供 BV 号播放'));
        else if (code !== 0) finish(new Error(`B 站搜索失败：${stderr.trim() || `退出码 ${code}`}`));
        else finish();
      });
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('HTTP 412')) {
        const candidates = await this.searchWithVisitorCookie(keyword, limit);
        this.preferVisitor = true;
        return candidates;
      }
      throw error;
    }

    const seen = new Set<string>();
    const ids: string[] = [];
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { continue; }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const id = (raw as Record<string, unknown>).id;
      if (typeof id !== 'string' || !/^\d{1,20}$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    // bilisearch 的 flat 结果只有 AV 号；逐条向 B 站公开视频详情接口补全 BV、标题与时长。
    const fetchDetail = async (id: string): Promise<Candidate | null> => {
      try {
        const response = await fetch(`https://api.bilibili.com/x/web-interface/view?aid=${id}`, {
          headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' },
          signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) return null;
        const body = await response.json() as { code?: number; data?: { bvid?: string; title?: string; owner?: { name?: string }; duration?: number; pubdate?: number; pic?: string } };
        if (body.code !== 0 || !body.data) return null;
        return candidateFromYtDlp({
          id: body.data.bvid,
          title: body.data.title,
          uploader: body.data.owner?.name,
          duration: body.data.duration,
          pubdate: body.data.pubdate,
          pic: body.data.pic
        }, 0);
      } catch {
        // A deleted or restricted video must not invalidate the other candidates.
        return null;
      }
    };
    const candidates: Candidate[] = [];
    for (let offset = 0; offset < ids.length; offset += 3) {
      const batch = await Promise.all(ids.slice(offset, offset + 3).map(fetchDetail));
      for (const candidate of batch) {
        if (candidate) candidates.push({ ...candidate, candidate_id: String(candidates.length + 1) });
      }
    }
    if (ids.length > 0 && candidates.length === 0) {
      const found = await this.searchWithVisitorCookie(keyword, limit);
      this.preferVisitor = true;
      return found;
    }
    return candidates;
  }

  private async searchWithVisitorCookie(keyword: string, limit: number): Promise<Candidate[]> {
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    const spiResponse = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': userAgent, Referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(8000)
    });
    if (!spiResponse.ok) throw new Error(`无法获取 B 站公开访客标识：HTTP ${spiResponse.status}`);
    const spi = await spiResponse.json() as { code?: number; data?: { b_3?: string; b_4?: string } };
    const buvid3 = spi.data?.b_3;
    const buvid4 = spi.data?.b_4;
    if (spi.code !== 0 || !buvid3 || !buvid4 || /[\r\n;]/.test(buvid3 + buvid4)) {
      throw new Error('B 站未返回有效的公开访客标识');
    }
    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.searchParams.set('search_type', 'video');
    url.searchParams.set('keyword', keyword);
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', String(limit));
    const response = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        Referer: 'https://search.bilibili.com/',
        Cookie: `buvid3=${buvid3}; buvid4=${buvid4}`
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`B 站访客搜索失败：HTTP ${response.status}`);
    const body = await response.json() as { code?: number; data?: { result?: Array<Record<string, unknown>> } };
    if (body.code !== 0) throw new Error(`B 站访客搜索失败：接口代码 ${body.code ?? '未知'}`);
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (const raw of body.data?.result ?? []) {
      const duration = typeof raw.duration === 'string'
        ? raw.duration.split(':').reduce((total: number, part: string) => total * 60 + Number(part), 0)
        : raw.duration;
      const title = typeof raw.title === 'string'
        ? raw.title.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        : raw.title;
      const candidate = candidateFromYtDlp({ id: raw.bvid, title, uploader: raw.author, duration, pubdate: raw.pubdate, pic: raw.pic }, candidates.length + 1);
      if (!candidate || seen.has(candidate.bvid)) continue;
      seen.add(candidate.bvid);
      candidates.push(candidate);
      if (candidates.length >= limit) break;
    }
    return candidates;
  }
}
