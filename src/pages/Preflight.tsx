import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AttachmentMeta,
  BackendHealth,
  JobApplication,
  PreflightInput,
  PreflightRun,
  ScenarioId,
  SeedMailbox,
  Settings,
} from "../lib/types";
import { SCENARIOS, startPreflight, type RunHandle } from "../lib/engine";
import { fileToBase64, liveRunPreflight } from "../lib/api";
import {
  cx,
  fmtBytes,
  isEmailAddress,
  normalizeEmail,
  seededSubject,
  sha256Hex,
  shortSha,
  validateAttachment,
} from "../lib/utils";
import { RunReport } from "../components/RunReport";
import { K, PROVIDER_META, usePersistentState } from "../lib/store";
import {
  Btn,
  Chip,
  IcAlert,
  IcCheck,
  IcCopy,
  IcDoc,
  IcLink,
  IcLock,
  IcPaperclip,
  IcPlay,
  IcRadar,
  IcStop,
  IcX,
  Lamp,
  ProgressBar,
  toast,
} from "../components/ui";

interface AttachedFile {
  file: File;
  meta: AttachmentMeta | null;
  errors: string[];
}

function ReadinessRow({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-center gap-2.5 text-[13px]">
      <Lamp size={7} pulse={false} state={ok ? "ok" : warn ? "warn" : "off"} />
      <span className={ok ? "text-fog" : "text-mut"}>{label}</span>
      {detail && <span className="ml-auto font-mono text-[10.5px] text-dim">{detail}</span>}
    </li>
  );
}

