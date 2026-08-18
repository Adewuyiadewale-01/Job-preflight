import { describe, expect, it } from "vitest";
import type { AuthEvaluation, SeedResult, Settings } from "./types";
import {
  addBusinessDays,
  AllowlistError,
  enforceAllowlist,
  validateAttachment,
} from "./utils";
import {
  computeVerdict,
  evaluateAuth,
  evaluateSeed,
  parseAuthenticationResults,
} from "./verdict";

/* ---------------------------------------------------------------- */
/* fixtures                                                          */
/* ---------------------------------------------------------------- */

const settings = (over: Partial<Settings> = {}): Settings => ({
  timeoutSec: 24,
  requiredChecks: 2,
  requireAllConnected: false,
  promotionsAs: "review",
  updatesAs: "review",
  requireDkim: true,
  dmarcNoneAs: "review",
  attachmentMaxMb: 10,
  followUpBusinessDays: 5,
  allowlist: ["seed@gmail.com"],
  ...over,
});

const seed = (over: Partial<SeedResult> = {}): SeedResult => ({
  mailboxId: "m1",
  provider: "gmail",
  address: "seed@gmail.com",
  checkable: true,
  delivery: "received",
  folder: "inbox",
  latencySec: 3.1,
  auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
  attachments: [
    {
      name: "resume.pdf",
      expectedSize: 182_000,
      expectedSha: "ab12",
      found: true,
      sizeMatch: true,
      hashMatch: true,
    },
  ],
  steps: [],
  outcome: "pass",
  ...over,
});

const okAttachment = { name: "resume.pdf", size: 500_000, type: "application/pdf" };

/* ---------------------------------------------------------------- */
/* recipient allowlisting                                            */
/* ---------------------------------------------------------------- */

describe("recipient allowlisting", () => {
  it("accepts allowlisted recipients case-insensitively and normalizes them", () => {
    const out = enforceAllowlist(["Seed@Gmail.com "], ["seed@gmail.com"]);
    expect(out).toEqual(["seed@gmail.com"]);
  });

  it("rejects any non-allowlisted address, including employer addresses", () => {
    expect(() =>
      enforceAllowlist(["seed@gmail.com", "hiring@employer.com"], ["seed@gmail.com"])
    ).toThrow(AllowlistError);
    try {
      enforceAllowlist(["boss@employer.com"], ["seed@gmail.com"]);
    } catch (e) {
      expect((e as AllowlistError).rejected).toEqual(["boss@employer.com"]);
    }
  });

  it("rejects everything when the allowlist is empty", () => {
    expect(() => enforceAllowlist(["seed@gmail.com"], [])).toThrow(AllowlistError);
  });
});

/* ---------------------------------------------------------------- */
/* attachment validation                                             */
/* ---------------------------------------------------------------- */

