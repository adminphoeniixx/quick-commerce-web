"use client";

import { PLATFORMS } from "@/lib/platforms";
import type { Channel } from "@/lib/types";

export function ChannelTabs({
  value,
  onChange,
}: {
  value: Channel;
  onChange: (c: Channel) => void;
}) {
  const chip = (active: boolean) =>
    ({
      borderColor: active ? "var(--accent)" : "var(--border)",
      background: active ? "var(--accent)" : "var(--surface)",
      color: active ? "var(--plane)" : "var(--ink-2)",
    }) as React.CSSProperties;

  return (
    <div className="mt-3.5 flex flex-wrap gap-2">
      <button
        onClick={() => onChange("ALL")}
        className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors"
        style={chip(value === "ALL")}
      >
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: "linear-gradient(135deg,var(--blinkit),var(--zepto))" }}
        />
        All platforms
      </button>

      {PLATFORMS.map((p) => (
        <button
          key={p.slug}
          onClick={() => onChange(p.slug)}
          className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors"
          style={chip(value === p.slug)}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
          {p.name}
        </button>
      ))}
    </div>
  );
}
