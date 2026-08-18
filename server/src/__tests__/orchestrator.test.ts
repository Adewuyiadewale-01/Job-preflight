import { describe, expect, it } from "vitest";
import { executePreflightRun, createRunRecord } from "../orchestrator";
import { MemoryRepository, type StoredMailbox } from "../db";
import { MockAdapter, MOCK_PASS_HEADERS, type MailProviderAdapter, type MockScript } from "../adapters";
import { loadConfig } from "../config";
import type { Settings } from "../../../shared/types";

const settings: Settings = {
  timeoutSec: 30,
  requiredChecks: 2,
  requireAllConnected: true,
  promotionsAs: "review",
  updatesAs: "review",
  requireDkim: true,
  dmarcNoneAs: "review",
  attachmentMaxMb: 10,
  followUpBusinessDays: 5,
  allowlist: ["seed1@gmail.com", "seed2@outlook.com", "seed3@yahoo.com"],
};

const config = loadConfig({ TEST_RECIPIENT_ALLOWLIST: settings.allowlist.join(",") });

const pdf = Buffer.from("%PDF-1.4 resume-bytes");
const pdfSha = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const mailbox = (id: string, provider: "gmail" | "outlook" | "yahoo", address: string): StoredMailbox => ({
  id,
  provider,
  address,
  method: "oauth",
  status: "connected",
  tokenEnc: "enc.v1:x",
});

function buildDeps(scripts: Record<string, MockScript>) {
  const repo = new MemoryRepository();
  let now = 1_000_000;
  const adapters: Record<string, MockAdapter> = {};
  const deps = {
    repo,
    settings,
    send: async () => {
      Object.values(adapters).forEach((a) => a.markSent());
      now += 50;
      return { accepted: settings.allowlist, messageId: "mock-msg-1" };
    },
    adapterFor: (m: StoredMailbox): MailProviderAdapter | null => adapters[m.id] ?? null,
    sleep: async (ms: number) => {
      now += ms;
    },
    clock: () => now,
    pollIntervalMs: 500,
    timeoutMs: settings.timeoutSec * 1000,
  };
  for (const [id, script] of Object.entries(scripts)) adapters[id] = new MockAdapter("gmail", script, () => now);
  return { deps, repo };
}

const input = {
  employer: "Northwind",
  role: "Backend Engineer",
  subject: "Application — Backend Engineer",
  body: "Dear hiring team, my resume is attached.",
  attachments: [{ name: "resume.pdf", size: pdf.length, sha256: pdfSha }],
};

