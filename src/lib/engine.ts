import type {
  AttachmentCheck,
  AuthEvaluation,
  FolderState,
  PreflightInput,
  PreflightRun,
  Provider,
  ScenarioId,
  SeedMailbox,
  SeedResult,
  Settings,
  StepEvent,
} from "./types";
import { computeVerdict, evaluateAuth, evaluateSeed, parseAuthenticationResults } from "./verdict";
import { enforceAllowlist, makeTestId, normalizeEmail, seededSubject, uid } from "./utils";

/** Real milliseconds represented by one simulated second. */
const SIM = 430;

export const SCENARIOS: Array<{ id: ScenarioId; label: string; desc: string }> = [
  { id: "nominal", label: "Nominal delivery", desc: "All seed inboxes receive the package in the primary Inbox with passing auth." },
  { id: "promotions", label: "Promotions tab", desc: "A Gmail-style provider files the message into Promotions instead of Primary." },
  { id: "spam", label: "Spam/Junk trap", desc: "One provider's filter diverts the message into Spam/Junk." },
  { id: "missing", label: "Silent loss (timeout)", desc: "The message never arrives at one seed inbox before the configured timeout." },
  { id: "bounce", label: "Hard bounce", desc: "A provider rejects the message during transit with a 5xx SMTP error." },
  { id: "auth-incomplete", label: "DMARC missing", desc: "Message arrives, but DMARC evaluates to 'none' — authentication incomplete." },
  { id: "auth-fail", label: "DKIM failure", desc: "The DKIM signature fails verification at the receiver." },
  { id: "attachment-corrupt", label: "Corrupted attachment", desc: "A PDF arrives with a size/SHA-256 mismatch against the original." },
];

interface MailboxPlan {
  arriveSec: number | null;
  bounce: boolean;
  folder: FolderState;
  auth: AuthEvaluation;
  corrupt: boolean;
}

const PASS_AUTH: AuthEvaluation = { spf: "pass", dkim: "pass", dmarc: "pass" };

function planFor(scenario: ScenarioId, boxes: SeedMailbox[], idx: number): MailboxPlan {
  const nominal: MailboxPlan = {
    arriveSec: 2.6 + idx * 1.1,
    bounce: false,
    folder: "inbox",
    auth: { ...PASS_AUTH },
    corrupt: false,
  };
  const byProvider = (p: Provider) => {
    const i = boxes.findIndex((b) => b.provider === p);
    return i >= 0 ? i : boxes.length - 1;
  };
  switch (scenario) {
    case "promotions":
      return idx === byProvider("gmail") ? { ...nominal, folder: "promotions" } : nominal;
    case "spam":
      return idx === byProvider("outlook") ? { ...nominal, folder: "spam" } : nominal;
    case "missing":
      return idx === boxes.length - 1 ? { ...nominal, arriveSec: null } : nominal;
    case "bounce":
      return idx === boxes.length - 1 ? { ...nominal, bounce: true } : nominal;
    case "auth-incomplete":
      return idx === 0 ? { ...nominal, auth: { spf: "pass", dkim: "pass", dmarc: "none" } } : nominal;
    case "auth-fail":
      return idx === 0 ? { ...nominal, auth: { spf: "pass", dkim: "fail", dmarc: "fail" } } : nominal;
    case "attachment-corrupt":
      return idx === 0 ? { ...nominal, corrupt: true } : nominal;
    default:
      return nominal;
  }
}

function headerBlock(testId: string, auth: AuthEvaluation, provider: Provider, fromDomain: string) {
  return [
    `Authentication-Results: mx.${provider}.example;`,
    `  spf=${auth.spf} smtp.mailfrom=${fromDomain};`,
    `  dkim=${auth.dkim} header.i=@${fromDomain};`,
    `  dmarc=${auth.dmarc} header.from=${fromDomain}`,
    `Received-SPF: ${auth.spf} (mx.${provider}.example: domain of bounce@${fromDomain} designates 203.0.113.7 as permitted sender)`,
    `X-Preflight-Test-Id: ${testId}`,
  ].join("\n");
}

const STEP_LABELS = [
  "SMTP handoff · Zoho relay",
  "Transit to provider",
  "Polling seed inbox",
  "Folder classification",
  "Auth headers · SPF/DKIM/DMARC",
  "Attachment integrity · SHA-256",
];

