import "server-only";
import { env } from "../env";

export type Mail = { to: string[]; cc: string[]; subject: string; text: string };
export type SendResult = { status: "sent" | "sandboxed" | "failed"; providerId?: string; error?: string; deliveredTo: string[]; deliveredCc: string[] };

/**
 * Email adapter (A2 Resend; OQ-S-07). A3: in staging every message is redirected to EMAIL_SANDBOX_TO so
 * real borrowers never receive test mail; the intended recipients are kept in notifications_log.
 */
export async function sendMail(m: Mail): Promise<SendResult> {
  const sandbox = !env.isProductionEnv ? env.emailSandboxTo : null;
  const to = sandbox ? [sandbox] : m.to;
  const cc = sandbox ? [] : m.cc;
  const subject = sandbox ? `[${env.appEnv}] ${m.subject}` : m.subject;
  const text = sandbox ? `Intended for: ${m.to.join(", ")}${m.cc.length ? ` (cc ${m.cc.join(", ")})` : ""}\n\n${m.text}` : m.text;
  if (!to.length) return { status: "failed", error: "no recipients", deliveredTo: [], deliveredCc: [] };
  if (env.emailProvider === "outbox") return { status: "sandboxed", deliveredTo: to, deliveredCc: cc };
  const key = process.env.RESEND_API_KEY;
  if (!key) return { status: "failed", error: "RESEND_API_KEY not set", deliveredTo: to, deliveredCc: cc };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.emailFrom, to, cc: cc.length ? cc : undefined, subject, text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { status: "failed", error: `Resend ${r.status}: ${JSON.stringify(j).slice(0, 300)}`, deliveredTo: to, deliveredCc: cc };
    return { status: sandbox ? "sandboxed" : "sent", providerId: j.id, deliveredTo: to, deliveredCc: cc };
  } catch (e) {
    return { status: "failed", error: (e as Error).message, deliveredTo: to, deliveredCc: cc };
  }
}

/** Phase 2 Slack (NTF-004/005/006/010/013) once the channel exists; disabled by default. */
export async function sendSlack(text: string): Promise<SendResult> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { status: "failed", error: "SLACK_WEBHOOK_URL not set", deliveredTo: [], deliveredCc: [] };
  if (!env.isProductionEnv && process.env.SLACK_ALLOW_NONPROD !== "1") return { status: "sandboxed", deliveredTo: ["#inventory (sandbox)"], deliveredCc: [] };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    return r.ok ? { status: "sent", deliveredTo: ["#inventory"], deliveredCc: [] } : { status: "failed", error: `Slack ${r.status}`, deliveredTo: [], deliveredCc: [] };
  } catch (e) {
    return { status: "failed", error: (e as Error).message, deliveredTo: [], deliveredCc: [] };
  }
}

/** Phase 3 WhatsApp through Graham Bell (NTF-015): roadmap; adapter intentionally not connected. */
export async function sendWhatsApp(): Promise<SendResult> {
  return { status: "failed", error: "WhatsApp is Phase 3 (roadmap) — not connected", deliveredTo: [], deliveredCc: [] };
}