export function PreflightPage({
  mailboxes,
  settings,
  apps,
  onSaveRun,
  onLinkApp,
  consoleDraft,
  onDraftConsumed,
  onPhaseChange,
  hasCompletedRun,
  backend,
}: {
  backend: BackendHealth | null;
  mailboxes: SeedMailbox[];
  settings: Settings;
  apps: JobApplication[];
  onSaveRun: (run: PreflightRun) => void;
  onLinkApp: (appId: string, run: PreflightRun) => void;
  consoleDraft: Partial<PreflightInput> | null;
  onDraftConsumed: () => void;
  onPhaseChange: (phase: "idle" | "running" | "done") => void;
  hasCompletedRun: boolean;
}) {
  const [employer, setEmployer] = useState("");
  const [role, setRole] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [employerEmail, setEmployerEmail] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [scenario, setScenario] = useState<ScenarioId>("nominal");
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [live, setLive] = useState<PreflightRun | null>(null);
  const [linkAppId, setLinkAppId] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const ctrlRef = useRef<RunHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!consoleDraft) return;
    setEmployer(consoleDraft.employer ?? "");
    setRole(consoleDraft.role ?? "");
    setSubject(consoleDraft.subject ?? "");
    setBody(consoleDraft.body ?? "");
    setEmployerEmail(consoleDraft.employerEmail ?? "");
    toast("Package loaded from the application tracker");
    onDraftConsumed();
  }, [consoleDraft, onDraftConsumed]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [live?.log.length]);

  useEffect(() => () => ctrlRef.current?.cancel(), []);

  useEffect(() => onPhaseChange(phase), [phase, onPhaseChange]);

  const allowSet = useMemo(() => new Set(settings.allowlist.map(normalizeEmail)), [settings.allowlist]);
  const readyBoxes = mailboxes.filter((m) => m.status === "connected" && allowSet.has(normalizeEmail(m.address)));

  const addFiles = async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    if (files.length + incoming.length > 2) {
      toast("Maximum two attachments — resume plus one optional PDF", "warn");
    }
    for (const f of incoming.slice(0, 2 - files.length)) {
      const entry: AttachedFile = { file: f, meta: null, errors: validateAttachment(f, settings).errors };
      setFiles((xs) => [...xs, entry]);
      if (entry.errors.length === 0) {
        try {
          const buf = await f.arrayBuffer();
          const sha = await sha256Hex(buf);
          setFiles((xs) =>
            xs.map((x) =>
              x.file === f ? { ...x, meta: { name: f.name, size: f.size, sha256: sha } } : x
            )
          );
        } catch {
          setFiles((xs) => xs.map((x) => (x.file === f ? { ...x, errors: ["Could not hash the file."] } : x)));
        }
      }
    }
  };

  const allHashed = files.length > 0 && files.every((f) => f.meta !== null);
  const attachmentsOk = files.length >= 1 && files.every((f) => f.errors.length === 0) && allHashed;
  const readiness = {
    employer: employer.trim().length > 0,
    role: role.trim().length > 0,
    subject: subject.trim().length > 0,
    body: body.trim().length >= 40,
    attachments: attachmentsOk,
    seeds: readyBoxes.length >= 1,
  };
  const canRun = Object.values(readiness).every(Boolean) && phase !== "running";

  const [qsOpen, setQsOpen] = usePersistentState<boolean>(K.quickstart, () => true);
  const connectedCount = mailboxes.filter((m) => m.status === "connected").length;
  const qsSteps: Array<{ label: string; done: boolean; detail: string }> = [
    {
      label: "Connect seed inboxes",
      done: connectedCount > 0,
      detail: `${connectedCount}/${mailboxes.length} connected`,
    },
    {
      label: "Confirm the allowlist",
      done: settings.allowlist.length > 0 && settings.allowlist.length >= connectedCount,
      detail: `${settings.allowlist.length} address${settings.allowlist.length === 1 ? "" : "es"} cleared`,
    },
    {
      label: "Build the package",
      done: readiness.employer && readiness.role && readiness.subject && readiness.body && readiness.attachments,
      detail: readiness.attachments ? `${files.length} PDF hashed` : files.length > 0 ? "hashing / invalid" : "no PDF yet",
    },
    {
      label: "Run & read the verdict",
      done: hasCompletedRun,
      detail: hasCompletedRun ? "first verdict archived" : "awaiting first run",
    },
  ];

  /** True when the local backend executes runs (live SMTP, or labelled mock-dev). */
  const isLiveBackend = !!backend && backend.mode !== "demo";

  const finishRun = (finished: PreflightRun) => {
    setLive(finished);
    setPhase("done");
    if (finished.status === "complete") {
      onSaveRun(finished);
      const v = finished.report?.verdict;
      if (v === "safe") toast("Preflight passed — safe to send manually", "ok");
      else if (v === "review") toast("Preflight finished — review needed", "warn");
      else toast("Preflight finished — do not send", "err");
    } else {
      toast("Run cancelled", "warn");
    }
  };

  const run = () => {
    const input: PreflightInput = {
      employer: employer.trim(),
      role: role.trim(),
      subject: subject.trim(),
      body: body.trim(),
      employerEmail: employerEmail.trim() || undefined,
      attachments: files.map((f) => f.meta!),
    };
    setPhase("running");
    setLive(null);

    if (isLiveBackend) {
      void (async () => {
        try {
          const payloads: Record<string, string> = {};
          for (const f of files) payloads[f.file.name] = await fileToBase64(f.file);
          const finished = await liveRunPreflight(input, payloads, (r) => setLive(r));
          finishRun(finished);
        } catch (err) {
          setPhase("idle");
          toast(err instanceof Error ? err.message : "The backend refused the run.", "err");
        }
      })();
      return;
    }

    const handle = startPreflight({
      input,
      mailboxes,
      settings,
      scenario,
      emit: (r) => setLive(r),
    });
    ctrlRef.current = handle;
    handle.promise.then(finishRun);
  };

  const reset = () => {
    setPhase("idle");
    setLive(null);
  };

  const progress = useMemo(() => {
    if (!live) return 0;
    const steps = live.seedResults.filter((r) => r.checkable).flatMap((r) => r.steps);
    if (steps.length === 0) return 50;
    const done = steps.filter((s) => s.state !== "pending" && s.state !== "active").length;
    return Math.round((done / steps.length) * 100);
  }, [live]);

  const previewSubject = subject.trim() ? seededSubject(subject.trim(), "PFT-······") : "—";
  const scenarioMeta = SCENARIOS.find((s) => s.id === scenario)!;

  return (
    <div className="space-y-5">
      {qsOpen && phase !== "running" && (
        <section className="panel anim-rise relative overflow-hidden p-4">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-cy via-cy/25 to-transparent" />
          <div className="flex items-start justify-between gap-3 pl-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-cy">first run · operating checklist</div>
              <h3 className="mt-1 font-disp text-[15px] font-bold text-fog">Four steps to your first verdict</h3>
            </div>
            <button
              onClick={() => setQsOpen(false)}
              className="rounded-md p-1.5 text-dim transition-colors hover:bg-raise hover:text-fog"
              aria-label="Dismiss quick start checklist"
            >
              <IcX size={14} />
            </button>
          </div>
          <ol className="mt-3.5 grid gap-2 pl-2 sm:grid-cols-2 xl:grid-cols-4">
            {qsSteps.map((s, i) => (
              <li
                key={s.label}
                className={cx(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all duration-200",
                  s.done
                    ? "border-grn/25 bg-grn/[0.04] hover:border-grn/40"
                    : "border-edge bg-pit/40 hover:border-edge2 hover:bg-raise/40"
                )}
              >
                <span
                  className={cx(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[10.5px] transition-colors",
                    s.done ? "border-grn/50 bg-grn/10 text-grn" : "border-edge text-dim"
                  )}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className={cx("text-[12.5px] font-medium leading-tight", s.done ? "text-fog" : "text-mut")}>
                    {s.label}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-dim">
                    <Lamp state={s.done ? "ok" : "warn"} size={5} pulse={!s.done} />
                    {s.detail}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2.5 pl-2 text-[10.5px] text-dim">
            In demo mode, the run is simulated. Once live mode is configured, the same screen sends through Zoho SMTP
            and checks your connected seed inboxes automatically.
          </p>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
      {/* ------------------------------------------------ left: package form */}
      <div className="space-y-5">
        <section className="panel panel-notch anim-rise p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-disp text-lg font-bold text-fog">Application package</h2>
            <Chip tone="info">exact copy of the real mail</Chip>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="lbl" htmlFor="pf-employer">Employer</label>
              <input id="pf-employer" className="inp" placeholder="Northwind Robotics" value={employer}
                onChange={(e) => setEmployer(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor="pf-role">Role title</label>
              <input id="pf-role" className="inp" placeholder="Backend Engineer (Platform)" value={role}
                onChange={(e) => setRole(e.target.value)} />
            </div>
          </div>
          <div className="mt-4">
            <label className="lbl" htmlFor="pf-subject">Real subject line</label>
            <input id="pf-subject" className="inp" placeholder="Application — Backend Engineer — Jane Doe"
              value={subject} onChange={(e) => setSubject(e.target.value)} />
            <p className="mt-1.5 font-mono text-[11px] text-dim">
              on the wire to seeds: <span className="text-cy">{previewSubject}</span>
            </p>
          </div>
          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <label className="lbl" htmlFor="pf-body">Cover-letter body</label>
              <span className={cx("font-mono text-[10.5px]", readiness.body ? "text-dim" : "text-amb")}>
                {body.trim().length} chars {readiness.body ? "" : "· min 40"}
              </span>
            </div>
            <textarea id="pf-body" rows={7}
              className="inp resize-y font-[400] leading-relaxed"
              placeholder="Dear hiring team, …" value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-dim">
              <IcLock size={12} className="text-grn/80" />
              Sent verbatim — no pixels, no link rewriting, no click tracking. Ever.
            </p>
          </div>
          <div className="mt-4">
            <label className="lbl" htmlFor="pf-employer-email">Employer contact email (optional)</label>
            <input id="pf-employer-email" className="inp" placeholder="hiring@employer.com" value={employerEmail}
              onChange={(e) => setEmployerEmail(e.target.value)} />
            {employerEmail.trim() && (
              <p className={cx("mt-1.5 flex items-center gap-1.5 text-[11.5px]",
                isEmailAddress(employerEmail) ? "text-dim" : "text-red")}>
                <IcLock size={12} className="text-red/80" />
                {isEmailAddress(employerEmail)
                  ? "Recorded for the tracker only — hard-blocked from ever being a recipient."
                  : "That doesn't look like a valid address."}
              </p>
            )}
          </div>
        </section>

        {/* attachments */}
        <section className="panel anim-rise p-5" style={{ animationDelay: "60ms" }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-disp text-lg font-bold text-fog">Attachments</h2>
            <Chip tone="neutral">PDF only · max {settings.attachmentMaxMb} MB</Chip>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            className={cx(
              "grid cursor-pointer place-items-center rounded-lg border border-dashed px-4 py-7 text-center transition-all duration-200",
              dragOver ? "border-cy bg-cy/8 scale-[1.01]" : "border-edge hover:border-edge2 hover:bg-raise/40"
            )}
          >
            <IcPaperclip size={22} className={dragOver ? "text-cy" : "text-dim"} />
            <p className="mt-2 text-sm text-mut">
              Drop your <span className="text-fog font-medium">resume PDF</span> here — plus one optional second PDF
            </p>
            <p className="mt-0.5 font-mono text-[10.5px] text-dim">name · size · SHA-256 are verified at the seed inbox</p>
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple className="hidden"
              onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
          </div>

          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((f, i) => (
                <li key={i} className="anim-rise flex items-start gap-3 rounded-lg border border-edge bg-pit/60 px-3 py-2.5">
                  <IcDoc size={17} className={f.errors.length ? "text-red" : "text-cy"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium text-fog">{f.file.name}</span>
                      <span className="font-mono text-[10.5px] text-dim">{fmtBytes(f.file.size)}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] text-dim">
                      {f.errors.length > 0 ? (
                        <span className="text-red">{f.errors.join(" ")}</span>
                      ) : f.meta ? (
                        <span>sha256 {shortSha(f.meta.sha256)}</span>
                      ) : (
                        <span className="text-cy">hashing…</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))}
                    className="rounded p-1 text-dim transition-colors hover:bg-raise hover:text-red" aria-label="Remove attachment">
                    <IcX size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* recipients + scenario */}
        <section className="panel anim-rise p-5" style={{ animationDelay: "120ms" }}>
          <h2 className="mb-3 font-disp text-lg font-bold text-fog">Seed recipients · strict allowlist</h2>
          <div className="flex flex-wrap gap-2">
            {mailboxes.map((m) => {
              const allowed = allowSet.has(normalizeEmail(m.address));
              const ok = m.status === "connected" && allowed;
              return (
                <span key={m.id} className={cx(
                  "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[11.5px]",
                  ok ? "border-grn/30 bg-grn/8 text-fog" : "border-edge bg-pit/60 text-mut"
                )}>
                  <Lamp size={6} pulse={false} state={ok ? "ok" : m.status === "connected" ? "warn" : "off"} />
                  <span style={{ color: PROVIDER_META[m.provider].dot }}>■</span>
                  {m.address}
                  {m.status !== "connected" && <span className="text-dim">· not connected</span>}
                  {m.status === "connected" && !allowed && <span className="text-amb">· not allowlisted</span>}
                </span>
              );
            })}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-dim">
            The server-side gate rejects every address outside the allowlist. Employer addresses are
            structurally unreachable from the send path — the final application stays a manual send by you.
          </p>

          {isLiveBackend ? (
            <div className="mt-4 border-t border-edge pt-4">
              <p className="flex items-center gap-2 text-[11.5px] text-mut">
                <IcLock size={12} className="text-grn/80" />
                Live pipeline active — the backend sends via Zoho SMTP and polls the connected seed inboxes. Scenario injection is disabled for real runs.
              </p>
            </div>
          ) : (
          <div className="mt-4 border-t border-edge pt-4">
            <label className="lbl" htmlFor="pf-scenario">Scenario injector · demo telemetry</label>
            <select id="pf-scenario" className="inp" value={scenario}
              onChange={(e) => setScenario(e.target.value as ScenarioId)}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11.5px] text-dim">{scenarioMeta.desc}</p>
          </div>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ right: run console */}
      <div className="space-y-5 lg:sticky lg:top-[86px] lg:self-start">
        <section className="panel panel-notch anim-rise overflow-hidden" style={{ animationDelay: "80ms" }}>
          <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <IcRadar size={17} className={phase === "running" ? "text-cy" : "text-dim"} />
              <h2 className="font-disp text-lg font-bold text-fog">Run console</h2>
            </div>
            {phase === "running" ? (
              <Btn variant="danger" size="sm" onClick={() => ctrlRef.current?.cancel()}>
                <IcStop size={13} /> Abort
              </Btn>
            ) : phase === "done" ? (
              <div className="flex gap-2">
                <Btn size="sm" onClick={() => { if (live?.testId) { void navigator.clipboard?.writeText(live.testId); toast("Test ID copied"); } }}>
                  <IcCopy size={13} /> {live?.testId}
                </Btn>
                <Btn variant="primary" size="sm" onClick={reset}>
                  <IcPlay size={13} /> New run
                </Btn>
              </div>
            ) : (
              <Btn variant="primary" size="lg" disabled={!canRun} onClick={run}
                className="font-disp tracking-wide">
                <IcPlay size={15} /> Run preflight test
              </Btn>
            )}
          </div>

          {phase === "idle" && (
            <div className="p-5">
              <div className="mb-4 grid place-items-center rounded-lg border border-edge bg-pit/50 py-6">
                <div className="relative grid h-16 w-16 place-items-center">
                  <span className="absolute inset-0 rounded-full border border-cy/20" />
                  <span className="absolute inset-3 rounded-full border border-cy/15" />
                  <IcRadar size={30} className="text-cy/70" />
                </div>
                <div className="mt-3 font-disp text-sm font-bold tracking-[0.24em] text-mut">AWAITING RUN</div>
                <p className="mt-1 max-w-xs text-center text-[12px] text-dim">
                  The package is sent only to your seed inboxes, then polled, parsed and verified automatically.
                </p>
              </div>
              <div className="lbl">Package readiness</div>
              <ul className="space-y-2">
                <ReadinessRow ok={readiness.employer} label="Employer name" />
                <ReadinessRow ok={readiness.role} label="Role title" />
                <ReadinessRow ok={readiness.subject} label="Subject line" />
                <ReadinessRow ok={readiness.body} label="Cover-letter body" detail={`${body.trim().length}/40 chars`} />
                <ReadinessRow ok={readiness.attachments} label="Resume PDF attached & hashed"
                  detail={files.length ? `${files.length}/2 files` : "0/2 files"} />
                <ReadinessRow ok={readiness.seeds} warn={readyBoxes.length > 0 && readyBoxes.length < settings.requiredChecks}
                  label={`Seed inboxes ready (need ≥ ${settings.requiredChecks} for a safe verdict)`}
                  detail={`${readyBoxes.length} ready`} />
              </ul>
              {!canRun && (
                <p className="mt-4 flex items-start gap-2 rounded-lg border border-amb/25 bg-amb/6 px-3 py-2.5 text-[12px] text-amb">
                  <IcAlert size={14} className="mt-0.5 shrink-0" />
                  Complete the checklist to arm the console. Unchecked items are missing or incomplete.
                </p>
              )}
            </div>
          )}

          {phase === "running" && live && (
            <div className="p-5">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-mono text-[11px] text-cy">{live.testId}</span>
                <span className="font-mono text-[11px] text-dim">timeout {settings.timeoutSec}s · scenario: {live.scenario}</span>
              </div>
              <ProgressBar pct={progress} tone="cy" />
              <div className="mt-4 space-y-3">
                {live.seedResults.map((r, i) => (
                  <div key={r.mailboxId + i} className="rounded-lg border border-edge bg-pit/50 p-3">
                    <div className="mb-2 flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: PROVIDER_META[r.provider].dot }} />
                      <span className="font-mono text-[12px] text-fog">{r.address}</span>
                      <span className="ml-auto">
                        <Lamp state={
                          !r.checkable ? "off" :
                          r.steps.some((s) => s.state === "fail") ? "fail" :
                          r.steps.some((s) => s.state === "active") ? "live" :
                          r.steps.length > 0 && r.steps.every((s) => s.state === "pass") ? "ok" :
                          r.steps.some((s) => s.state === "warn") ? "warn" : "off"
                        } />
                      </span>
                    </div>
                    {!r.checkable ? (
                      <p className="font-mono text-[11px] text-dim">skipped — {r.skipReason}</p>
                    ) : (
                      <ul className="space-y-1">
                        {r.steps.map((s) => (
                          <li key={s.id} className="flex items-center gap-2 font-mono text-[11px]">
                            <span className={cx(
                              s.state === "pass" ? "text-grn" : s.state === "fail" ? "text-red" :
                              s.state === "warn" ? "text-amb" : s.state === "active" ? "text-cy" : "text-dim"
                            )}>
                              {s.state === "pass" ? "✓" : s.state === "fail" ? "✗" : s.state === "warn" ? "!" : s.state === "active" ? "▸" : "·"}
                            </span>
                            <span className={cx(s.state === "pending" ? "text-dim" : s.state === "skip" ? "text-dim line-through" : "text-mut")}>
                              {s.label}
                            </span>
                            {s.detail && <span className="ml-auto truncate text-[10px] text-dim">{s.detail}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <div className="lbl">Wire log</div>
                <div ref={logRef} className="h-36 overflow-y-auto rounded-lg border border-edge bg-pit/80 p-3 font-mono text-[11px] leading-relaxed text-mut">
                  {live.log.map((l, i) => (
                    <div key={i} className="anim-log whitespace-pre-wrap">{l}</div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {phase === "done" && live && live.status === "cancelled" && (
            <div className="p-6 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-amb/40 bg-amb/10">
                <IcStop size={18} className="text-amb" />
              </div>
              <div className="mt-3 font-disp text-lg font-bold tracking-[0.18em] text-amb">RUN ABORTED</div>
              <p className="mx-auto mt-1 max-w-xs text-[12.5px] text-mut">
                The preflight was cancelled before completion — no verdict was recorded and nothing was archived.
              </p>
            </div>
          )}

          {phase === "done" && live && live.status !== "cancelled" && (
            <div className="border-t border-edge p-4">
              <RunReport run={live} compact />
              {live.status === "complete" && (
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-pit/50 p-3">
                  <IcLink size={15} className="text-cy" />
                  <span className="text-[12.5px] text-mut">Link this run to an application:</span>
                  <select className="inp !w-auto !py-1.5 text-[12.5px]" value={linkAppId} onChange={(e) => setLinkAppId(e.target.value)}>
                    <option value="">choose…</option>
                    {apps.map((a) => (
                      <option key={a.id} value={a.id}>{a.employer} — {a.role}</option>
                    ))}
                  </select>
                  <Btn size="sm" variant="primary" disabled={!linkAppId}
                    onClick={() => { if (linkAppId) { onLinkApp(linkAppId, live); toast("Run linked to application"); setLinkAppId(""); } }}>
                    <IcCheck size={13} /> Link
                  </Btn>
                </div>
              )}
            </div>
          )}
        </section>

        {phase === "idle" && (
          <section className="panel anim-rise p-5" style={{ animationDelay: "160ms" }}>
            <h3 className="mb-2.5 font-disp text-[15px] font-bold text-fog">What a run does — automatically</h3>
            <ol className="space-y-1.5 text-[12.5px] text-mut">
              {[
                "Sends the exact package to allowlisted seed inboxes via Zoho SMTP, with a TEST subject prefix and a unique X-Preflight-Test-Id header.",
                "Polls each seed inbox over OAuth/IMAP until the message is found or the timeout expires.",
                "Classifies placement — Inbox, Spam/Junk, Promotions or other categories.",
                "Extracts and grades SPF, DKIM and DMARC from the received headers.",
                "Re-hashes attachments and compares file name, size and SHA-256 against your upload.",
                "Combines everything into one verdict: Safe to send · Review needed · Do not send.",
              ].map((t, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="font-mono text-[10.5px] text-cy">{String(i + 1).padStart(2, "0")}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
      </div>
    </div>
  );
}
