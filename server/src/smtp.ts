/**
 * Zoho Mail SMTP sender for preflight packages.
 *
 * Safety invariants (all enforced here, independent of the route layer):
 *  - every recipient must pass the strict allowlist gate, or the send throws
 *    before the transport is even created;
 *  - subjects carry the [TEST <id>] prefix and the X-Preflight-Test-Id header
 *    so seed messages are unambiguously identifiable;
 *  - no tracking pixels, link rewriting, open/click tracking — the body goes
 *    out byte-for-byte as the user wrote it.
 *
 * The transport is injected so tests run against nodemailer's jsonTransport
 * (no network, no credentials).
 */
import { createRequire } from "node:module";
import type { Transporter } from "nodemailer";
import type { PreflightInput } from "../../shared/types";
import { enforceAllowlist, seededSubject, TEST_ID_HEADER } from "../../shared/strings";
import type { ServerConfig } from "./config";

export interface SmtpDeps {
  config: ServerConfig;
  makeTransport: (cfg: ServerConfig) => Transporter;
}

export interface SendPreflightArgs {
  input: PreflightInput;
  testId: string;
  recipients: string[];
  /** PDF payloads referenced by the package (name must match input.attachments). */
  payloads: Map<string, Buffer>;
}

export interface SendResult {
  accepted: string[];
  messageId: string;
}

export async function sendPreflightPackage(deps: SmtpDeps, args: SendPreflightArgs): Promise<SendResult> {
  const { config } = deps;

  // Hard gate #1 — throws AllowlistError on ANY non-allowlisted address.
  const to = enforceAllowlist(args.recipients, config.testRecipientAllowlist);
  if (to.length === 0) throw new Error("No recipients — nothing to send.");

  const transport = deps.makeTransport(config);
  try {
    const info = await transport.sendMail({
      from: config.mailFrom,
      to: to.join(", "),
      subject: seededSubject(args.input.subject, args.testId),
      text: args.input.body,
      headers: {
        [TEST_ID_HEADER]: args.testId,
        "X-Mailer": "MailPreflight/0.1 (preflight test — not a real application)",
      },
      attachments: args.input.attachments.map((a) => {
        const content = args.payloads.get(a.name);
        if (!content) throw new Error(`Missing payload for attachment ${a.name} — refusing partial send.`);
        return { filename: a.name, content, contentType: "application/pdf" };
      }),
    });
    // nodemailer typings vary across versions (string[] vs (string|Address)[]
    // vs any) — normalize defensively to plain strings.
    const acceptedRaw: unknown = info?.accepted;
    const accepted = Array.isArray(acceptedRaw) ? acceptedRaw.map((x) => String(x)) : to;
    return { accepted, messageId: String(info?.messageId ?? "") };
  } finally {
    transport.close?.();
  }
}

/** Real Zoho SMTP transport factory (used only when live mode is active). */
export function zohoTransportFactory() {
  return async (cfg: ServerConfig): Promise<Transporter> => {
    const nodemailer = await import("nodemailer");
    return nodemailer.createTransport({
      host: cfg.zohoSmtpHost,
      port: cfg.zohoSmtpPort,
      secure: cfg.zohoSmtpPort === 465,
      auth: { user: cfg.zohoSmtpUser, pass: cfg.zohoSmtpPassword },
    });
  };
}

/** Test factory — captures mail as JSON, never touches a socket. */
export function jsonTransportFactory(): (cfg: ServerConfig) => Transporter {
  const req = createRequire(import.meta.url);
  const nodemailer = req("nodemailer") as typeof import("nodemailer");
  return () => nodemailer.createTransport({ jsonTransport: true });
}
