export interface DateRange { from: string; to: string }
export type DatePreset = "today-yesterday" | "last-7" | "last-14" | "last-28" | "last-30" | "this-week" | "last-week" | "this-month" | "last-month" | "maximum" | "custom";

const DAY = 86_400_000;
const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const utc = (iso: string) => { const [y, m, d] = parts(iso); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const move = (date: string, days: number) => iso(new Date(utc(date).getTime() + days * DAY));

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: "today-yesterday", label: "Today and yesterday" },
  { id: "last-7", label: "Last 7 days" }, { id: "last-14", label: "Last 14 days" },
  { id: "last-28", label: "Last 28 days" }, { id: "last-30", label: "Last 30 days" },
  { id: "this-week", label: "This week" }, { id: "last-week", label: "Last week" },
  { id: "this-month", label: "This month" }, { id: "last-month", label: "Last month" },
  { id: "maximum", label: "Maximum" }, { id: "custom", label: "Custom" },
];

export function rangeForPreset(preset: DatePreset, end: string, available: DateRange): DateRange {
  const [y, m] = parts(end);
  const day = utc(end).getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  let range: DateRange;
  switch (preset) {
    case "today-yesterday": range = { from: move(end, -1), to: end }; break;
    case "last-7": range = { from: move(end, -6), to: end }; break;
    case "last-14": range = { from: move(end, -13), to: end }; break;
    case "last-28": range = { from: move(end, -27), to: end }; break;
    case "last-30": range = { from: move(end, -29), to: end }; break;
    case "this-week": range = { from: move(end, mondayOffset), to: end }; break;
    case "last-week": { const monday = move(end, mondayOffset); range = { from: move(monday, -7), to: move(monday, -1) }; break; }
    case "this-month": range = { from: `${y}-${String(m).padStart(2, "0")}-01`, to: end }; break;
    case "last-month": { const first = new Date(Date.UTC(y, m - 2, 1)); range = { from: iso(first), to: iso(new Date(Date.UTC(y, m - 1, 0))) }; break; }
    case "maximum": return available;
    default: return available;
  }
  return { from: range.from < available.from ? available.from : range.from, to: range.to > available.to ? available.to : range.to };
}

export function previousRange(range: DateRange): DateRange {
  const days = Math.round((utc(range.to).getTime() - utc(range.from).getTime()) / DAY) + 1;
  return { from: move(range.from, -days), to: move(range.to, -days) };
}

export function rangeLabel(range: DateRange, preset: DatePreset) {
  return DATE_PRESETS.find((x) => x.id === preset)?.label ?? `${range.from} – ${range.to}`;
}
