// Provider-independent email. Uses SMTP (nodemailer) when configured; in dev,
// logs a safe line (plus the action link so flows can be completed locally).
import nodemailer, { type Transporter } from "nodemailer";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";
let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const t = getTransport();
  if (!t) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${body}`);
    return;
  }
  await t.sendMail({ from: process.env.MAIL_FROM ?? "no-reply@example.com", to, subject, text: body });
}

export function verifyEmailLink(token: string): string {
  return `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
}
export function resetPasswordLink(token: string): string {
  return `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
}
