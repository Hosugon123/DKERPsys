type CountLine = { out: string; remain: string; remainSource?: 'counted' | 'estimated'; updatedAt?: string };

/** Normalize legacy name keys on writes, without changing stored historical snapshots on reads. */
export function normalizeStallLineAliases<T extends CountLine>(
  lines: Record<string, T>, items: ReadonlyArray<{ id: string; name: string }>,
): Record<string, T> {
  const next = { ...lines };
  const ids = new Set(items.map(item => item.id));
  const nameCounts = new Map<string, number>();
  for (const item of items) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);
  const priority = (line: T) => line.remainSource === 'counted' ? 2 :
    String(line.remain ?? '').trim() !== '' && line.remainSource !== 'estimated' ? 1 : 0;
  const time = (line: T) => Date.parse(line.updatedAt ?? '') || 0;
  const legacyScore = (line: T) => Math.abs(Number(line.out) || 0) + Math.abs(Number(line.remain) || 0);
  for (const item of items) {
    if (item.id === item.name || ids.has(item.name) || nameCounts.get(item.name) !== 1) continue;
    const alias = next[item.name];
    if (!alias) continue;
    const direct = next[item.id];
    let chosen = direct ?? alias;
    if (direct) {
      const directPriority = priority(direct), aliasPriority = priority(alias);
      if (directPriority !== aliasPriority) chosen = directPriority > aliasPriority ? direct : alias;
      else if (time(alias) > time(direct)) chosen = alias;
      else if (time(alias) === time(direct) && directPriority < 2 && legacyScore(alias) > legacyScore(direct)) chosen = alias;
    }
    next[item.id] = { ...chosen };
    delete next[item.name];
  }
  return next;
}
