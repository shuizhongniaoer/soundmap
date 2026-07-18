function searchableText(rec) {
  const segments = (rec.transcript && rec.transcript.segments) || [];
  const summary = rec.summary || {};
  const sprouts = (rec.sprouts && rec.sprouts.items) || [];
  return [
    rec.title,
    rec.originalName,
    ...segments.flatMap(seg => [seg.speaker, seg.text]),
    summary.abstract,
    ...(summary.key_points || []),
    ...(summary.todos || []).flatMap(todo => [todo.task, todo.owner]),
    ...(summary.quotes || []),
    ...sprouts.flatMap(item => [item.title, item.source, item.seedSummary, item.reference, item.echo, item.expansion, item.aha]),
  ].filter(Boolean).join('\n');
}

function snippetFor(rec, query) {
  const needle = query.toLocaleLowerCase();
  const segments = (rec.transcript && rec.transcript.segments) || [];
  const segment = segments.find(seg =>
    `${seg.speaker || ''} ${seg.text || ''}`.toLocaleLowerCase().includes(needle));
  if (segment) return trimSnippet(`${segment.speaker || ''}：${segment.text || ''}`, query);
  const summary = rec.summary || {};
  const sprouts = (rec.sprouts && rec.sprouts.items) || [];
  const candidates = [
    summary.abstract, ...(summary.key_points || []), ...(summary.quotes || []),
    ...sprouts.flatMap(item => [item.title, item.source, item.seedSummary, item.reference, item.echo, item.expansion, item.aha]),
  ];
  const match = candidates.find(value => String(value || '').toLocaleLowerCase().includes(needle));
  return match ? trimSnippet(String(match), query) : null;
}

function trimSnippet(value, query, maxLength = 180) {
  if (value.length <= maxLength) return value;
  const index = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index - Math.floor(maxLength / 3));
  const end = Math.min(value.length, start + maxLength);
  return `${start ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
}

function searchRecordings(recordings, rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return recordings.map(rec => ({ rec, match: null }));
  const needle = query.toLocaleLowerCase();
  return recordings
    .filter(rec => searchableText(rec).toLocaleLowerCase().includes(needle))
    .map(rec => ({ rec, match: snippetFor(rec, query) }));
}

module.exports = { searchableText, searchRecordings, trimSnippet };
