"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost, apiGet, ApiError } from "@/lib/client/api";
import { AuthCard, SubmitButton, Alert, AuthLink } from "@/components/auth/ui";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") || "");
    apiGet("/api/auth/me").then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);

  async function accept() {
    setError(""); setLoading(true);
    try {
      await apiPost("/api/invitations/accept", { token });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept invitation");
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Accept invitation"
      subtitle="Join the organization you were invited to."
      footer={<AuthLink href="/login">Sign in with a different account</AuthLink>}>
      {error && <Alert kind="error">{error}</Alert>}
      {!token && <Alert kind="error">Missing invitation token.</Alert>}
      {authed === false && (
        <Alert kind="error">Please sign in with the invited email first, then reopen this link.</Alert>
      )}
      <SubmitButton loading={loading} disabled={!token || authed !== true} onClick={accept}>
        Accept invitation
      </SubmitButton>
    </AuthCard>
  );
}
