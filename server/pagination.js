function parsePage(query = {}) {
  const hasPaging = query.limit !== undefined || query.offset !== undefined;
  const rawLimit = Number(query.limit ?? 50);
  const rawOffset = Number(query.offset ?? 0);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;
  const offset = Number.isInteger(rawOffset) ? Math.max(rawOffset, 0) : 0;
  return { hasPaging, limit, offset };
}

module.exports = { parsePage };