describe("live preflight orchestrator (mock adapters, fake clock)", () => {
  it("verdict SAFE: both seeds deliver to inbox, auth passes, attachments intact", async () => {
    const boxes = [mailbox("m1", "gmail", "seed1@gmail.com"), mailbox("m2", "outlook", "seed2@outlook.com")];
    const { deps, repo } = buildDeps({
      m1: { deliverAfterMs: 1500, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
      m2: { deliverAfterMs: 2500, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
    });
    const run = createRunRecord({ input, payloads: new Map(), mailboxes: boxes }, settings);
    const done = await executePreflightRun(run, { input, payloads: new Map(), mailboxes: boxes }, deps);
    expect(done.status).toBe("complete");
    expect(done.report?.verdict).toBe("safe");
    expect(done.seedResults.every((r) => r.outcome === "pass")).toBe(true);
    expect(repo.getRun(done.id)?.report?.verdict).toBe("safe"); // persisted progress
  });

  it("verdict BLOCK: one seed lands in spam", async () => {
    const boxes = [mailbox("m1", "gmail", "seed1@gmail.com"), mailbox("m2", "outlook", "seed2@outlook.com")];
    const { deps } = buildDeps({
      m1: { deliverAfterMs: 1000, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
      m2: { deliverAfterMs: 1000, folder: "spam", authHeaders: MOCK_PASS_HEADERS, attachments: [] },
    });
    const run = createRunRecord({ input, payloads: new Map(), mailboxes: boxes }, settings);
    const done = await executePreflightRun(run, { input, payloads: new Map(), mailboxes: boxes }, deps);
    expect(done.report?.verdict).toBe("block");
    expect(done.report?.reasons.some((r) => r.code === "SPAM_PLACEMENT")).toBe(true);
  });

  it("verdict BLOCK: message missing after the timeout", async () => {
    const boxes = [mailbox("m1", "gmail", "seed1@gmail.com"), mailbox("m2", "outlook", "seed2@outlook.com")];
    const { deps } = buildDeps({
      m1: { deliverAfterMs: 1000, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
      m2: { deliverAfterMs: null, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [] },
    });
    const run = createRunRecord({ input, payloads: new Map(), mailboxes: boxes }, settings);
    const done = await executePreflightRun(run, { input, payloads: new Map(), mailboxes: boxes }, deps);
    expect(done.report?.verdict).toBe("block");
    expect(done.report?.reasons.some((r) => r.code === "MSG_MISSING")).toBe(true);
  });

  it("verdict BLOCK: DKIM/DMARC failure parsed from received headers", async () => {
    const failHeaders =
      "Authentication-Results: mx.mock.local; spf=pass smtp.mailfrom=yourdomain.dev; dkim=fail header.i=@yourdomain.dev; dmarc=fail header.from=yourdomain.dev";
    const boxes = [mailbox("m1", "gmail", "seed1@gmail.com"), mailbox("m2", "outlook", "seed2@outlook.com")];
    const { deps } = buildDeps({
      m1: { deliverAfterMs: 800, folder: "inbox", authHeaders: failHeaders, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
      m2: { deliverAfterMs: 800, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
    });
    const run = createRunRecord({ input, payloads: new Map(), mailboxes: boxes }, settings);
    const done = await executePreflightRun(run, { input, payloads: new Map(), mailboxes: boxes }, deps);
    expect(done.report?.verdict).toBe("block");
    expect(done.report?.reasons.some((r) => r.code === "AUTH_FAIL")).toBe(true);
  });

  it("verdict BLOCK: attachment hash mismatch is detected", async () => {
    const boxes = [mailbox("m1", "gmail", "seed1@gmail.com"), mailbox("m2", "outlook", "seed2@outlook.com")];
    const { deps } = buildDeps({
      m1: { deliverAfterMs: 700, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length - 2, sha256: "deadbeef".repeat(8) }] },
      m2: { deliverAfterMs: 700, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
    });
    const run = createRunRecord({ input, payloads: new Map(), mailboxes: boxes }, settings);
    const done = await executePreflightRun(run, { input, payloads: new Map(), mailboxes: boxes }, deps);
    expect(done.report?.verdict).toBe("block");
    expect(done.report?.reasons.some((r) => r.code === "ATTACHMENT_MISMATCH")).toBe(true);
  });

  it("verdict REVIEW: promotions placement and an uncheckable provider", async () => {
    const boxes = [
      mailbox("m1", "gmail", "seed1@gmail.com"),
      mailbox("m2", "outlook", "seed2@outlook.com"),
      { ...mailbox("m3", "yahoo", "seed3@yahoo.com"), status: "disconnected" as const },
    ];
    const { deps } = buildDeps({
      m1: { deliverAfterMs: 600, folder: "promotions", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
      m2: { deliverAfterMs: 600, folder: "inbox", authHeaders: MOCK_PASS_HEADERS, attachments: [{ filename: "resume.pdf", size: pdf.length, sha256: pdfSha }] },
    });
    const run = createRunRecord({ input, payloads: new Map(), mailboxes: boxes }, settings);
    const done = await executePreflightRun(run, { input, payloads: new Map(), mailboxes: boxes }, deps);
    expect(done.report?.verdict).toBe("review");
    expect(done.report?.reasons.some((r) => r.code === "NON_PRIMARY_PLACEMENT")).toBe(true);
    expect(done.report?.reasons.some((r) => r.code === "PROVIDER_UNCHECKABLE")).toBe(true);
  });

  it("blocks the whole run when the send gate rejects a recipient", async () => {
    const badSettings = { ...settings, allowlist: ["seed1@gmail.com"] };
    const boxes = [mailbox("m1", "gmail", "seed1@gmail.com"), mailbox("m2", "outlook", "seed2@outlook.com")];
    const repo = new MemoryRepository();
    const run = createRunRecord({ input, payloads: new Map(), mailboxes: boxes }, settings);
    const deps = {
      repo,
      settings,
      send: async () => {
        throw new Error("Recipients rejected by allowlist: seed2@outlook.com");
      },
      adapterFor: () => null,
      sleep: async () => undefined,
      clock: () => 1,
      pollIntervalMs: 1,
      timeoutMs: 1,
    };
    const done = await executePreflightRun(run, { input, payloads: new Map(), mailboxes: boxes }, deps);
    expect(done.report?.verdict).toBe("block");
    expect(done.report?.reasons[0].code).toBe("SEND_REFUSED");
    void badSettings;
  });
});
