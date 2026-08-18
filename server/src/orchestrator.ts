/**
 * Live preflight orchestrator — the polling queue.
 *
 * Pipeline per run (mirrors the demo engine exactly, but against real systems):
 *   1. enforce allowlist (throws on any non-seed address)
 *   2. send the exact package via Zoho SMTP with TEST prefix + X-Preflight-Test-Id
 *   3. poll each connected seed inbox through its provider adapter until the
 *      message is found or the configured timeout expires
 *   4. classify placement, parse SPF/DKIM/DMARC from received headers,
 *      verify attachment name/size/SHA-256
 *   5. evaluate seeds and combine into the verdict (shared rules)
 *   6. persist every progress tick so the UI can poll the run document
 *
 * All I/O is injected (repo, smtp, adapter factory, sleep, clock) so the full
 * pipeline runs in automated tests with mock adapters and a fake clock.
 */
import type {
  PreflightInput,
  PreflightRun,
  SeedMailbox,
  SeedResult,
  Settings,
  StepEvent,
  VerdictReport,
} from "../../shared/types";
import {
  computeVerdict,
  evaluateSeed,
  parseAuthenticationResults,
} from "../../shared/verdict";
import { makeTestId, normalizeEmail, seededSubject, uid } from "../../shared/strings";
import type { MailProviderAdapter } from "./adapters";
import type { Repository, StoredMailbox } from "./db";
import type { SendResult } from "./smtp";

export interface OrchestratorDeps {
  repo: Repository;
  settings: Settings;
  /** Sends the package; injected so tests capture JSON instead of SMTP. */
  send: (args: {
    input: PreflightInput;
    testId: string;
    recipients: string[];
    payloads: Map<string, Buffer>;
  }) => Promise<SendResult>;
  /** Adapter per mailbox; may return null → mailbox is uncheckable (skipped). */
  adapterFor: (m: StoredMailbox, run: PreflightRun) => MailProviderAdapter | null;
  sleep: (ms: number) => Promise<void>;
  clock: () => number;
  pollIntervalMs: number;
  timeoutMs: number;
}

const step = (id: string, label: string, state: StepEvent["state"], detail?: string): StepEvent => ({
  id,
  label,
  state,
  detail,
});

export interface StartRunArgs {
  input: PreflightInput;
  payloads: Map<string, Buffer>;
  mailboxes: StoredMailbox[];
}

export function createRunRecord(args: StartRunArgs, settings: Settings): PreflightRun {
  const testId = makeTestId();
  // Strict intersection: ONLY connected mailboxes whose address is allowlisted
  // become recipients. Anything else is labelled as skipped in the report —
  // and the SMTP sender itself still throws on any non-allowlisted address,
  // so a non-seed recipient can never reach the transport.
  const allowSet = new Set(settings.allowlist.map(normalizeEmail));
  const recipients = args.mailboxes
    .filter((m) => m.status === "connected")
    .map((m) => normalizeEmail(m.address))
    .filter((a) => allowSet.has(a));
  return {
    id: uid("run"),
    testId,
    input: args.input,
    seededSubject: seededSubject(args.input.subject, testId),
    recipients,
    scenario: "live",
    status: "running",
    startedAt: new Date().toISOString(),
    timeoutSec: Math.round(settings.timeoutSec),
    log: [`Run created — test id ${testId}`],
    seedResults: [],
  };
}

