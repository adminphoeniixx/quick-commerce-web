"use client";
// Live sync progress: current activity, per-report steps, elapsed time + estimate,
// and a live view of the sync browser while it works.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { apiGet } from "@/lib/client/api";

interface Progress {
  phase: "queued" | "downloading" | "saving" | "done" | "failed";
  activity: string; etaSeconds: number | null; elapsedSeconds: number;
  steps: { label: string; status: "pending" | "running" | "ok" | "failed"; error?: string; seconds: number | null }[];
  reports: { label: string; status: string; rows: number; error: string | null }[];
  totals: { kind: "seller"; products: number; orderLines: number } | { kind: "ads"; campaigns: number; campaignDays: number; keywordRows: number }
    | { kind: "seo"; products: number; searchResults: number; searchFailed: boolean } | null;
  liveView: boolean;
}

const dur = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
const PHASE = { queued: "Starting", downloading: "Downloading from Blinkit", saving: "Saving to QCP", done: "Completed", failed: "Failed" };

function StepIcon({ status }: { status: string }) {
  if (status === "ok") return <CheckCircle2 size={15} style={{ color: "var(--good, #1a7f37)" }} />;
  if (status === "failed") return <XCircle size={15} style={{ color: "var(--crit)" }} />;
  if (status === "running") return <Loader2 size={15} className="animate-spin" style={{ color: "var(--accent)" }} />;
  return <Circle size={15} style={{ color: "var(--axis)" }} />;
}

