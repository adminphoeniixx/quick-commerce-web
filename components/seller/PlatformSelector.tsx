"use client";
import { Check } from "lucide-react";
import { PLATFORMS } from "@/lib/platforms";

const marks: Record<string, string> = { blinkit: "B", instamart: "S", zepto: "Z", bigbasket: "bb" };

export function PlatformSelector({ value, onChange }: { value: string; onChange: (platform: string) => void }) {
  return <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Platform">
    {PLATFORMS.map((platform) => {
      const active = value === platform.slug;
      return <button key={platform.slug} type="button" role="radio" aria-checked={active} onClick={() => onChange(platform.slug)}
        className="inline-flex items-center gap-2 rounded-xl border px-2.5 py-2 text-[12px] font-semibold transition-colors"
        style={{ borderColor: active ? platform.color : "var(--border)", background: active ? "var(--surface-2)" : "var(--surface)", boxShadow: active ? `inset 0 0 0 1px ${platform.color}` : undefined }}>
        <span className="flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-black text-white" style={{ background: platform.color }}>{marks[platform.slug]}</span>
        {platform.name}{active && <span className="flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ background: platform.color }}><Check size={11} strokeWidth={3} /></span>}
      </button>;
    })}
  </div>;
}
