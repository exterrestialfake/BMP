import type { Candidate } from './video.js';

export type DisplayCandidate = Candidate & { cover_path: string | null };

export interface SearchDisplayResponse {
  search_id: string;
  candidate_ids: string[];
  display_markdown: string;
}

export function presentSearchResults(searchId: string, candidates: DisplayCandidate[]): SearchDisplayResponse {
  return {
    search_id: searchId,
    candidate_ids: candidates.map((candidate) => candidate.candidate_id),
    display_markdown: formatCandidateList(candidates)
  };
}

function safeText(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|])/g, '\\$1').trim();
}

function duration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '时长未知';
  const total = Math.round(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}小时${minutes}分${String(seconds).padStart(2, '0')}秒`
    : `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

export function formatCandidateList(candidates: DisplayCandidate[]): string {
  if (candidates.length === 0) return '没有找到可选的 B 站视频，请换个检索词。';
  const paragraphs = candidates.map((candidate, index) => {
    const number = String(index + 1);
    const title = safeText(candidate.title);
    const uploader = safeText(candidate.uploader);
    const published = candidate.published_date ?? '日期未知';
    const details = `UP 主：${uploader} ｜ 时长：${duration(candidate.duration_seconds)} ｜ 发布日期：${published} ｜ BV 号：\`${candidate.bvid}\` ｜ [视频链接](${candidate.url})`;
    const cover = candidate.cover_path ? `![第 ${number} 项封面](<${candidate.cover_path}>)` : '封面暂不可用。';
    return `**${number}. ${title}**  \n${details}\n\n${cover}`;
  });
  return `找到这些版本，请回复编号选择：\n\n${paragraphs.join('\n\n')}`;
}
