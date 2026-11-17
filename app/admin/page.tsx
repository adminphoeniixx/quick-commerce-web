"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, Cable, Crown, Database, LogOut, ShieldCheck, Users } from "lucide-react";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { apiGet } from "@/lib/client/api";

type Overview = {
  counts: { users: number; organizations: number; memberships: number; connections: number; imports: number };
  recentUsers: Array<{ id: string; email: string; fullName: string | null; isSuperAdmin: boolean; emailVerified: boolean; createdAt: string }>;
  recentOrganizations: Array<{ id: string; name: string; createdAt: string; _count: { memberships: number; connections: number } }>;
};

const cards = [
  ["Users", "users", Users], ["Organizations", "organizations", Building2], ["Memberships", "memberships", ShieldCheck],
  ["Connections", "connections", Cable], ["Imports", "imports", Database],
] as const;

function AdminPortal() {
  const { me, loading, logout } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!me) { router.replace("/login?next=/admin"); return; }
    if (!me.user.isSuperAdmin) { router.replace("/dashboard"); return; }
    apiGet<Overview>("/api/admin/overview").then(setData).catch((e) => setError(e.message || "Unable to load admin overview"));
  }, [loading, me, router]);

  if (loading || !me?.user.isSuperAdmin) return <div className="grid min-h-screen place-items-center" style={{ color: "var(--muted)" }}>Checking platform administrator access…</div>;

  return <div className="min-h-screen" style={{ background: "var(--plane)" }}>
    <header className="border-b px-6 py-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: "linear-gradient(135deg,#6250d6,#eb6834)" }}><Crown size={21}/></div>
        <div><div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6250d6" }}>Platform administration</div><h1 className="text-xl font-bold">Quick Commerce Control Center</h1></div>
        <div className="flex-1" />
        <span className="hidden text-sm sm:block" style={{ color: "var(--muted)" }}>{me.user.email}</span>
        <Link href="/dashboard" className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--border)" }}>Seller workspace</Link>
        <button onClick={logout} className="grid h-9 w-9 place-items-center rounded-lg border" style={{ borderColor: "var(--border)", color: "var(--crit)" }} aria-label="Sign out"><LogOut size={17}/></button>
      </div>
    </header>
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 rounded-xl border p-4" style={{ borderColor: "#6250d6", background: "color-mix(in srgb,#6250d6 8%,var(--surface))" }}>
        <div className="flex items-center gap-2 font-semibold"><Crown size={17}/> Signed in as Platform Super Admin</div>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>This portal manages the complete SaaS platform. Seller accounts never receive access to this page or its API.</p>
      </div>
      {error && <div className="mb-5 rounded-lg p-3 text-sm" style={{ background: "color-mix(in srgb,var(--crit) 10%,transparent)", color: "var(--crit)" }}>{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([label,key,Icon]) => <div key={key} className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}><Icon size={19} style={{ color: "#6250d6" }}/><div className="mt-4 text-3xl font-bold">{data?.counts[key] ?? "—"}</div><div className="text-sm" style={{ color: "var(--muted)" }}>{label}</div></div>)}</div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}><h2 className="mb-4 font-bold">Recent users</h2><div className="space-y-2">{data?.recentUsers.map(u => <div key={u.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)" }}><div className="min-w-0 flex-1"><div className="truncate font-medium">{u.fullName || u.email}</div><div className="truncate text-xs" style={{ color: "var(--muted)" }}>{u.email}</div></div><span className="rounded-full px-2 py-1 text-xs" style={{ background: u.isSuperAdmin ? "#6250d620" : "var(--surface-2)", color: u.isSuperAdmin ? "#6250d6" : "var(--muted)" }}>{u.isSuperAdmin ? "ADMIN" : "SELLER"}</span></div>)}</div></section>
        <section className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}><h2 className="mb-4 font-bold">Recent organizations</h2><div className="space-y-2">{data?.recentOrganizations.map(o => <div key={o.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}><div className="font-medium">{o.name}</div><div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{o._count.memberships} members · {o._count.connections} connections</div></div>)}</div></section>
      </div>
    </main>
  </div>;
}

export default function AdminPage() { return <AuthProvider><AdminPortal/></AuthProvider>; }
