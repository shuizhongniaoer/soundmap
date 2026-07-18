const TYPES = new Set(['反常识', '方法', '问题', '金句', '联想']);

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeSprouts(raw, segments) {
  const candidates = Array.isArray(raw) ? raw : raw && raw.sprouts;
  if (!Array.isArray(candidates) || !Array.isArray(segments)) return { items: [] };
  const seenSegments = new Set();
  const seenTitles = new Set();
  const items = [];
  for (const candidate of candidates) {
    const segmentIndex = Number(candidate && candidate.segment_index);
    const score = Number(candidate && candidate.score);
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= segments.length) continue;
    if (!Number.isFinite(score) || score < 0.65) continue;
    const title = clean(candidate.title, 40);
    const expansion = clean(candidate.expansion, 800);
    const aha = clean(candidate.aha, 180);
    const type = TYPES.has(candidate.type) ? candidate.type : '联想';
    const titleKey = title.toLocaleLowerCase();
    if (!title || !expansion || !aha || seenSegments.has(segmentIndex) || seenTitles.has(titleKey)) continue;
    const source = segments[segmentIndex] || {};
    if (!clean(source.text, 2000)) continue;
    seenSegments.add(segmentIndex);
    seenTitles.add(titleKey);
    items.push({
      title,
      type,
      source: clean(source.text, 2000),
      speaker: clean(source.speaker, 80),
      start: Math.max(0, Number(source.start) || 0),
      segmentIndex,
      expansion,
      aha,
      score: Math.min(1, score),
    });
    if (items.length === 5) break;
  }
  return { items };
}

module.exports = { normalizeSprouts };
