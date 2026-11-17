"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { DATE_PRESETS, previousRange, rangeForPreset, rangeLabel, type DatePreset, type DateRange } from "@/lib/dateRanges";
import { field, fieldStyle } from "./SellerShell";

export interface DateSelection { range: DateRange; preset: DatePreset; compare: boolean; comparison: DateRange | null }

export function DateRangeFilter({ value, available, onChange, allowCompare = true }: { value: DateSelection; available: DateRange; onChange: (next: DateSelection) => void; allowCompare?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close);
  }, []);
  const choose = (preset: DatePreset) => {
    if (preset === "custom") return setDraft((d) => ({ ...d, preset }));
    const range = rangeForPreset(preset, available.to, available);
    setDraft((d) => ({ ...d, preset, range, comparison: d.compare ? previousRange(range) : null }));
  };
  const setRange = (key: keyof DateRange, date: string) => setDraft((d) => {
    const range = { ...d.range, [key]: date };
    return { ...d, preset: "custom", range, comparison: d.compare ? previousRange(range) : null };
  });
  return <div className="relative" ref={panel}>
    <button type="button" onClick={() => { setDraft(value); setOpen((x) => !x); }} className="inline-flex items-center gap-2 rounded-[9px] border px-3 py-2 text-[13px] font-semibold" style={fieldStyle} aria-expanded={open}>
      <CalendarDays size={15} /><span>{rangeLabel(value.range, value.preset)}</span><span className="tnum text-[11px]" style={{ color: "var(--muted)" }}>{value.range.from} – {value.range.to}</span><ChevronDown size={14} />
    </button>
    {open && <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-[min(760px,calc(100vw-40px))] rounded-xl border p-4 shadow-2xl" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="mb-3 flex items-center justify-between"><b>Date range</b><button aria-label="Close date filter" onClick={() => setOpen(false)}><X size={17} /></button></div>
      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <div className="space-y-1">{DATE_PRESETS.map((p) => <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-black/5"><input type="radio" name="date-preset" checked={draft.preset === p.id} onChange={() => choose(p.id)} />{p.label}</label>)}</div>
        <div className="flex min-h-[260px] flex-col">
          <p className="mb-2 text-[12px] font-semibold" style={{ color: "var(--muted)" }}>Selected period</p>
          <div className="flex flex-wrap items-center gap-2"><input type="date" aria-label="Start date" className={field} style={fieldStyle} min={available.from} max={draft.range.to} value={draft.range.from} onChange={(e) => setRange("from", e.target.value)} /><span>–</span><input type="date" aria-label="End date" className={field} style={fieldStyle} min={draft.range.from} max={available.to} value={draft.range.to} onChange={(e) => setRange("to", e.target.value)} /></div>
          {allowCompare && <label className="mt-6 flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={draft.compare} onChange={(e) => setDraft((d) => ({ ...d, compare: e.target.checked, comparison: e.target.checked ? previousRange(d.range) : null }))} />Compare with previous period</label>}
          {allowCompare && draft.compare && draft.comparison && <div className="mt-3 rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>Comparison: <span className="tnum font-semibold">{draft.comparison.from} – {draft.comparison.to}</span></div>}
          <p className="mt-auto text-[11px]" style={{ color: "var(--muted)" }}>Dates are shown in Kolkata Time</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t pt-3" style={{ borderColor: "var(--border)" }}><button className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: "var(--border)" }} onClick={() => { setDraft(value); setOpen(false); }}>Cancel</button><button className="rounded-lg px-4 py-2 text-[13px] font-semibold" style={{ background: "var(--accent)", color: "var(--plane)" }} onClick={() => { onChange(draft); setOpen(false); }}>Update</button></div>
    </div>}
  </div>;
}
