import { describe, expect, it } from "vitest";
import { sendPreflightPackage, jsonTransportFactory } from "../smtp";
import { loadConfig } from "../config";
import { AllowlistError, TEST_ID_HEADER } from "../../../shared/strings";
import type { PreflightInput } from "../../../shared/types";

const config = loadConfig({
  ZOHO_SMTP_USER: "dev@example.com",
  ZOHO_SMTP_PASSWORD: "not-real",
  MAIL_FROM: "Dev <dev@example.com>",
  TEST_RECIPIENT_ALLOWLIST: "seed1@gmail.com, seed2@outlook.com",
  APP_ENCRYPTION_KEY: "x".repeat(40),
});

const input: PreflightInput = {
  employer: "Northwind",
  role: "Backend Engineer",
  subject: "Application — Backend Engineer",
  body: "Dear hiring team, please find my resume attached.",
  attachments: [{ name: "resume.pdf", size: 12, sha256: "ab".repeat(32) }],
};
const payloads = new Map([["resume.pdf", Buffer.from("%PDF-1.4 test")]]);

describe("Zoho SMTP sender", () => {
  it("sends only to allowlisted seed recipients with TEST prefix and test-id header", async () => {
    const res = await sendPreflightPackage(
      { config, makeTransport: jsonTransportFactory() },
      { input, testId: "PFT-UNIT-0001", recipients: ["seed1@gmail.com"], payloads }
    );
    expect(res.accepted).toContain("seed1@gmail.com");

    // jsonTransport returns the message JSON as `message` on accepted entries;
    // re-send through a capture transport to assert the envelope directly.
    let captured: Record<string, unknown> | null = null;
    const capture = jsonTransportFactory()(config);
    capture.sendMail = async (mail: Record<string, unknown>) => {
      captured = mail;
      return { accepted: ["seed1@gmail.com"], rejected: [], messageId: "m1" } as never;
    };
    await sendPreflightPackage(
      { config, makeTransport: () => capture },
      { input, testId: "PFT-UNIT-0001", recipients: ["seed1@gmail.com"], payloads }
    );
    expect(captured).toBeTruthy();
    expect(captured!.subject).toBe("[TEST PFT-UNIT-0001] Application — Backend Engineer");
    expect((captured!.headers as Record<string, string>)[TEST_ID_HEADER]).toBe("PFT-UNIT-0001");
    expect(captured!.text).toBe(input.body); // verbatim body — no rewriting/tracking
  });

  it("throws AllowlistError before touching the transport for a non-allowlisted address", async () => {
    let transportCreated = false;
    await expect(
      sendPreflightPackage(
        {
          config,
          makeTransport: () => {
            transportCreated = true;
            return jsonTransportFactory()(config);
          },
        },
        { input, testId: "PFT-UNIT-0002", recipients: ["hr@employer.com"], payloads }
      )
    ).rejects.toBeInstanceOf(AllowlistError);
    expect(transportCreated).toBe(false);
  });

  it("rejects a mixed recipient list outright — nothing is partially sent", async () => {
    await expect(
      sendPreflightPackage(
        { config, makeTransport: jsonTransportFactory() },
        { input, testId: "PFT-UNIT-0003", recipients: ["seed1@gmail.com", "boss@employer.com"], payloads }
      )
    ).rejects.toThrow(/boss@employer\.com/);
  });

  it("refuses a partial attachment payload set", async () => {
    await expect(
      sendPreflightPackage(
        { config, makeTransport: jsonTransportFactory() },
        { input, testId: "PFT-UNIT-0004", recipients: ["seed1@gmail.com"], payloads: new Map() }
      )
    ).rejects.toThrow(/Missing payload/);
  });
});