function freshSteps(): StepEvent[] {
  return STEP_LABELS.map((label, i) => ({ id: `s${i}`, label, state: "pending" as const }));
}

export interface RunHandle {
  promise: Promise<PreflightRun>;
  cancel: () => void;
}

export function startPreflight(opts: {
  input: PreflightInput;
  mailboxes: SeedMailbox[];
  settings: Settings;
  scenario: ScenarioId;
  emit: (run: PreflightRun) => void;
}): RunHandle {
  const { input, mailboxes, settings, scenario, emit } = opts;
  let cancelled = false;
  const testId = makeTestId();
  const subject = seededSubject(input.subject.trim(), testId);
  const fromDomain = "mail." + (input.employer ? "yourdomain.dev" : "yourdomain.dev");

  const seedResults: SeedResult[] = mailboxes.map((m) => {
    const allowed = settings.allowlist.map(normalizeEmail).includes(normalizeEmail(m.address));
    const checkable = m.status === "connected" && allowed;
    return {
      mailboxId: m.id,
      provider: m.provider,
      address: m.address,
      checkable,
      skipReason:
        m.status !== "connected"
          ? "not connected — OAuth flow required"
          : !allowed
            ? "address not in the recipient allowlist"
            : undefined,
      delivery: null,
      folder: null,
      latencySec: null,
      auth: null,
      attachments: [],
      steps: checkable ? freshSteps() : [],
      outcome: "skip",
    };
  });

  const run: PreflightRun = {
    id: uid("run"),
    testId,
    input,
    seededSubject: subject,
    recipients: [],
    scenario,
    status: "running",
    startedAt: new Date().toISOString(),
    timeoutSec: settings.timeoutSec,
    log: [],
    seedResults,
  };

  const t0 = Date.now();
  const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const log = (line: string) => {
    run.log = [...run.log.slice(-90), `${stamp()}  ${line}`];
  };
  const publish = () => emit(structuredClone(run));
  const sleep = (simSec: number) =>
    new Promise<void>((res) => setTimeout(res, simSec * SIM));

  const setStep = (r: SeedResult, i: number, state: StepEvent["state"], detail?: string) => {
    r.steps = r.steps.map((s, j) => (j === i ? { ...s, state, detail: detail ?? s.detail } : s));
  };
  const skipRest = (r: SeedResult, from: number) => {
    r.steps = r.steps.map((s, j) => (j >= from && s.state === "pending" ? { ...s, state: "skip" } : s));
  };

  async function processMailbox(r: SeedResult, idx: number) {
    if (cancelled) return;
    if (!r.checkable) return;
    const plan = planFor(scenario, mailboxes, idx);

    // 1 — SMTP handoff
    setStep(r, 0, "active");
    publish();
    await sleep(0.55);
    if (cancelled) return;
    setStep(r, 0, "pass", "250 OK · queued");
    log(`SMTP 250 OK — ${r.address} queued by Zoho relay`);

    // 2 — transit / bounce
    setStep(r, 1, "active");
    publish();
    await sleep(plan.bounce ? 1.1 : 0.6);
    if (cancelled) return;
    if (plan.bounce) {
      setStep(r, 1, "fail", "550 5.1.1 rejected");
      log(`✗ ${r.provider}: 550 5.1.1 <${r.address}> — hard bounce received`);
      r.delivery = "bounced";
      skipRest(r, 2);
      r.outcome = evaluateSeed(r, settings).outcome;
      publish();
      return;
    }
    setStep(r, 1, "pass", "accepted by provider MX");

    // 3 — polling
    setStep(r, 2, "active");
    publish();
    const polls = Math.ceil(settings.timeoutSec / 2);
    let received = false;
    for (let p = 1; p <= polls; p++) {
      await sleep(0.45);
      if (cancelled) return;
      const elapsed = p * 0.45 + 1.2;
      if (plan.arriveSec !== null && elapsed >= plan.arriveSec) {
        received = true;
        r.latencySec = Math.round(plan.arriveSec * 10) / 10;
        break;
      }
      if (p % 2 === 0 || p === polls)
        log(`poll ${r.provider} ${p}/${polls} — scanning for X-Preflight-Test-Id ${testId} … 0 hits`);
      publish();
    }
    if (!received) {
      setStep(r, 2, "fail", `timeout after ${settings.timeoutSec}s`);
      log(`✗ ${r.provider}: no message after ${settings.timeoutSec}s — marked MISSING`);
      r.delivery = "missing";
      skipRest(r, 3);
      r.outcome = evaluateSeed(r, settings).outcome;
      publish();
      return;
    }
    const delayed = (r.latencySec ?? 0) > 10;
    r.delivery = delayed ? "delayed" : "received";
    setStep(r, 2, "pass", `received in ${r.latencySec}s`);
    log(`✓ ${r.provider}: hit — Message-ID matched ${testId} (${r.latencySec}s)`);

    // 4 — folder classification
    setStep(r, 3, "active");
    publish();
    await sleep(0.5);
    if (cancelled) return;
    r.folder = plan.folder;
    const folderState = plan.folder === "inbox" ? "pass" : plan.folder === "spam" ? "fail" : "warn";
    setStep(r, 3, folderState, plan.folder.toUpperCase());
    log(
      plan.folder === "inbox"
        ? `✓ ${r.provider}: filed into primary INBOX`
        : `! ${r.provider}: filed into ${plan.folder.toUpperCase()}`
    );

    // 5 — auth headers
    setStep(r, 4, "active");
    publish();
    await sleep(0.55);
    if (cancelled) return;
    r.headerSnippet = headerBlock(testId, plan.auth, r.provider, fromDomain);
    r.auth = parseAuthenticationResults(r.headerSnippet);
    const authLevel = evaluateAuth(r.auth, settings).level;
    setStep(
      r,
      4,
      authLevel === "pass" ? "pass" : authLevel === "fail" ? "fail" : "warn",
      `SPF ${r.auth.spf} · DKIM ${r.auth.dkim} · DMARC ${r.auth.dmarc}`
    );
    log(`  ${r.provider}: spf=${r.auth.spf} dkim=${r.auth.dkim} dmarc=${r.auth.dmarc}`);

    // 6 — attachments
    setStep(r, 5, "active");
    publish();
    await sleep(0.6);
    if (cancelled) return;
    r.attachments = input.attachments.map<AttachmentCheck>((a) => ({
      name: a.name,
      expectedSize: a.size,
      expectedSha: a.sha256,
      found: true,
      sizeMatch: !plan.corrupt,
      hashMatch: !plan.corrupt,
    }));
    const ok = r.attachments.every((a) => a.found && a.sizeMatch && a.hashMatch);
    if (!ok) log(`✗ ${r.provider}: attachment SHA-256 mismatch vs original upload`);
    setStep(r, 5, ok ? "pass" : "fail", ok ? `${r.attachments.length}/${r.attachments.length} verified` : "checksum mismatch");

    r.outcome = evaluateSeed(r, settings).outcome;
    publish();
  }

  const promise = (async () => {
    log(`preflight ${testId} started — scenario injector: ${scenario}`);
    log(`package: "${input.subject}" · ${input.attachments.length} PDF attachment(s)`);
    log("tracking disabled: no pixels, no link rewriting, no click tracking");

    let recipients: string[] = [];
    try {
      recipients = enforceAllowlist(
        seedResults.filter((r) => r.checkable).map((r) => r.address),
        settings.allowlist
      );
    } catch (e) {
      log(`✗ allowlist gate rejected recipients: ${(e as Error).message}`);
    }
    run.recipients = recipients;
    log(`allowlist gate: ${recipients.length} seed recipient(s) approved — employer address never used`);
    log(`subject on the wire: ${subject}`);
    publish();
    await sleep(0.8);

    if (recipients.length === 0) {
      log("✗ zero checkable seed mailboxes — run cannot produce delivery evidence");
      run.status = "complete";
      run.finishedAt = new Date().toISOString();
      run.report = computeVerdict(run.seedResults, settings);
      publish();
      return structuredClone(run);
    }

    for (let mi = 0; mi < seedResults.length; mi++) {
      await processMailbox(seedResults[mi], mi);
      if (cancelled) break;
    }

    if (cancelled) {
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      log("— run cancelled by operator —");
      publish();
      return structuredClone(run);
    }

    run.report = computeVerdict(run.seedResults, settings);
    run.status = "complete";
    run.finishedAt = new Date().toISOString();
    log(`verdict: ${run.report.verdict.toUpperCase()} — ${run.report.reasons.length} finding(s)`);
    publish();
    return structuredClone(run);
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
  };
}
