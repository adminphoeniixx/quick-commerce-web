"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/client/api";

export interface Org { id: string; name: string; role: string; }
export interface Me {
  user: { id: string; email: string; fullName: string | null; emailVerified: boolean; isSuperAdmin: boolean };
  activeOrgId: string | null;
  organizations: Org[];
  permissions: string[];
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const reload = useCallback(async () => {
    try {
      setMe(await apiGet<Me>("/api/auth/me"));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const logout = useCallback(async () => {
    try { await apiPost("/api/auth/logout"); } catch {}
    setMe(null);
    router.push("/login");
  }, [router]);

  const switchOrg = useCallback(async (orgId: string) => {
    await apiPost("/api/orgs/switch", { orgId });
    await reload();
  }, [reload]);

  const can = useCallback((permission: string) => !!me?.permissions.includes(permission), [me]);

  return (
    <Ctx.Provider value={{ me, loading, reload, logout, switchOrg, can }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
