"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/client/api";
import { AuthCard, Field, SubmitButton, Alert, AuthLink } from "@/components/auth/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await apiPost("/api/auth/reset-password", { token, password });
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Set a new password" footer={<AuthLink href="/login">Back to sign in</AuthLink>}>
      {done ? (
        <Alert kind="success">Password updated. Redirecting to sign in…</Alert>
      ) : (
        <form onSubmit={onSubmit}>
          {error && <Alert kind="error">{error}</Alert>}
          {!token && <Alert kind="error">Missing or invalid reset link.</Alert>}
          <Field label="New password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          <SubmitButton loading={loading} disabled={!token}>Update password</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
