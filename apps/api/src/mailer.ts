// Optional email delivery. Enabled only when SMTP_URL is set — otherwise every
// send is a logged no-op, so scheduled reports still generate and persist; only
// delivery is skipped. Mirrors the OPENAI_API_KEY / STRIPE_SECRET_KEY opt-in pattern.

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env.js";

export function isEmailEnabled(): boolean {
  return env.smtpUrl.length > 0;
}

let transporter: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!isEmailEnabled()) return null;
  if (!transporter) transporter = nodemailer.createTransport(env.smtpUrl);
  return transporter;
}

export interface MailAttachment { filename: string; content: Buffer; contentType?: string; }

// Send an email. Returns true if delivered, false if email is disabled (no-op).
// Throws only on a real SMTP failure, so callers can record it against the job.
export async function sendMail(opts: { to: string[]; subject: string; text: string; attachments?: MailAttachment[] }): Promise<boolean> {
  const t = getTransport();
  if (!t || !opts.to.length) return false;
  await t.sendMail({ from: env.reportFrom, to: opts.to.join(", "), subject: opts.subject, text: opts.text, attachments: opts.attachments });
  return true;
}
