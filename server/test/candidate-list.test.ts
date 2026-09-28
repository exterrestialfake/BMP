import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCandidateList, type DisplayCandidate } from '../src/candidate-list.js';

const example: DisplayCandidate = {
  candidate_id: '1', bvid: 'BV1vx411w7Hc', title: '琵琶曲 *现场* <em>版',
  uploader: 'UP [甲]', duration_seconds: 147, published_date: '2026-09-05',
  cover_url: 'https://i0.hdslb.com/bfs/archive/example.jpg',
  cover_path: 'C:/Users/Test User/AppData/Local/bilibili-audio/covers/example.jpg',
  url: 'https://www.bilibili.com/video/BV1vx411w7Hc'
};

test('候选列表逐项呈现必需字段，转义外部文字并引用本机封面', () => {
  const output = formatCandidateList([example]);
  assert.match(output, /\*\*1\. 琵琶曲 \\\*现场\\\* &lt;em&gt;版\*\*/);
  assert.match(output, /UP 主：UP \\\[甲\\\]/);
  assert.match(output, /时长：2分27秒/);
  assert.match(output, /发布日期：2026-09-05/);
  assert.match(output, /BV1vx411w7Hc/);
  assert.match(output, /\[视频链接\]\(https:\/\/www\.bilibili\.com\/video\/BV1vx411w7Hc\)/);
  assert.match(output, /!\[第 1 项封面\]\(<C:\/Users\/Test User\/.*\.jpg>\)/);
  assert.ok(!output.includes('<em>'));
});

test('缺失日期或图片时保留可选择文字；空列表有明确提示', () => {
  const output = formatCandidateList([{ ...example, candidate_id: '2', duration_seconds: null, published_date: null, cover_path: null }]);
  assert.match(output, /日期未知/);
  assert.match(output, /时长未知/);
  assert.match(output, /封面暂不可用/);
  assert.ok(!output.includes('!['));
  assert.equal(formatCandidateList([]), '没有找到可选的 B 站视频，请换个检索词。');
});
