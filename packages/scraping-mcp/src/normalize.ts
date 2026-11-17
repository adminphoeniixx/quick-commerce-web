export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function parsePackSize(value?: string): { amount: number; unit: string } | null {
  if (!value) return null;
  const match = value.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(kg|g|mg|l|ml|pcs?|pieces?)/);
  if (!match) return null;
  const unit = match[2].startsWith("pc") || match[2].startsWith("piece") ? "pc" : match[2];
  return { amount: Number(match[1]), unit };
}

export function deterministicMatch(a: { title: string; brand?: string; packSize?: string }, b: { title: string; brand?: string; packSize?: string }): number {
  const ap = parsePackSize(a.packSize); const bp = parsePackSize(b.packSize);
  if (ap && bp && (ap.unit !== bp.unit || ap.amount !== bp.amount)) return 0;
  const brandMatch = a.brand && b.brand ? normalizeTitle(a.brand) === normalizeTitle(b.brand) : true;
  if (!brandMatch) return 0;
  return normalizeTitle(a.title) === normalizeTitle(b.title) ? 1 : 0;
}