export default function SyncProgress({ connectionId, since, onFinished }: { connectionId: string; since?: number; onFinished?: (ok: boolean) => void }) {
  const [p, setP] = useState<Progress | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const finished = useRef(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const base = `/api/connections/${connectionId}/sync`;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const next = await apiGet<Progress>(`${base}/progress${since ? `?since=${since}` : ""}`).catch(() => null);
      if (!alive) return;
      if (next) {
        setP(next);
        if ((next.phase === "done" || next.phase === "failed") && !finished.current) { finished.current = true; onFinishedRef.current?.(next.phase === "done"); }
      }
      if (alive && !finished.current) setTimeout(load, 2000);
    };
    load();
    return () => { alive = false; };
  }, [base, since]);

  // Smooth the clock between polls.
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { setTick(0); }, [p]);

  useEffect(() => {
    if (!p?.liveView) return;
    let alive = true, url: string | null = null;
    const pull = async () => {
      const res = await fetch(`${base}/frame`, { credentials: "same-origin", cache: "no-store" }).catch(() => null);
      if (alive && res?.status === 200) {
        const next = URL.createObjectURL(await res.blob());
        setFrame(next); if (url) URL.revokeObjectURL(url); url = next;
      }
      if (alive) setTimeout(pull, 1500);
    };
    pull();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [base, p?.liveView]);

  if (!p) return <div className="flex items-center gap-2 p-6 text-sm" style={{ color: "var(--muted)" }}><Loader2 size={15} className="animate-spin" />Starting sync…</div>;

  const running = p.phase === "queued" || p.phase === "downloading" || p.phase === "saving";
  const total = p.steps.length + 1; // +1 for saving into QCP
  const doneCount = p.steps.filter((s) => s.status === "ok" || s.status === "failed").length + (p.phase === "done" || p.phase === "failed" ? 1 : 0);
  const pct = p.phase === "done" ? 100 : p.steps.length ? Math.round((doneCount / total) * 100) : 3;
  const elapsed = p.elapsedSeconds + (running ? tick : 0);
  const eta = p.etaSeconds != null && running ? Math.max(0, p.etaSeconds - tick) : null;
  const list = p.steps.length ? p.steps : p.reports.map((r) => ({ label: r.label, status: r.status === "SUCCESS" ? "ok" as const : "failed" as const, error: r.error ?? undefined, seconds: null }));

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_380px]">
      <div>
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: p.phase === "failed" ? "var(--crit)" : p.phase === "done" ? "var(--good, #1a7f37)" : "var(--accent)", color: "#fff" }}>{PHASE[p.phase]}</span>
          <span className="text-[13px] font-semibold">{p.activity}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: p.phase === "failed" ? "var(--crit)" : "var(--accent)" }} />
        </div>
        <p className="tnum mt-1.5 text-[12px]" style={{ color: "var(--muted)" }}>
          {pct}% · elapsed {dur(elapsed)}{eta != null ? ` · about ${dur(eta)} left` : ""}{running && p.steps.length ? ` · ${doneCount} of ${total} steps` : ""}
        </p>
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {list.map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5"><StepIcon status={s.status} /></span>
              <span className="mr-auto">{s.label}{s.status === "failed" && s.error && <span className="block text-[11px]" style={{ color: "var(--muted)" }}>{s.error}</span>}</span>
              {s.seconds != null && s.status !== "pending" && <span className="tnum text-[11px]" style={{ color: "var(--muted)" }}>{dur(s.seconds)}</span>}
            </li>
          ))}
          {p.steps.length > 0 && (
            <li className="flex items-start gap-2">
              <span className="mt-0.5"><StepIcon status={p.phase === "saving" ? "running" : p.phase === "done" ? "ok" : p.phase === "failed" ? "failed" : "pending"} /></span>
              <span>{p.steps.some((s) => s.label.toLowerCase().includes("campaign")) ? "Save ad campaigns, performance & keywords into QCP"
                : p.steps.every((s) => /listing seo|blinkit\.com search/i.test(s.label)) ? "Save SEO data into QCP" : "Save sales, orders & products into QCP"}</span>
            </li>
          )}
        </ul>
        {p.phase === "done" && p.totals?.kind === "ads" && (
          <div className="mt-4 rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--border)" }}>
            QCP now has <b>{p.totals.campaigns}</b> Blinkit Ads campaigns, <b>{p.totals.campaignDays.toLocaleString("en-IN")}</b> campaign-days of performance and <b>{p.totals.keywordRows.toLocaleString("en-IN")}</b> keyword rows.
            <div className="mt-2 flex flex-wrap gap-3 text-[12px] font-semibold">
              <Link href="/dashboard/ads" style={{ color: "var(--accent)" }}>Open Blinkit Ads →</Link>
              <Link href="/dashboard/ads/campaigns" style={{ color: "var(--accent)" }}>Campaigns →</Link>
              <Link href="/dashboard/ads/keywords" style={{ color: "var(--accent)" }}>Keywords →</Link>
            </div>
          </div>
        )}
        {p.phase === "done" && p.totals?.kind === "seo" && (
          <div className="mt-4 rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--border)" }}>
            Updated listing SEO for <b>{p.totals.products}</b> products{p.totals.searchResults > 0 && <> and <b>{p.totals.searchResults.toLocaleString("en-IN")}</b> blinkit.com search results</>}.
            {p.totals.searchFailed && <span style={{ color: "var(--crit)" }}> The blinkit.com search step failed: see the step above, and don't retry it today.</span>}
            <div className="mt-2 flex flex-wrap gap-3 text-[12px] font-semibold">
              <Link href="/dashboard/keywords" style={{ color: "var(--accent)" }}>Keyword intelligence →</Link>
            </div>
          </div>
        )}
        {p.phase === "done" && p.totals?.kind === "seller" && (
          <div className="mt-4 rounded-lg border p-3 text-[13px]" style={{ borderColor: "var(--border)" }}>
            QCP now has <b>{p.totals.orderLines.toLocaleString("en-IN")}</b> Blinkit order lines and <b>{p.totals.products}</b> products.
            <div className="mt-2 flex flex-wrap gap-3 text-[12px] font-semibold">
              <Link href="/dashboard/seller/sales" style={{ color: "var(--accent)" }}>Open sales analysis →</Link>
              <Link href="/dashboard/seller/orders" style={{ color: "var(--accent)" }}>Orders →</Link>
              <Link href="/dashboard/seller/products" style={{ color: "var(--accent)" }}>Products →</Link>
              <Link href="/dashboard/seller/reports" style={{ color: "var(--accent)" }}>Synced reports →</Link>
            </div>
          </div>
        )}
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Live view of the sync browser</p>
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)", aspectRatio: "1280/800", background: "var(--surface-2)" }}>
          {frame && p.liveView ? <img src={frame} alt="What the sync browser is doing" className="h-full w-full" />
            : <div className="flex h-full items-center justify-center p-4 text-center text-[12px]" style={{ color: "var(--muted)" }}>{running ? "Waiting for the browser…" : "Browser closed. Sync finished."}</div>}
        </div>
      </div>
    </div>
  );
}
