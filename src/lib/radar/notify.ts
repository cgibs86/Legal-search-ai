import "server-only";
import { Resend } from "resend";
import { getEnv } from "@/lib/config/env";
import { log, errorMessage } from "@/lib/log";

/**
 * Alert delivery. Email via Resend when configured; in-app alerts are always written to
 * the alerts table. The channel interface leaves room for SMS/push later.
 */
export interface AlertMessage {
  title: string;
  summary: string;
  link: string | null;
}

export interface Channel {
  id: "email" | "in_app" | "sms" | "push";
  send(to: string, subject: string, alerts: AlertMessage[]): Promise<boolean>;
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function renderEmail(subject: string, alerts: AlertMessage[], siteUrl: string): { html: string; text: string } {
  const items = alerts
    .map(
      (a) =>
        `<tr><td style="padding:14px 0;border-bottom:1px solid #e5e7eb"><div style="font-weight:600;color:#0b0f19">${escape(a.title)}</div><div style="color:#4b5563;margin-top:4px">${escape(a.summary)}</div>${a.link ? `<a href="${escape(a.link)}" style="color:#4f46e5;display:inline-block;margin-top:6px">Open in Legal Search AI →</a>` : ""}</td></tr>`,
    )
    .join("");
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px"><table width="100%" style="max-width:600px;margin:auto;background:#fff;border-radius:12px;padding:24px"><tr><td><div style="font-size:12px;letter-spacing:.12em;color:#6366f1;font-weight:700">CASE RADAR</div><h1 style="font-size:20px;color:#0b0f19;margin:6px 0 12px">${escape(subject)}</h1></td></tr>${items}<tr><td style="padding-top:18px;color:#6b7280;font-size:12px">Court records can contain people with identical names and filings contain allegations, not proven facts. Manage alerts at ${escape(siteUrl)}/app/radar.</td></tr></table></body></html>`;
  const text = `${subject}\n\n${alerts.map((a) => `• ${a.title}\n  ${a.summary}${a.link ? `\n  ${a.link}` : ""}`).join("\n\n")}\n\nManage alerts: ${siteUrl}/app/radar`;
  return { html, text };
}

export const emailChannel: Channel = {
  id: "email",
  async send(to, subject, alerts) {
    const env = getEnv();
    if (!env.RESEND_API_KEY || !env.ALERTS_FROM_EMAIL) return false;
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      const { html, text } = renderEmail(subject, alerts, env.NEXT_PUBLIC_SITE_URL);
      const { error } = await resend.emails.send({ from: env.ALERTS_FROM_EMAIL, to, subject, html, text });
      if (error) {
        log.warn("alerts.email_failed", { error: error.message });
        return false;
      }
      return true;
    } catch (e) {
      log.warn("alerts.email_exception", { error: errorMessage(e) });
      return false;
    }
  },
};
