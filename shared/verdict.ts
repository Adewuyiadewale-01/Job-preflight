import type {
  AuthEvaluation,
  AuthResult,
  SeedResult,
  Settings,
  VerdictReason,
  VerdictReport,
} from "./types";

/* ------------------------------------------------------------------ */
/* Authentication-header parsing                                       */
/* ------------------------------------------------------------------ */

const TOKENS: Record<string, AuthResult> = {
  pass: "pass",
  fail: "fail",
  softfail: "softfail",
  none: "none",
  neutral: "neutral",
  temperror: "unknown",
  permerror: "unknown",
  unknown: "unknown",
};

function extract(header: string, key: string): AuthResult {
  const re = new RegExp(`${key}\\s*=\\s*([a-z]+)`, "i");
  const m = header.match(re);
  if (!m) return "unknown";
  return TOKENS[m[1].toLowerCase()] ?? "unknown";
}

/**
 * Parses an RFC 8601 `Authentication-Results` header (plus optional
 * `Received-SPF`) into a normalized SPF / DKIM / DMARC evaluation.
 * Shared verbatim by the demo console and the live backend.
 */
export function parseAuthenticationResults(header: string): AuthEvaluation {
  const spf = extract(header, "spf");
  const dkim = extract(header, "dkim");
  const dmarc = extract(header, "dmarc");
  if (spf === "unknown") {
    const rs = header.match(/Received-SPF:\s*([a-z]+)/i);
    if (rs && TOKENS[rs[1].toLowerCase()]) return { spf: TOKENS[rs[1].toLowerCase()], dkim, dmarc };
  }
  return { spf, dkim, dmarc };
}

export type AuthLevel = "pass" | "incomplete" | "fail";

export function evaluateAuth(
  auth: AuthEvaluation,
  settings: Settings
): { level: AuthLevel; issues: string[] } {
  const issues: string[] = [];
  const hardFail = (v: AuthResult) => v === "fail" || v === "softfail";

  if (hardFail(auth.spf)) issues.push(`SPF ${auth.spf}`);
  if (hardFail(auth.dkim)) issues.push(`DKIM ${auth.dkim}`);
  if (hardFail(auth.dmarc)) issues.push(`DMARC ${auth.dmarc}`);
  if (issues.length) return { level: "fail", issues };

  if (auth.dmarc === "none") {
    issues.push("DMARC none (no policy published)");
    return { level: settings.dmarcNoneAs === "block" ? "fail" : "incomplete", issues };
  }
  if (settings.requireDkim && (auth.dkim === "none" || auth.dkim === "unknown")) {
    issues.push("DKIM result missing");
    return { level: "incomplete", issues };
  }
  if (auth.spf === "unknown" || auth.spf === "neutral" || auth.spf === "none") {
    issues.push(`SPF inconclusive (${auth.spf})`);
    return { level: "incomplete", issues };
  }
  if (auth.dmarc === "unknown") {
    issues.push("DMARC result missing");
    return { level: "incomplete", issues };
  }
  return { level: "pass", issues: [] };
}

/* ------------------------------------------------------------------ */
/* Per-mailbox handling                                                */
/* ------------------------------------------------------------------ */

export function evaluateSeed(r: SeedResult, settings: Settings): {
  outcome: "pass" | "warn" | "fail" | "skip";
  issues: string[];
} {
  if (!r.checkable) return { outcome: "skip", issues: [r.skipReason ?? "not checkable"] };
  const issues: string[] = [];

  if (r.delivery === "missing") return { outcome: "fail", issues: ["message never arrived"] };
  if (r.delivery === "bounced") return { outcome: "fail", issues: ["message bounced"] };
  if (r.folder === "spam") return { outcome: "fail", issues: ["landed in Spam/Junk"] };
  const badAttachment = r.attachments.some((a) => !a.found || !a.sizeMatch || !a.hashMatch);
  if (badAttachment) return { outcome: "fail", issues: ["attachment validation failed"] };

  if (r.auth) {
    const auth = evaluateAuth(r.auth, settings);
    if (auth.level === "fail") return { outcome: "fail", issues: auth.issues };
    if (auth.level === "incomplete") issues.push(...auth.issues);
  } else {
    issues.push("authentication headers not found");
  }

  if (r.delivery === "delayed") issues.push("delivery delayed");
  if (r.folder === "promotions") issues.push("landed in Promotions");
  if (r.folder === "updates") issues.push("landed in Updates");
  if (r.folder === "other") issues.push("landed outside primary Inbox");

  return { outcome: issues.length ? "warn" : "pass", issues };
}

/* ------------------------------------------------------------------ */
/* Combined verdict rules                                              */
/* ------------------------------------------------------------------ */

const ACTIONS = {
  missing:
    "Verify your domain's MX records and Zoho sending status, then re-run the preflight. Treat repeated misses as a real delivery failure.",
  bounced:
    "Fix the sending address or domain reputation before applying — a bounce means providers are already rejecting your mail.",
  spam:
    "Remove spam-triggering phrases, links and attachments wording from the body, check domain blacklist status, then re-run.",
  attachment:
    "Re-export the resume PDF (embed fonts, flatten), confirm the file opens locally, and re-run the preflight.",
  authFail:
    "Publish/repair SPF, DKIM and DMARC records for your custom domain in Zoho DNS settings, wait for propagation, then re-run.",
  authIncomplete:
    "Complete DMARC/DKIM publishing for your domain, or connect the remaining seed provider to remove the evidence gap.",
  placement:
    "Send a plain-text variant or reduce links/images, then re-run. Accept the risk consciously before sending to the employer.",
  uncheckable:
    "Connect this seed mailbox (OAuth) and re-run — the verdict is only as strong as its weakest unverified provider.",
  inconclusive:
    "Connect more seed mailboxes so the number of verified deliveries meets your required-checks threshold, then re-run.",
};

