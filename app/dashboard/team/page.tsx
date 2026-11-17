"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from "@/lib/client/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { Field, SubmitButton, Alert } from "@/components/auth/ui";
import { PageHeader } from "@/components/PageHeader";

const ROLES = ["OWNER", "ORG_ADMIN", "ANALYST", "VIEWER"];
interface Member { role: string; user: { id: string; email: string; fullName: string | null }; }
interface Invite { id: string; email: string; role: string; expiresAt: string; }

export default function TeamPage() {
  const { me, can } = useAuth();
  const orgId = me?.activeOrgId;
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState(""); const [role, setRole] = useState("VIEWER");
  const [msg, setMsg] = useState<{ k: "error" | "success"; t: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const d = await apiGet<{ members: Member[]; invitations: Invite[] }>(`/api/orgs/${orgId}/members`);
      setMembers(d.members); setInvites(d.invitations);
    } catch (err) { setMsg({ k: "error", t: err instanceof ApiError ? err.message : "Failed to load" }); }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setLoading(true);
    try {
      await apiPost(`/api/orgs/${orgId}/members`, { email, role });
      setMsg({ k: "success", t: `Invitation sent to ${email}` }); setEmail(""); load();
    } catch (err) { setMsg({ k: "error", t: err instanceof ApiError ? err.message : "Failed" }); }
    finally { setLoading(false); }
  }

  async function changeRole(userId: string, newRole: string) {
    try { await apiPatch(`/api/orgs/${orgId}/members/${userId}`, { role: newRole }); load(); }
    catch (err) { setMsg({ k: "error", t: err instanceof ApiError ? err.message : "Failed" }); }
  }
  async function remove(userId: string) {
    try { await apiDelete(`/api/orgs/${orgId}/members/${userId}`); load(); }
    catch (err) { setMsg({ k: "error", t: err instanceof ApiError ? err.message : "Failed" }); }
  }

  const canManage = can("member:create");

  return (
    <div className="max-w-[860px]">
      <PageHeader title="Team" subtitle="Members of your active organization." />
      {msg && <div className="mt-4"><Alert kind={msg.k}>{msg.t}</Alert></div>}

      {canManage && (
        <section className="mt-6 rounded-card border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h2 className="mb-4 text-[15px] font-semibold">Invite a member</h2>
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1"><Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <label className="mb-3.5">
              <span className="mb-1.5 block text-[12px] font-medium" style={{ color: "var(--ink-2)" }}>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}
                className="rounded-[9px] border px-3 py-2.5 text-[14px]" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--ink)" }}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <div className="mb-3.5 w-[120px]"><SubmitButton loading={loading}>Invite</SubmitButton></div>
          </form>
        </section>
      )}

      <section className="mt-5 overflow-hidden rounded-card border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <table className="w-full border-collapse text-[13px]">
          <thead><tr>
            {["Member", "Role", ""].map((h) => (
              <th key={h} className="border-b px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--muted)", borderColor: "var(--border)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user.id}>
                <td className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                  <div className="font-semibold">{m.user.fullName ?? m.user.email}</div>
                  <div className="text-[11px]" style={{ color: "var(--muted)" }}>{m.user.email}</div>
                </td>
                <td className="border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                  {canManage ? (
                    <select value={m.role} onChange={(e) => changeRole(m.user.id, e.target.value)}
                      className="rounded-[7px] border px-2 py-1 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--ink)" }}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : <span>{m.role}</span>}
                </td>
                <td className="border-b px-4 py-3 text-right" style={{ borderColor: "var(--border)" }}>
                  {canManage && m.user.id !== me?.user.id && (
                    <button onClick={() => remove(m.user.id)} className="text-[12px] font-semibold" style={{ color: "var(--crit)" }}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {invites.length > 0 && (
        <section className="mt-5 rounded-card border p-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <h2 className="mb-3 text-[15px] font-semibold">Pending invitations</h2>
          {invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between py-1 text-[13px]">
              <span>{i.email}</span><span style={{ color: "var(--muted)" }}>{i.role}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
