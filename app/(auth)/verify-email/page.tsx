"use client";

import { useEffect, useState } from "react";
import { apiPost } from "@/lib/client/api";
import { AuthCard, Alert, AuthLink } from "@/components/auth/ui";

export default function VerifyEmailPage() {
  const [state, setState] = useState<"verifying" | "ok" | "fail">("verifying");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setState("fail"); return; }
    apiPost("/api/auth/verify-email", { token }).then(() => setState("ok")).catch(() => setState("fail"));
  }, []);

  return (
    <AuthCard title="Email verification" footer={<AuthLink href="/dashboard">Go to dashboard</AuthLink>}>
      {state === "verifying" && <p className="text-[13px]" style={{ color: "var(--muted)" }}>Verifying your email…</p>}
      {state === "ok" && <Alert kind="success">Your email is verified. Thank you!</Alert>}
      {state === "fail" && <Alert kind="error">This verification link is invalid or has expired.</Alert>}
    </AuthCard>
  );
}
