export interface Candidate {
  candidate_id: string;
  bvid: string;
  title: string;
  uploader: string;
  duration_seconds: number | null;
  published_date: string | null;
  cover_url: string | null;
  url: string;
}

const BVID = /^BV[A-Za-z0-9]{10}$/;
const HOSTS = new Set(['www.bilibili.com', 'bilibili.com', 'm.bilibili.com']);
const COVER_HOSTS = new Set(['i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com']);

function publishedDate(value: unknown): string | null {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // B 站展示的发布日期按中国标准时间计算，避免 UTC 跨日时显示前一天。
  const date = new Date((seconds + 8 * 3600) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function canonicalCoverUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (!COVER_HOSTS.has(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    url.protocol = 'https:';
    return url.toString();
  } catch { return null; }
}

export function canonicalVideoUrl(input: string): string {
  const value = input.trim();
  if (BVID.test(value)) return `https://www.bilibili.com/video/${value}`;
  if (value.length > 2048) throw new Error('视频地址过长');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请提供完整 BV 号或 B 站视频链接');
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('只接受 HTTPS 的 B 站视频链接');
  }
  const match = /^\/video\/(BV[A-Za-z0-9]{10})\/?$/.exec(url.pathname);
  if (!match) throw new Error('链接必须指向 B 站 BV 视频页');
  return `https://www.bilibili.com/video/${match[1]}`;
}

export function candidateFromYtDlp(raw: Record<string, unknown>, index: number): Candidate | null {
  const inputs = [raw.id, raw.webpage_url, raw.original_url, raw.url].filter((v): v is string => typeof v === 'string');
  let url: string | undefined;
  for (const input of inputs) {
    try {
      url = canonicalVideoUrl(input);
      break;
    } catch {
      // Search extractors can emit non-page URLs. Only a canonical BV page is retained.
    }
  }
  if (!url) return null;
  const bvid = url.slice(url.lastIndexOf('/') + 1);
  const duration = Number(raw.duration);
  return {
    candidate_id: String(index),
    bvid,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : bvid,
    uploader: typeof raw.uploader === 'string' ? raw.uploader : typeof raw.channel === 'string' ? raw.channel : '未知 UP 主',
    duration_seconds: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    published_date: publishedDate(raw.pubdate),
    cover_url: canonicalCoverUrl(raw.pic),
    url
  };
}