describe("attachment validation", () => {
  it("accepts a PDF within the size limit", () => {
    expect(validateAttachment(okAttachment, settings()).ok).toBe(true);
  });

  it("accepts by MIME type even without the extension", () => {
    expect(validateAttachment({ ...okAttachment, name: "resume" }, settings()).ok).toBe(true);
  });

  it("rejects non-PDF files", () => {
    const res = validateAttachment({ name: "resume.docx", size: 100, type: "application/msword" }, settings());
    expect(res.ok).toBe(false);
    expect(res.errors.join(" ")).toMatch(/PDF/);
  });

  it("rejects double-extension tricks", () => {
    expect(
      validateAttachment({ name: "resume.pdf.exe", size: 100, type: "application/pdf" }, settings()).ok
    ).toBe(false);
  });

  it("rejects files above the configured limit", () => {
    const res = validateAttachment(
      { ...okAttachment, size: 11 * 1024 * 1024 },
      settings({ attachmentMaxMb: 10 })
    );
    expect(res.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* authentication-header parsing                                     */
/* ---------------------------------------------------------------- */

describe("authentication-header parsing", () => {
  const passHeader = [
    "Authentication-Results: mx.gmail.example;",
    "  spf=pass smtp.mailfrom=yourdomain.dev;",
    "  dkim=pass header.i=@yourdomain.dev;",
    "  dmarc=pass header.from=yourdomain.dev",
  ].join("\n");

  it("parses a fully passing header", () => {
    expect(parseAuthenticationResults(passHeader)).toEqual({
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
    });
  });

  it("parses dmarc=none and failure tokens", () => {
    const h = "Authentication-Results: mx; spf=pass; dkim=fail header.i=@x; dmarc=none";
    expect(parseAuthenticationResults(h)).toEqual({ spf: "pass", dkim: "fail", dmarc: "none" });
  });

  it("falls back to Received-SPF when Authentication-Results lacks spf", () => {
    const h = "Received-SPF: SoftFail (mx.example: transitioning sender)\nAuthentication-Results: mx; dkim=pass; dmarc=pass";
    expect(parseAuthenticationResults(h).spf).toBe("softfail");
  });

  it("reports unknown for missing mechanisms", () => {
    expect(parseAuthenticationResults("Authentication-Results: mx; spf=pass")).toMatchObject({
      dkim: "unknown",
      dmarc: "unknown",
    });
  });
});

/* ---------------------------------------------------------------- */
/* authentication evaluation rules                                   */
/* ---------------------------------------------------------------- */

describe("authentication evaluation", () => {
  it("passes when spf+dkim+dmarc all pass", () => {
    const { level } = evaluateAuth({ spf: "pass", dkim: "pass", dmarc: "pass" }, settings());
    expect(level).toBe("pass");
  });

  it("fails hard on any fail/softfail", () => {
    expect(evaluateAuth({ spf: "pass", dkim: "softfail", dmarc: "pass" }, settings()).level).toBe("fail");
    expect(evaluateAuth({ spf: "fail", dkim: "pass", dmarc: "pass" }, settings()).level).toBe("fail");
  });

  it("treats dmarc=none as incomplete by default, block when configured", () => {
    const auth: AuthEvaluation = { spf: "pass", dkim: "pass", dmarc: "none" };
    expect(evaluateAuth(auth, settings()).level).toBe("incomplete");
    expect(evaluateAuth(auth, settings({ dmarcNoneAs: "block" })).level).toBe("fail");
  });

  it("flags a missing DKIM result when DKIM is required", () => {
    const auth: AuthEvaluation = { spf: "pass", dkim: "unknown", dmarc: "pass" };
    expect(evaluateAuth(auth, settings()).level).toBe("incomplete");
    expect(evaluateAuth(auth, settings({ requireDkim: false })).level).toBe("pass");
  });
});

/* ---------------------------------------------------------------- */
/* mailbox-result handling                                           */
/* ---------------------------------------------------------------- */

describe("mailbox result handling", () => {
  it("passes a clean inbox delivery with intact attachments", () => {
    expect(evaluateSeed(seed(), settings()).outcome).toBe("pass");
  });

  it("fails spam placement, missing and bounced deliveries", () => {
    expect(evaluateSeed(seed({ folder: "spam" }), settings()).outcome).toBe("fail");
    expect(evaluateSeed(seed({ delivery: "missing", folder: null }), settings()).outcome).toBe("fail");
    expect(evaluateSeed(seed({ delivery: "bounced", folder: null }), settings()).outcome).toBe("fail");
  });

  it("fails attachment mismatches", () => {
    const corrupt = seed({
      attachments: [
        { name: "resume.pdf", expectedSize: 182_000, expectedSha: "ab12", found: true, sizeMatch: true, hashMatch: false },
      ],
    });
    expect(evaluateSeed(corrupt, settings()).outcome).toBe("fail");
  });

  it("warns on non-primary placement", () => {
    expect(evaluateSeed(seed({ folder: "promotions" }), settings()).outcome).toBe("warn");
  });

  it("skips uncheckable mailboxes", () => {
    expect(
      evaluateSeed(seed({ checkable: false, skipReason: "not connected" }), settings()).outcome
    ).toBe("skip");
  });
});

/* ---------------------------------------------------------------- */
/* combined verdict rules                                            */
/* ---------------------------------------------------------------- */

describe("combined verdict rules", () => {
  const twoPass = [seed(), seed({ mailboxId: "m2", provider: "outlook", address: "s2@outlook.com" })];

  it("returns safe when all required seeds pass cleanly", () => {
    const report = computeVerdict(twoPass, settings());
    expect(report.verdict).toBe("safe");
    expect(report.reasons).toHaveLength(0);
  });

  it("blocks when any seed lands in spam", () => {
    const report = computeVerdict(
      [seed(), seed({ mailboxId: "m2", folder: "spam" })],
      settings()
    );
    expect(report.verdict).toBe("block");
    expect(report.reasons.some((r) => r.code === "SPAM_PLACEMENT")).toBe(true);
  });

  it("blocks on missing, bounced and attachment failures", () => {
    expect(computeVerdict([seed({ delivery: "missing", folder: null })], settings()).verdict).toBe("block");
    expect(computeVerdict([seed({ delivery: "bounced", folder: null })], settings()).verdict).toBe("block");
    const corrupt = seed({
      attachments: [{ name: "r.pdf", expectedSize: 1, expectedSha: "x", found: true, sizeMatch: false, hashMatch: false }],
    });
    const report = computeVerdict([corrupt], settings());
    expect(report.verdict).toBe("block");
    expect(report.reasons.some((r) => r.code === "ATTACHMENT_MISMATCH")).toBe(true);
  });

  it("blocks on authentication failure", () => {
    const report = computeVerdict([seed({ auth: { spf: "pass", dkim: "fail", dmarc: "fail" } })], settings());
    expect(report.verdict).toBe("block");
    expect(report.reasons.some((r) => r.code === "AUTH_FAIL")).toBe(true);
  });

  it("reviews promotions placement by default, blocks when configured", () => {
    const promos = [seed(), seed({ mailboxId: "m2", folder: "promotions" })];
    expect(computeVerdict(promos, settings()).verdict).toBe("review");
    expect(computeVerdict(promos, settings({ promotionsAs: "block" })).verdict).toBe("block");
  });

  it("reviews when a provider cannot be checked", () => {
    const report = computeVerdict(
      [seed(), seed({ mailboxId: "m2", checkable: false, skipReason: "not connected" })],
      settings()
    );
    expect(report.verdict).toBe("review");
    expect(report.reasons.some((r) => r.code === "PROVIDER_UNCHECKABLE")).toBe(true);
  });

  it("reviews inconclusive evidence below the required-checks threshold", () => {
    const report = computeVerdict([seed()], settings({ requiredChecks: 2 }));
    expect(report.verdict).toBe("review");
    expect(report.reasons.some((r) => r.code === "EVIDENCE_INCONCLUSIVE")).toBe(true);
  });

  it("never reports safe without any checkable mailbox", () => {
    const report = computeVerdict(
      [seed({ checkable: false, skipReason: "x" })],
      settings({ requiredChecks: 1 })
    );
    expect(report.verdict).not.toBe("safe");
  });
});

/* ---------------------------------------------------------------- */
/* follow-up scheduling                                              */
/* ---------------------------------------------------------------- */

describe("follow-up scheduling", () => {
  it("adds business days, skipping weekends", () => {
    // 2026-03-06 is a Friday; +5 business days lands on Friday 2026-03-13
    expect(addBusinessDays("2026-03-06", 5)).toBe("2026-03-13");
  });
});
