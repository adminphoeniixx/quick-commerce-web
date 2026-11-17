"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { apiGet, apiPost, apiDelete, ApiError } from "@/lib/client/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Field, SubmitButton, Alert } from "@/components/auth/ui";
import { PageHeader } from "@/components/PageHeader";

interface Sess { id: string; createdAt: string; expiresAt: string; }

export default function SecurityPage() {
  const { me, logout } = useAuth();
  const [cur, setCur] = useState(""); const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ k: "error" | "success"; t: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<Sess[]>([]);

  const loadSessions = () => apiGet<{ sessions: Sess[] }>("/api/auth/sessions").then((d) => setSessions(d.sessions)).catch(() => {});
  useEffect(() => { loadSessions(); }, []);

  async function changePw(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setLoading(true);
    try {
      await apiPost("/api/auth/change-password", { currentPassword: cur, newPassword: next });
      setMsg({ k: "success", t: "Password changed. Other sessions were signed out." });
      setCur(""); setNext(""); loadSessions();
    } catch (err) {
      setMsg({ k: "error", t: err instanceof ApiError ? err.message : "Failed" });
    } finally { setLoading(false); }
  }

  async function revoke(id: string) { await apiDelete(`/api/auth/sessions?id=${id}`); loadSessions(); }

  return (
    <div className="max-w-[720px]">
      <PageHeader title="Security" subtitle={<>Signed in as {me?.user.email}. Change your password and manage active sessions.</>} />

      <section className="rounded-card border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="mb-4 text-[15px] font-semibold">Change password</h2>
        <form onSubmit={changePw}>
          {msg && <Alert kind={msg.k}>{msg.t}</Alert>}
          <Field label="Current password" type="password" required value={cur} onChange={(e) => setCur(e.target.value)} />
          <Field label="New password" type="password" required value={next} onChange={(e) => setNext(e.target.value)} />
          <SubmitButton loading={loading}>Update password</SubmitButton>
        </form>
      </section>

      <section className="mt-5 rounded-card border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Active sessions</h2>
          <button onClick={logout} className="text-[12px] font-semibold" style={{ color: "var(--crit)" }}>Sign out</button>
        </div>
        <div className="flex flex-col gap-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-[9px] border px-3 py-2 text-[13px]"
              style={{ borderColor: "var(--border)" }}>
              <span>Session #{s.id} · started {new Date(s.createdAt).toLocaleString()}</span>
              <button onClick={() => revoke(s.id)} className="text-[12px] font-semibold" style={{ color: "var(--crit)" }}>Revoke</button>
            </div>
          ))}
          {sessions.length === 0 && <p className="text-[13px]" style={{ color: "var(--muted)" }}>No active sessions.</p>}
        </div>
      </section>
    </div>
  );
}
