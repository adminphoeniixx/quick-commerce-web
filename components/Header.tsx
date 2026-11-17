"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Calendar, Download, LogOut, Users, ShieldCheck, ChevronDown, Check, UploadCloud, Crown } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

// Section name shown in the top bar, from the current route (longest prefix wins).
const SECTIONS: [string, string][] = [
  ["/dashboard/seller", "Blinkit seller data"], ["/dashboard/products", "Product catalog"],
  ["/dashboard/availability", "Availability"], ["/dashboard/pricing", "Pricing"],
  ["/dashboard/visibility", "Share of voice"], ["/dashboard/keywords", "Keywords"],
  ["/dashboard/reports", "Reports & exports"], ["/dashboard/connections", "Connections"],
  ["/dashboard/imports", "Import center"], ["/dashboard/team", "Team"],
  ["/dashboard/settings", "Settings"], ["/dashboard", "Channel performance"],
];

export function Header() {
  const pathname = usePathname();
  const section = SECTIONS.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Quick Commerce Pulse";
  const { me, logout, switchOrg } = useAuth();
  const [menu, setMenu] = useState(false);
  const [orgMenu, setOrgMenu] = useState(false);

  const activeOrg = me?.organizations.find((o) => o.id === me?.activeOrgId);
  const initial = (me?.user.fullName || me?.user.email || "?").charAt(0).toUpperCase();

  return (
    <header
      className="sticky top-0 z-20 border-b px-6 py-3 backdrop-blur"
      style={{ borderColor: "var(--border)", background: "color-mix(in srgb,var(--plane) 88%,transparent)" }}
    >
      <div className="flex flex-wrap items-center gap-3.5">
        {/* org switcher */}
        <div className="relative">
          <button onClick={() => setOrgMenu((v) => !v)}
            className="flex items-center gap-2.5 rounded-full border px-3 py-1.5"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="grid h-6 w-6 place-items-center rounded-[7px] text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg,#6250d6,#eb6834)" }}>
              {(activeOrg?.name ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="leading-tight text-left">
              <div className="text-[13px] font-semibold">{activeOrg?.name ?? "No organization"}</div>
              <div className="text-[11px]" style={{ color: "var(--muted)" }}>{activeOrg?.role ?? "—"}</div>
            </div>
            <ChevronDown size={14} style={{ color: "var(--muted)" }} />
          </button>
          {orgMenu && me && (
            <div className="absolute left-0 top-full z-30 mt-1 w-60 rounded-[10px] border p-1 shadow-lg"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <div className="px-2 py-1 text-[11px] uppercase tracking-wider" style={{ color: "var(--muted)" }}>Organizations</div>
              {me.organizations.map((o) => (
                <button key={o.id} onClick={() => { switchOrg(o.id); setOrgMenu(false); }}
                  className="flex w-full items-center justify-between rounded-[7px] px-2 py-1.5 text-[13px] hover:brightness-95"
                  style={{ background: o.id === me.activeOrgId ? "var(--surface-2)" : "transparent" }}>
                  <span className="truncate">{o.name}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px]" style={{ color: "var(--muted)" }}>{o.role}</span>
                    {o.id === me.activeOrgId && <Check size={13} style={{ color: "var(--good)" }} />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>Quick Commerce Pulse</div>
          <div className="mt-0.5 text-[15px] font-semibold tracking-tight">{section}</div>
        </div>

        <div className="flex-1" />

        <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold"
          style={{ borderColor: me?.user.isSuperAdmin ? "#6250d6" : "var(--border)", color: me?.user.isSuperAdmin ? "#6250d6" : "var(--ink-2)", background: "var(--surface)" }}>
          {me?.user.isSuperAdmin ? <Crown size={14} /> : <Users size={14} />}
          {me?.user.isSuperAdmin ? "Platform Admin" : `${activeOrg?.role === "OWNER" ? "Seller Owner" : activeOrg?.role ?? "Seller"}`}
        </span>

        {!me?.user.emailVerified && (
          <Link href="/dashboard/settings/security" className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium"
            style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
            Verify email
          </Link>
        )}
        <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px]"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <Calendar size={15} style={{ color: "var(--muted)" }} /> Last 30 days
        </span>
        <Link href="/api/analytics/export?format=xlsx" aria-label="Download report" className="grid h-9 w-9 place-items-center rounded-[10px] border"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--ink-2)" }}>
          <Download size={17} />
        </Link>

        {/* user menu */}
        <div className="relative">
          <button onClick={() => setMenu((v) => !v)} aria-label="Account"
            className="grid h-9 w-9 place-items-center rounded-full text-[13px] font-bold text-white"
            style={{ background: "linear-gradient(135deg,#1baf7a,#6250d6)" }}>
            {initial}
          </button>
          {menu && me && (
            <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-[10px] border p-1 shadow-lg"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <div className="px-2 py-1.5">
                <div className="truncate text-[13px] font-semibold">{me.user.fullName ?? "Account"}</div>
                <div className="truncate text-[11px]" style={{ color: "var(--muted)" }}>{me.user.email}</div>
              </div>
              <div className="my-1 h-px" style={{ background: "var(--border)" }} />
              {me.user.isSuperAdmin && (
                <Link href="/admin" className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] font-semibold hover:brightness-95" style={{ color: "#6250d6" }}>
                  <Crown size={15} /> Admin portal
                </Link>
              )}
              <Link href="/dashboard/imports" className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] hover:brightness-95">
                <UploadCloud size={15} /> Data import
              </Link>
              <Link href="/dashboard/team" className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] hover:brightness-95">
                <Users size={15} /> Team
              </Link>
              <Link href="/dashboard/settings/security" className="flex items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] hover:brightness-95">
                <ShieldCheck size={15} /> Security
              </Link>
              <button onClick={logout} className="flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-[13px] hover:brightness-95" style={{ color: "var(--crit)" }}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
