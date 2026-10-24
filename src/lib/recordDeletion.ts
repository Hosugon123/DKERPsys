export function mergeDeletionTimes(...maps: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const map of maps) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [key, value] of Object.entries(map)) {
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) continue;
      if (!out[key] || Date.parse(value) > Date.parse(out[key])) out[key] = value;
    }
  }
  return out;
}
