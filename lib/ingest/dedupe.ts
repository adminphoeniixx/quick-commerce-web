export function dedupeLast<T>(rows: T[], keyOf: (row: T) => string): { merged: T[]; duplicates: number } {
  const map = new Map<string, T>();
  let duplicates = 0;
  for (const row of rows) {
    const key = keyOf(row);
    if (map.has(key)) duplicates++;
    map.set(key, row);
  }
  return { merged: [...map.values()], duplicates };
}
