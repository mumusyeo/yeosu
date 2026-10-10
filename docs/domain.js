export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function safeUrl(value) {
  if (!value) return '';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export const normalizeName = name => name.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ko');
export function validateNickname(value) {
  const nickname=String(value||'').trim().replace(/\s+/gu,' ');
  if(!nickname||Array.from(nickname).length>40)throw new Error('닉네임은 1~40자로 입력해 주세요.');
  return nickname;
}
// Voting never closes. Old stored deadlines/confirmation flags have no effect.
export function pollResult(poll, candidates, votes) {
  const ranked = candidates.filter(c => c.poll_id === poll.id && !c.hidden).map(c => ({ ...c, count: votes.filter(v => v.poll_id === poll.id && v.candidate_id === c.id).length })).sort((a, b) => b.count - a.count || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const max = ranked[0]?.count || 0;
  const leaders = max ? ranked.filter(c => c.count === max) : [];
  return { kind: !max ? 'waiting' : leaders.length > 1 ? 'tie' : 'leader', leaders, ranked, count: max };
}
export function resultLabel(result, poll) {
  if (result.kind === 'waiting') return '투표 대기';
  if (result.kind === 'tie') return `공동 1위 · 각 ${result.count}표`;
  return `현재 1위 · ${result.count}표`;
}
export function newId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function validateCandidate(input) {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error('장소 이름은 1~80자로 입력해 주세요.');
  if (input.url && !safeUrl(input.url)) throw new Error('장소 링크는 http 또는 https 주소를 입력해 주세요.');
  if (input.description.length > 500) throw new Error('추천 이유는 500자까지 입력할 수 있어요.');
  const price = input.price === '' || input.price == null ? null : Number(input.price);
  if (price != null && (!Number.isSafeInteger(price) || price < 0 || price > 2147483647)) throw new Error('예상 가격은 0 이상의 정수로 입력해 주세요.');
  return { name, url: input.url ? safeUrl(input.url) : '', description: input.description.trim(), price };
}
export function validateMessage(value) {
  const content = value.trim();
  if (!content || content.length > 1000) throw new Error('메시지는 1~1,000자로 입력해 주세요.');
  return content;
}