/** Executes one run end-to-end, persisting progress on every tick. Returns the final run. */
export async function executePreflightRun(
  run: PreflightRun,
  args: StartRunArgs,
  deps: OrchestratorDeps
): Promise<PreflightRun> {
  const { repo, settings } = deps;
  const log = (line: string) => {
    run.log.push(line);
    repo.upsertRun(run);
  };

  const persist = () => repo.upsertRun(run);

  /* ---- 1+2: send through the allowlist gate, via Zoho SMTP ---- */
  log(`Allowlist gate: ${run.recipients.length} seed recipient(s) verified`);
  log(`SMTP: handing the package to Zoho SMTP (${run.input.attachments.length} PDF)`);
  try {
    const sent = await deps.send({
      input: run.input,
      testId: run.testId,
      recipients: run.recipients,
      payloads: args.payloads,
    });
    log(`SMTP: accepted for ${sent.accepted.length} recipient(s) · message-id ${sent.messageId || "n/a"}`);
  } catch (err) {
    log(`SMTP: rejected — ${(err as Error).message}`);
    run.status = "complete";
    run.finishedAt = new Date(deps.clock()).toISOString();
    run.report = {
      verdict: "block",
      reasons: [
        {
          code: "SEND_REFUSED",
          severity: "block",
          message: `The send gate refused the package: ${(err as Error).message}`,
          action:
            "Only allowlisted seed addresses may receive preflight mail. Check TEST_RECIPIENT_ALLOWLIST and the connected seed mailboxes, then re-run.",
        },
      ],
    };
    persist();
    return run;
  }

  /* ---- 3: poll every connected, allowlisted seed inbox ---- */
  const checkable = args.mailboxes.filter(
    (m) => m.status === "connected" && run.recipients.includes(normalizeEmail(m.address))
  );
  const deadline = deps.clock() + deps.timeoutMs;

  for (const box of checkable) {
    const adapter = deps.adapterFor(box, run);
    const r: SeedResult = {
      mailboxId: box.id,
      provider: box.provider,
      address: box.address,
      checkable: !!adapter,
      skipReason: adapter ? undefined : "no usable OAuth/IMAP token for this mailbox",
      delivery: null,
      folder: null,
      latencySec: null,
      auth: null,
      attachments: [],
      steps: [],
      outcome: "skip",
    };
    run.seedResults.push(r);
    persist();
    if (!adapter) {
      r.steps.push(step("conn", "Provider connection", "skip", r.skipReason));
      log(`${box.provider} ${box.address}: skipped — ${r.skipReason}`);
      continue;
    }

    r.steps.push(step("send", "Package handed to Zoho SMTP", "pass"));
    r.steps.push(step("poll", "Polling seed inbox", "active"));
    persist();

    let found: Awaited<ReturnType<MailProviderAdapter["findSeedMessage"]>> = null;
    while (deps.clock() < deadline) {
      found = await adapter.findSeedMessage(run.testId, { sinceIso: run.startedAt });
      if (found) break;
      await deps.sleep(deps.pollIntervalMs);
    }

    if (!found) {
      r.delivery = "missing";
      r.steps.push(step("poll", "Polling seed inbox", "fail", `missing after ${run.timeoutSec}s`));
      log(`${box.provider} ${box.address}: still missing after timeout`);
      r.outcome = evaluateSeed(r, settings).outcome;
      persist();
      continue;
    }
    if (found.bounced) {
      r.delivery = "bounced";
      r.steps.push(step("poll", "Polling seed inbox", "fail", "hard bounce"));
      log(`${box.provider} ${box.address}: message bounced`);
      r.outcome = evaluateSeed(r, settings).outcome;
      persist();
      continue;
    }

    /* ---- 4: classify placement + parse auth headers + verify attachments ---- */
    r.delivery = "received";
    r.folder = found.folder;
    r.latencySec = Math.max(0, Math.round((new Date(found.receivedAt).getTime() - new Date(run.startedAt).getTime()) / 1000));
    r.steps.push(
      step("poll", "Polling seed inbox", "pass", `found in ${r.latencySec}s`)
    );
    r.steps.push(
      step(
        "folder",
        "Placement classification",
        found.folder === "inbox" ? "pass" : found.folder === "spam" ? "fail" : "warn",
        found.folder
      )
    );
    log(`${box.provider} ${box.address}: received → ${found.folder} (${r.latencySec}s)`);

    r.auth = found.authHeaders ? parseAuthenticationResults(found.authHeaders) : null;
    r.headerSnippet = found.authHeaders.split("\n").slice(0, 4).join("\n") || undefined;
    const authState =
      r.auth && r.auth.spf === "pass" && r.auth.dkim === "pass" && r.auth.dmarc === "pass"
        ? "pass"
        : r.auth && (r.auth.spf === "fail" || r.auth.dkim === "fail" || r.auth.dmarc === "fail")
          ? "fail"
          : "warn";
    r.steps.push(
      step(
        "auth",
        "SPF / DKIM / DMARC",
        authState,
        r.auth ? `spf=${r.auth.spf} dkim=${r.auth.dkim} dmarc=${r.auth.dmarc}` : "no auth headers"
      )
    );

    r.attachments = run.input.attachments.map((expected) => {
      const got = found!.attachments.find((a) => a.filename === expected.name);
      return {
        name: expected.name,
        expectedSize: expected.size,
        expectedSha: expected.sha256,
        found: !!got,
        sizeMatch: !!got && got.size === expected.size,
        hashMatch: !!got && got.sha256 === expected.sha256,
      };
    });
    const attsOk = r.attachments.every((a) => a.found && a.sizeMatch && a.hashMatch);
    r.steps.push(
      step("att", "Attachment verification", attsOk ? "pass" : "fail", `${r.attachments.filter((a) => a.found && a.hashMatch).length}/${r.attachments.length} intact`)
    );
    log(`${box.provider} ${box.address}: attachments ${attsOk ? "intact" : "FAILED validation"}`);

    const ev = evaluateSeed(r, settings);
    r.outcome = ev.outcome;
    persist();
  }

  /* ---- 5: label every mailbox that was not checked ----
     Disconnected mailboxes and connected-but-not-allowlisted mailboxes both
     become explicit skip results, so the combined verdict always reports them
     as uncheckable providers (→ Review needed) instead of silently ignoring
     them. */
  for (const box of args.mailboxes) {
    if (run.seedResults.some((r) => r.mailboxId === box.id)) continue;
    const reason =
      box.status !== "connected"
        ? "mailbox not connected"
        : "address not in TEST_RECIPIENT_ALLOWLIST";
    run.seedResults.push({
      mailboxId: box.id,
      provider: box.provider,
      address: box.address,
      checkable: false,
      skipReason: reason,
      delivery: null,
      folder: null,
      latencySec: null,
      auth: null,
      attachments: [],
      steps: [step("gate", "Preflight gate", "skip", reason)],
      outcome: "skip",
    });
    log(`${box.provider} ${box.address}: skipped — ${reason}`);
  }

  const report: VerdictReport = computeVerdict(run.seedResults, settings);
  run.report = report;
  run.status = "complete";
  run.finishedAt = new Date(deps.clock()).toISOString();
  log(`Verdict: ${report.verdict.toUpperCase()} (${report.reasons.length} finding(s))`);
  persist();
  return run;
}

/* ------------------------------------------------------------------ */
/* In-process job queue                                                */
/* ------------------------------------------------------------------ */

export class RunQueue {
  private running = new Set<string>();
  constructor(private deps: OrchestratorDeps) {}

  isRunning(id: string) {
    return this.running.has(id);
  }

  /** Fire-and-forget enqueue; progress is visible via the repository. */
  enqueue(run: PreflightRun, args: StartRunArgs): Promise<PreflightRun> {
    this.running.add(run.id);
    return executePreflightRun(run, args, this.deps).finally(() => this.running.delete(run.id));
  }
}
