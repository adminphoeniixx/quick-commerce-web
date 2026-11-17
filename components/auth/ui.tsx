"use client";

import Link from "next/link";

export function AuthCard({ title, subtitle, children, footer }: {
  title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div
      className="w-full max-w-[400px] rounded-card border p-7"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="mb-6 flex items-center gap-2.5">
        <div className="grid h-9 w-9 place-items-center rounded-[10px] font-extrabold text-black"
          style={{ background: "linear-gradient(135deg,#eda100,#eb6834)" }}>Q</div>
        <span className="text-[15px] font-bold tracking-tight">Quick Commerce Pulse</span>
      </div>
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-[13px]" style={{ color: "var(--muted)" }}>{subtitle}</p>}
      <div className="mt-5">{children}</div>
      {footer && <div className="mt-5 text-center text-[13px]" style={{ color: "var(--muted)" }}>{footer}</div>}
    </div>
  );
}

export function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-3.5 block">
      <span className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--ink-2)" }}>{label}</span>
      <input
        {...props}
        className="w-full rounded-[9px] border px-3 py-2.5 text-[14px] outline-none transition-colors focus:border-[var(--accent)]"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--ink)" }}
      />
    </label>
  );
}

export function SubmitButton({ children, loading, ...props }: { loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="w-full rounded-[10px] px-4 py-2.5 text-[14px] font-semibold transition-opacity disabled:opacity-60"
      style={{ background: "var(--accent)", color: "var(--plane)" }}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

export function Alert({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  const c = kind === "error" ? "var(--crit)" : "var(--good)";
  return (
    <div className="mb-4 rounded-[9px] px-3 py-2.5 text-[13px]"
      style={{ background: `color-mix(in srgb, ${c} 12%, transparent)`, color: c }}>
      {children}
    </div>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="font-semibold" style={{ color: "var(--ink)" }}>{children}</Link>;
}
