"use client";

import { useState } from "react";
import { apiPost } from "@/lib/client/api";
import { AuthCard, Field, SubmitButton, Alert, AuthLink } from "@/components/auth/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try { await apiPost("/api/auth/request-password-reset", { email }); } catch {}
    setDone(true); setLoading(false);
  }

  return (
    <AuthCard title="Reset password" subtitle="We'll email you a reset link."
      footer={<AuthLink href="/login">Back to sign in</AuthLink>}>
      {done ? (
        <Alert kind="success">If an account exists for that email, a reset link is on its way.</Alert>
      ) : (
        <form onSubmit={onSubmit}>
          <Field label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <SubmitButton loading={loading}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
