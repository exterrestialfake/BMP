export interface Candidate {
  candidate_id: string;
  bvid: string;
  title: string;
  uploader: string;
  duration_seconds: number | null;
  url: string;
}

const BVID = /^BV[A-Za-z0-9]{10}$/;
const HOSTS = new Set(['www.bilibili.com', 'bilibili.com', 'm.bilibili.com']);

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
    url
  };
}
