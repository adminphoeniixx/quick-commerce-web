"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, ApiError } from "@/lib/client/api";
import { AuthCard, Field, SubmitButton, Alert, AuthLink } from "@/components/auth/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: "", email: "", password: "", organizationName: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await apiPost("/api/auth/register", form);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start tracking your quick-commerce performance."
      footer={<>Already have an account? <AuthLink href="/login">Sign in</AuthLink></>}
    >
      <form onSubmit={onSubmit}>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label="Full name" value={form.fullName} onChange={set("fullName")} autoComplete="name" />
        <Field label="Work email" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
        <Field label="Password" type="password" required value={form.password} onChange={set("password")} autoComplete="new-password" />
        <Field label="Organization name" required value={form.organizationName} onChange={set("organizationName")} />
        <p className="mb-4 text-[11px]" style={{ color: "var(--muted)" }}>
          Min 10 characters with upper, lower and a number.
        </p>
        <SubmitButton loading={loading}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