export function computeVerdict(results: SeedResult[], settings: Settings): VerdictReport {
  const reasons: VerdictReason[] = [];
  let blocked = false;
  let review = false;

  const checkable = results.filter((r) => r.checkable);
  const skipped = results.filter((r) => !r.checkable);

  for (const r of skipped) {
    review = true;
    reasons.push({
      code: "PROVIDER_UNCHECKABLE",
      severity: "review",
      message: `${r.provider.toUpperCase()} seed ${r.address} could not be checked (${r.skipReason ?? "not connected"}).`,
      action: ACTIONS.uncheckable,
    });
  }

  if (checkable.length < settings.requiredChecks) {
    review = true;
    reasons.push({
      code: "EVIDENCE_INCONCLUSIVE",
      severity: "review",
      message: `Only ${checkable.length} of ${settings.requiredChecks} required seed checks completed — evidence is inconclusive.`,
      action: ACTIONS.inconclusive,
    });
  }

  for (const r of checkable) {
    const tag = `${r.provider.toUpperCase()} · ${r.address}`;

    if (r.delivery === "missing") {
      blocked = true;
      reasons.push({
        code: "MSG_MISSING",
        severity: "block",
        message: `${tag}: test message was still missing after the ${settings.timeoutSec}s timeout.`,
        action: ACTIONS.missing,
      });
      continue;
    }
    if (r.delivery === "bounced") {
      blocked = true;
      reasons.push({
        code: "MSG_BOUNCED",
        severity: "block",
        message: `${tag}: the message bounced and was never delivered.`,
        action: ACTIONS.bounced,
      });
      continue;
    }
    if (r.folder === "spam") {
      blocked = true;
      reasons.push({
        code: "SPAM_PLACEMENT",
        severity: "block",
        message: `${tag}: the message landed in Spam/Junk.`,
        action: ACTIONS.spam,
      });
    }

    const badAtt = r.attachments.filter((a) => !a.found || !a.sizeMatch || !a.hashMatch);
    if (badAtt.length > 0) {
      blocked = true;
      reasons.push({
        code: "ATTACHMENT_MISMATCH",
        severity: "block",
        message: `${tag}: ${badAtt.length} attachment(s) failed name/size/SHA-256 validation.`,
        action: ACTIONS.attachment,
      });
    }

    if (r.auth) {
      const auth = evaluateAuth(r.auth, settings);
      if (auth.level === "fail") {
        blocked = true;
        reasons.push({
          code: "AUTH_FAIL",
          severity: "block",
          message: `${tag}: authentication failed — ${auth.issues.join(", ")}.`,
          action: ACTIONS.authFail,
        });
      } else if (auth.level === "incomplete") {
        review = true;
        reasons.push({
          code: "AUTH_INCOMPLETE",
          severity: "review",
          message: `${tag}: authentication incomplete — ${auth.issues.join(", ")}.`,
          action: ACTIONS.authIncomplete,
        });
      }
    }

    if (r.delivery === "delayed") {
      review = true;
      reasons.push({
        code: "DELAYED_DELIVERY",
        severity: "review",
        message: `${tag}: delivery was delayed beyond the normal window.`,
        action: ACTIONS.placement,
      });
    }

    if (r.folder === "promotions") {
      if (settings.promotionsAs === "block") blocked = true;
      else review = true;
      reasons.push({
        code: "NON_PRIMARY_PLACEMENT",
        severity: settings.promotionsAs,
        message: `${tag}: delivered, but filed into Promotions instead of the primary Inbox.`,
        action: ACTIONS.placement,
      });
    }
    if (r.folder === "updates" || r.folder === "other") {
      if (settings.updatesAs === "block") blocked = true;
      else review = true;
      reasons.push({
        code: "NON_PRIMARY_PLACEMENT",
        severity: settings.updatesAs,
        message: `${tag}: delivered, but filed into ${r.folder === "updates" ? "Updates" : "a non-primary category"} instead of the Inbox.`,
        action: ACTIONS.placement,
      });
    }
  }

  const verdict = blocked ? "block" : review || checkable.length === 0 ? "review" : "safe";

  const order = { block: 0, review: 1, info: 2 } as const;
  reasons.sort((a, b) => order[a.severity] - order[b.severity]);

  return { verdict, reasons };
}

export const VERDICT_META: Record<
  "safe" | "review" | "block",
  { label: string; stamp: string; blurb: string }
> = {
  safe: {
    label: "Safe to send",
    stamp: "SAFE TO SEND",
    blurb:
      "Package verified in the primary Inbox of every required seed mailbox, attachments intact, SPF/DKIM/DMARC passing.",
  },
  review: {
    label: "Review needed",
    stamp: "REVIEW NEEDED",
    blurb:
      "Delivery works, but placement, authentication coverage or evidence quality is not strong enough for an automatic green light.",
  },
  block: {
    label: "Do not send",
    stamp: "DO NOT SEND",
    blurb:
      "A hard failure was detected. Sending this package to an employer right now risks spam placement, broken attachments or bounced mail.",
  },
};

export const DISCLAIMER =
  "Best-effort preflight assessment based on seed inboxes you control — not a guarantee of placement in any specific employer's inbox.";
