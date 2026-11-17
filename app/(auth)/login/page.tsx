"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/client/api";
import { AuthCard, Field, SubmitButton, Alert, AuthLink } from "@/components/auth/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const session = await apiPost<{ isSuperAdmin: boolean }>("/api/auth/login", { email, password });
      const requested = new URLSearchParams(window.location.search).get("next");
      const next = requested || (session.isSuperAdmin ? "/admin" : "/dashboard");
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to your quick-commerce analytics."
      footer={<>New here? <AuthLink href="/register">Create an account</AuthLink></>}
    >
      <form onSubmit={onSubmit}>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="mb-4 text-right text-[12px]"><AuthLink href="/forgot-password">Forgot password?</AuthLink></div>
        <SubmitButton loading={loading}>Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
