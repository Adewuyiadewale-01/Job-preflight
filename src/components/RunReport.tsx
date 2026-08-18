import { useState } from "react";
import type { AuthResult, PreflightRun, SeedResult } from "../lib/types";
import { DISCLAIMER, VERDICT_META } from "../lib/verdict";
import { PROVIDER_META } from "../lib/store";
import { cx, fmtBytes, fmtDateFull, fmtClock, shortSha } from "../lib/utils";
import { Chip, IcChev, IcCheck, IcShield, IcDoc, IcAlert, Lamp, type LampState } from "./ui";

const toneOf = (r: AuthResult): "ok" | "warn" | "fail" =>
  r === "pass" ? "ok" : r === "fail" || r === "softfail" ? "fail" : "warn";

function AuthChips({ r }: { r: SeedResult }) {
  if (!r.auth) return <Chip tone="neutral">no auth data</Chip>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {(["spf", "dkim", "dmarc"] as const).map((k) => (
        <Chip key={k} tone={toneOf(r.auth![k])}>
          {k} {r.auth![k]}
        </Chip>
      ))}
    </span>
  );
}

function SeedRow({ r, delay }: { r: SeedResult; delay: number }) {
  const [open, setOpen] = useState(false);
  const lamp: LampState =
    r.outcome === "pass" ? "ok" : r.outcome === "warn" ? "warn" : r.outcome === "fail" ? "fail" : "off";
  const meta = PROVIDER_META[r.provider];

  return (
    <div className="anim-rise border-b border-edge/70 last:border-0" style={{ animationDelay: `${delay}ms` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="tick-row flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ background: meta.dot }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fog">
            {meta.label} <span className="font-mono text-[12px] text-mut">· {r.address}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {r.checkable ? (
              <>
                <Chip tone={r.folder === "inbox" ? "ok" : r.folder === "spam" ? "fail" : "warn"}>
                  {r.delivery === "missing"
                    ? "missing"
                    : r.delivery === "bounced"
                      ? "bounced"
                      : r.folder ?? "—"}
                </Chip>
                <AuthChips r={r} />
                <Chip tone={r.attachments.every((a) => a.found && a.sizeMatch && a.hashMatch) && r.attachments.length > 0 ? "ok" : r.attachments.length === 0 ? "neutral" : "fail"}>
                  <IcDoc size={11} />
                  {r.attachments.filter((a) => a.found && a.sizeMatch && a.hashMatch).length}/{r.attachments.length} pdf
                </Chip>
                {r.latencySec !== null && <Chip tone="neutral">{r.latencySec}s</Chip>}
              </>
            ) : (
              <Chip tone="warn">not checkable — {r.skipReason}</Chip>
            )}
          </div>
        </div>
        <Lamp state={lamp} />
        <IcChev size={15} className={cx("text-dim transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div className="anim-fade grid gap-4 px-4 pb-4 pt-1 md:grid-cols-2">
          <div>
            <div className="lbl">Check sequence</div>
            {r.steps.length === 0 ? (
              <p className="text-[13px] text-mut">
                Skipped — {r.skipReason ?? "mailbox unavailable"}. Connect it under Seed Mailboxes to include
                this provider in the verdict.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {r.steps.map((s) => (
                  <li key={s.id} className="flex items-center gap-2.5 text-[13px]">
                    <Lamp
                      size={7}
                      pulse={false}
                      state={
                        s.state === "pass" ? "ok" : s.state === "fail" ? "fail" : s.state === "warn" ? "warn" : s.state === "active" ? "live" : "off"
                      }
                    />
                    <span className={cx(s.state === "skip" ? "text-dim line-through" : "text-fog")}>{s.label}</span>
                    {s.detail && <span className="ml-auto font-mono text-[11px] text-mut">{s.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
            {r.attachments.length > 0 && (
              <div className="mt-3">
                <div className="lbl">Attachment validation</div>
                <ul className="space-y-1">
                  {r.attachments.map((a) => {
                    const ok = a.found && a.sizeMatch && a.hashMatch;
                    return (
                      <li key={a.name} className="flex items-start gap-2 text-[12.5px]">
                        <span className={ok ? "text-grn" : "text-red"}>
                          {ok ? <IcCheck size={13} /> : <IcAlert size={13} />}
                        </span>
                        <span className="min-w-0">
                          <span className="font-medium text-fog">{a.name}</span>
                          <span className="block font-mono text-[11px] text-mut">
                            {fmtBytes(a.expectedSize)} · sha256 {shortSha(a.expectedSha)}
                            {!a.found && " · NOT FOUND"}
                            {a.found && !a.sizeMatch && " · SIZE MISMATCH"}
                            {a.found && a.sizeMatch && !a.hashMatch && " · HASH MISMATCH"}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
          <div>
            <div className="lbl">Received headers (extract)</div>
            {r.headerSnippet ? (
              <pre className="overflow-x-auto rounded-lg border border-edge bg-pit/80 p-3 font-mono text-[11px] leading-relaxed text-mut">
                {r.headerSnippet}
              </pre>
            ) : (
              <p className="text-[13px] text-mut">No message received — no headers to extract.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function RunReport({ run, compact = false }: { run: PreflightRun; compact?: boolean }) {
  const v = run.report?.verdict ?? "review";
  const meta = VERDICT_META[v];
  const toneBorder = v === "safe" ? "border-l-grn" : v === "review" ? "border-l-amb" : "border-l-red";
  const toneText = v === "safe" ? "text-grn" : v === "review" ? "text-amb" : "text-red";
  const reasons = run.report?.reasons ?? [];

  return (
    <div className="space-y-4">
      {/* verdict banner */}
      <div className={cx("panel panel-notch border-l-4 p-5", toneBorder)}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-dim">
              automated preflight verdict · {run.testId}
            </div>
            <div className={cx("font-disp font-bold leading-none mt-2", toneText, compact ? "text-3xl" : "text-4xl md:text-5xl")}>
              {meta.label.toUpperCase()}
            </div>
            <p className="mt-2 max-w-xl text-[13.5px] text-mut">{meta.blurb}</p>
          </div>
          <div
            className={cx(
              "anim-stamp shrink-0 rounded-md border-[3px] px-4 py-2 font-disp text-sm font-bold tracking-[0.22em]",
              v === "safe" && "border-grn/70 text-grn",
              v === "review" && "border-amb/70 text-amb",
              v === "block" && "border-red/70 text-red"
            )}
          >
            {meta.stamp}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-dim">
          <span>started {fmtDateFull(run.startedAt)} {fmtClock(run.startedAt)}</span>
          <span>seeds {run.recipients.length}</span>
          <span>timeout {run.timeoutSec}s</span>
          <span>findings {reasons.length}</span>
        </div>
      </div>

      {/* reasons + next actions */}
      {reasons.length > 0 ? (
        <div className="panel overflow-hidden">
          <div className="border-b border-edge px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">
            findings · why this is not a clean pass
          </div>
          <ul>
            {reasons.map((r, i) => (
              <li key={i} className="anim-rise border-b border-edge/60 px-4 py-3 last:border-0" style={{ animationDelay: `${i * 70}ms` }}>
                <div className="flex items-start gap-3">
                  <Lamp state={r.severity === "block" ? "fail" : "warn"} size={8} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-dim">{r.code}</span>
                      <span className="text-[13.5px] text-fog">{r.message}</span>
                    </div>
                    <div className="mt-1 text-[12.5px] text-mut">
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-cy/80">next action → </span>
                      {r.action}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="panel flex items-center gap-3 border-l-4 border-l-grn px-4 py-3">
          <IcShield size={18} className="text-grn" />
          <p className="text-[13.5px] text-mut">
            <span className="font-medium text-grn">No findings.</span> Every required seed inbox received the
            package in its primary Inbox with intact attachments and passing SPF, DKIM and DMARC.
          </p>
        </div>
      )}

      {/* per-seed breakdown */}
      <div className="panel overflow-hidden">
        <div className="border-b border-edge px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-dim">
          seed mailbox results · click a row for the full check sequence
        </div>
        {run.seedResults.map((r, i) => (
          <SeedRow key={r.mailboxId + i} r={r} delay={i * 60} />
        ))}
      </div>

      <p className="flex items-start gap-2 px-1 text-[11.5px] text-dim">
        <IcAlert size={13} className="mt-0.5 shrink-0 text-amb/70" />
        {DISCLAIMER} The final application to the employer is always sent manually by you.
      </p>
    </div>
  );
}
