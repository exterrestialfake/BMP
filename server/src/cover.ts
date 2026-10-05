import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalCoverUrl } from './video.js';

const MAX_IMAGE_BYTES = 1_500_000;
const CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp', 'gif'] as const;
const CACHE_NAME = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;
const DEFAULT_CACHE = resolve(process.env.LOCALAPPDATA ?? tmpdir(), 'bilibili-audio', 'covers');

async function visiblePath(path: string): Promise<string> {
  // 带包身份的 Windows 进程会把 AppData 写入 LocalCache；返回实际路径供包外进程读取。
  return (await realpath(path)).replaceAll('\\', '/');
}

type FetchImage = (url: string, options: RequestInit) => Promise<Response>;

function imageExtension(bytes: Buffer): typeof IMAGE_EXTENSIONS[number] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif';
  return null;
}

async function readLimited(response: Response): Promise<Buffer | null> {
  if (!response.body) throw new Error('响应没有图片数据');
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) {
    await response.body.cancel();
    throw new Error('图片超过 1.5 MB');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error('图片超过 1.5 MB');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return size > 0 ? Buffer.concat(chunks, size) : null;
}

async function existingCover(directory: string, hash: string): Promise<string | null> {
  for (const extension of IMAGE_EXTENSIONS) {
    const path = join(directory, `${hash}.${extension}`);
    try {
      const info = await lstat(path);
      if (info.isFile() && info.size > 0 && info.size <= MAX_IMAGE_BYTES && Date.now() - info.mtimeMs < CACHE_AGE_MS) {
        return await visiblePath(path);
      }
    } catch { /* No cached copy with this extension. */ }
  }
  return null;
}

const prunedDirectories = new Set<string>();
async function pruneOldCovers(directory: string): Promise<void> {
  if (prunedDirectories.has(directory)) return;
  prunedDirectories.add(directory);
  try {
    for (const name of await readdir(directory)) {
      if (!CACHE_NAME.test(name)) continue;
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isFile() && Date.now() - info.mtimeMs >= CACHE_AGE_MS) await unlink(path);
    }
  } catch { /* A cache cleanup failure must not block search. */ }
}

export async function cacheCover(
  coverUrl: string | null,
  directory = DEFAULT_CACHE,
  fetchImage: FetchImage = fetch
): Promise<string | null> {
  const url = canonicalCoverUrl(coverUrl);
  if (!url) return null;
  const hash = createHash('sha256').update(url).digest('hex');
  try {
    await mkdir(directory, { recursive: true });
    await pruneOldCovers(directory);
    const cached = await existingCover(directory, hash);
    if (cached) return cached;
    let bytes: Buffer | null = null;
    // 冷缓存偶尔在 HTTP 200 后读流超时；仅对暂时网络故障再试一次。
    // 两次期限分别为 3.5 秒与 1.5 秒，不能无限延长候选展示。
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetchImage(url, {
          redirect: 'manual',
          headers: { Referer: 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(attempt === 0 ? 3500 : 1500)
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`HTTP ${response.status}`);
        }
        bytes = await readLimited(response);
        break;
      } catch (error) {
        const transient = error instanceof TypeError || (error instanceof Error &&
          (['TimeoutError', 'AbortError'].includes(error.name) || /^HTTP (?:429|502|503|504)$/.test(error.message)));
        if (attempt !== 0 || !transient) throw error;
      }
    }
    if (!bytes) throw new Error('响应图片为空');
    const extension = imageExtension(bytes);
    if (!extension) throw new Error('响应不是支持的图片格式');
    const target = join(directory, `${hash}.${extension}`);
    const temp = join(directory, `${hash}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    try {
      await writeFile(temp, bytes, { flag: 'wx' });
      try {
        await rename(temp, target);
      } catch (error) {
        const raced = await existingCover(directory, hash);
        if (raced) return raced;
        throw error;
      }
    } finally {
      await unlink(temp).catch(() => undefined);
    }
    return await visiblePath(target);
  } catch (error) {
    // 诊断仅写 stderr，不增加 MCP 返回值，也不让一张失败的封面阻断候选。
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    process.stderr.write(`封面缓存失败 ${url}：${reason.replace(/[\r\n]+/g, ' ')}\n`);
    return null;
  }
}
