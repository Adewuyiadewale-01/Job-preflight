import { useMemo, useState } from "react";
import type {
  JobApplication,
  PreflightRun,
  ReplyStatus,
  Settings,
} from "../lib/types";
import {
  addBusinessDays,
  businessDaysBetween,
  cx,
  fmtDate,
  fmtDateFull,
  isEmailAddress,
  normalizeEmail,
  todayIso,
  uid,
} from "../lib/utils";
import { RunReport } from "../components/RunReport";
import {
  Btn,
  Chip,
  EmptyState,
  IcBrief,
  IcCheck,
  IcClock,
  IcInbox,
  IcMail,
  IcPen,
  IcPlus,
  IcRadar,
  IcTrash,
  Lamp,
  Modal,
  SectionHead,
  toast,
  VerdictPill,
} from "../components/ui";

interface Draft {
  id?: string;
  employer: string;
  role: string;
  contactEmail: string;
  subject: string;
  notes: string;
}
const emptyDraft: Draft = { employer: "", role: "", contactEmail: "", subject: "", notes: "" };

const REPLY_LABEL: Record<ReplyStatus, string> = {
  none: "no reply",
  replied: "replied",
  interview: "interview",
  rejected: "rejected",
};

export function ApplicationsPage({
  apps,
  setApps,
  runs,
  settings,
  onPrepare,
}: {
  apps: JobApplication[];
  setApps: (updater: (xs: JobApplication[]) => JobApplication[]) => void;
  runs: PreflightRun[];
  settings: Settings;
  onPrepare: (app: JobApplication) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draftErr, setDraftErr] = useState("");
  const [replyFor, setReplyFor] = useState<JobApplication | null>(null);
  const [viewRun, setViewRun] = useState<PreflightRun | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const today = todayIso();

  const followUps = useMemo(
    () =>
      apps
        .filter((a) => a.status === "sent" && a.replyStatus === "none" && a.followUpDate)
        .sort((a, b) => (a.followUpDate! < b.followUpDate! ? -1 : 1)),
    [apps]
  );

  const stats = useMemo(() => {
    const linkedRun = (a: JobApplication) => runs.find((r) => r.id === a.preflightRunId);
    return {
      drafts: apps.filter((a) => a.status !== "sent").length,
      sent: apps.filter((a) => a.status === "sent").length,
      replies: apps.filter((a) => a.replyStatus !== "none").length,
      overdue: followUps.filter((a) => a.followUpDate! < today).length,
      lastVerdict: runs.find((r) => r.status === "complete")?.report?.verdict,
      linkedRun,
    };
  }, [apps, runs, followUps, today]);

  const saveDraft = () => {
    if (!draft.employer.trim() || !draft.role.trim() || !draft.subject.trim()) {
      setDraftErr("Employer, role and subject are required.");
      return;
    }
    if (draft.contactEmail.trim() && !isEmailAddress(draft.contactEmail)) {
      setDraftErr("Contact email is not a valid address.");
      return;
    }
    setApps((xs) => {
      if (draft.id) {
        return xs.map((a) =>
          a.id === draft.id
            ? {
                ...a,
                employer: draft.employer.trim(),
                role: draft.role.trim(),
                contactEmail: draft.contactEmail.trim(),
                subject: draft.subject.trim(),
                notes: draft.notes.trim(),
              }
            : a
        );
      }
      const app: JobApplication = {
        id: uid("app"),
        employer: draft.employer.trim(),
        role: draft.role.trim(),
        contactEmail: draft.contactEmail.trim(),
        subject: draft.subject.trim(),
        notes: draft.notes.trim(),
        status: "draft",
        replyStatus: "none",
        createdAt: new Date().toISOString(),
      };
      return [app, ...xs];
    });
    toast(draft.id ? "Application updated" : "Application added to the pipeline");
    setEditorOpen(false);
    setDraft(emptyDraft);
    setDraftErr("");
  };

  const markSent = (app: JobApplication) => {
    const safeRun =
      runs.find(
        (r) =>
          r.status === "complete" &&
          r.report?.verdict === "safe" &&
          normalizeEmail(r.input.employer) === normalizeEmail(app.employer)
      ) ?? runs.find((r) => r.status === "complete" && r.report?.verdict === "safe");
    const followUp = addBusinessDays(today, settings.followUpBusinessDays);
    setApps((xs) =>
      xs.map((a) =>
        a.id === app.id
          ? {
              ...a,
              status: "sent",
              sentDate: today,
              followUpDate: followUp,
              preflightRunId: a.preflightRunId ?? safeRun?.id,
            }
          : a
      )
    );
    toast(`Marked as sent manually — follow-up queued for ${fmtDateFull(followUp)}`);
  };

  const setReply = (app: JobApplication, status: ReplyStatus) => {
    setApps((xs) => xs.map((a) => (a.id === app.id ? { ...a, replyStatus: status } : a)));
    setReplyFor(null);
    toast(status === "none" ? "Reply status cleared" : `Logged: ${REPLY_LABEL[status]}`);
  };

  const remove = (app: JobApplication) => {
    if (armedDelete !== app.id) {
      setArmedDelete(app.id);
      setTimeout(() => setArmedDelete((v) => (v === app.id ? null : v)), 2600);
      return;
    }
    setApps((xs) => xs.filter((a) => a.id !== app.id));
    setArmedDelete(null);
    toast("Application removed", "warn");
  };

  const daysTo = (d: string) => businessDaysBetween(today, d);

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------ dashboard */}
      <section className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="panel panel-notch anim-rise overflow-hidden">
          <div className="flex items-center justify-between border-b border-edge px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <IcClock size={16} className="text-cy" />
              <h2 className="font-disp text-lg font-bold text-fog">Follow-up queue</h2>
            </div>
            <Chip tone={stats.overdue > 0 ? "fail" : "neutral"}>
              {stats.overdue > 0 ? `${stats.overdue} overdue` : "on schedule"}
            </Chip>
          </div>
          {followUps.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={<IcCheck size={26} />}
                title="Nothing waiting on a follow-up"
                hint="Applications you mark as sent manually get a reminder five business days out (configurable in Settings), unless a reply is logged."
              />
            </div>
          ) : (
            <ul>
              {followUps.map((a, i) => {
                const d = daysTo(a.followUpDate!);
                const label = d < 0 ? `overdue ${-d} bd` : d === 0 ? "today" : `in ${d} bd`;
                return (
                  <li key={a.id} className="anim-rise tick-row flex flex-wrap items-center gap-3 border-b border-edge/60 px-5 py-3 last:border-0"
                    style={{ animationDelay: `${i * 50}ms` }}>
                    <Lamp size={8} pulse={false} state={d < 0 ? "fail" : d === 0 ? "warn" : "ok"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-fog">
                        {a.employer} <span className="text-mut">· {a.role}</span>
                      </div>
                      <div className="font-mono text-[10.5px] text-dim">
                        sent {fmtDate(a.sentDate)} · follow-up {fmtDate(a.followUpDate)}
                      </div>
                    </div>
                    <Chip tone={d < 0 ? "fail" : d === 0 ? "warn" : "neutral"}>{label}</Chip>
                    <Btn size="sm" variant="ok" onClick={() => setReplyFor(a)}>
                      <IcMail size={13} /> Log reply
                    </Btn>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 content-start gap-3">
          {[
            { label: "in pipeline", value: stats.drafts, icon: <IcBrief size={15} />, tone: "text-cy" },
            { label: "sent manually", value: stats.sent, icon: <IcInbox size={15} />, tone: "text-grn" },
            { label: "replies logged", value: stats.replies, icon: <IcMail size={15} />, tone: "text-amb" },
            { label: "preflight runs", value: runs.length, icon: <IcRadar size={15} />, tone: "text-cy" },
          ].map((s, i) => (
            <div key={s.label} className="panel anim-rise p-4" style={{ animationDelay: `${i * 60}ms` }}>
              <div className={cx("mb-2 inline-flex rounded-md border border-edge bg-pit/60 p-1.5", s.tone)}>{s.icon}</div>
              <div className="font-disp text-3xl font-bold leading-none text-fog">{s.value}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-dim">{s.label}</div>
            </div>
          ))}
          <div className="panel anim-rise col-span-2 flex items-center justify-between p-4" style={{ animationDelay: "260ms" }}>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">latest verdict</span>
            {stats.lastVerdict ? <VerdictPill verdict={stats.lastVerdict} size="sm" /> : <Chip tone="neutral">no runs yet</Chip>}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ pipeline */}
      <section>
        <SectionHead
          kicker="tracker"
          title="Application pipeline"
          right={
            <Btn variant="primary" onClick={() => { setDraft(emptyDraft); setDraftErr(""); setEditorOpen(true); }}>
              <IcPlus size={14} /> New application
            </Btn>
          }
        />
        {apps.length === 0 ? (
          <EmptyState
            icon={<IcBrief size={26} />}
            title="No applications yet"
            hint="Add the jobs you're targeting. Each entry can carry a linked preflight run, a manual-send date and follow-up reminders."
            action={
              <Btn variant="primary" onClick={() => { setDraft(emptyDraft); setEditorOpen(true); }}>
                <IcPlus size={14} /> Add your first application
              </Btn>
            }
          />
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <thead>
                <tr className="border-b border-edge font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
                  <th className="px-5 py-3 font-medium">Employer · Role</th>
                  <th className="px-3 py-3 font-medium">Contact</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Preflight</th>
                  <th className="px-3 py-3 font-medium">Follow-up</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((a, i) => {
                  const linked = stats.linkedRun(a);
                  const d = a.followUpDate ? daysTo(a.followUpDate) : null;
                  return (
                    <tr key={a.id} className="anim-rise tick-row border-b border-edge/60 last:border-0" style={{ animationDelay: `${i * 40}ms` }}>
                      <td className="px-5 py-3.5">
                        <div className="text-[13.5px] font-semibold text-fog">{a.employer}</div>
                        <div className="text-[12px] text-mut">{a.role}</div>
                      </td>
                      <td className="px-3 py-3.5 font-mono text-[11.5px] text-mut">{a.contactEmail || "—"}</td>
                      <td className="px-3 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          <Chip tone={a.status === "sent" ? "ok" : a.status === "preflight" ? "info" : "neutral"}>
                            {a.status}
                          </Chip>
                          {a.replyStatus !== "none" && (
                            <Chip tone={a.replyStatus === "rejected" ? "fail" : a.replyStatus === "interview" ? "ok" : "info"}>
                              {REPLY_LABEL[a.replyStatus]}
                            </Chip>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {linked ? (
                          <button onClick={() => setViewRun(linked)} className="transition-transform hover:scale-[1.03]">
                            <VerdictPill verdict={linked.report?.verdict ?? "review"} size="sm" />
                          </button>
                        ) : (
                          <Chip tone="neutral">no run</Chip>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        {a.status === "sent" && a.replyStatus === "none" && a.followUpDate ? (
                          <span className={cx("font-mono text-[11.5px]", d! < 0 ? "text-red" : d === 0 ? "text-amb" : "text-mut")}>
                            {fmtDate(a.followUpDate)}
                            {d! < 0 ? ` · +${-d!}d` : ""}
                          </span>
                        ) : (
                          <span className="text-[12px] text-dim">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Btn size="sm" onClick={() => onPrepare(a)} title="Load package into the preflight console">
                            <IcRadar size={13} /> Preflight
                          </Btn>
                          {a.status !== "sent" ? (
                            <Btn size="sm" variant="primary" onClick={() => markSent(a)}>
                              <IcInbox size={13} /> Mark sent manually
                            </Btn>
                          ) : (
                            <Btn size="sm" variant="ok" onClick={() => setReplyFor(a)}>
                              <IcMail size={13} /> Log reply
                            </Btn>
                          )}
                          <Btn size="sm" onClick={() => { setDraft({ id: a.id, employer: a.employer, role: a.role, contactEmail: a.contactEmail, subject: a.subject, notes: a.notes }); setDraftErr(""); setEditorOpen(true); }} aria-label="Edit application">
                            <IcPen size={13} />
                          </Btn>
                          <Btn size="sm" variant={armedDelete === a.id ? "danger" : "ghost"} onClick={() => remove(a)} aria-label="Delete application">
                            <IcTrash size={13} />
                            {armedDelete === a.id && "Sure?"}
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ history */}
      <section>
        <SectionHead kicker="evidence" title="Preflight history" />
        {runs.length === 0 ? (
          <EmptyState
            icon={<IcRadar size={26} />}
            title="No preflight runs yet"
            hint="Completed runs are archived here with their full per-seed evidence — delivery, placement, authentication and attachment checks."
          />
        ) : (
          <div className="panel overflow-hidden">
            <ul>
              {runs.map((r, i) => (
                <li key={r.id} className="anim-rise tick-row flex flex-wrap items-center gap-3 border-b border-edge/60 px-5 py-3 last:border-0" style={{ animationDelay: `${i * 40}ms` }}>
                  <Lamp size={8} pulse={false} state={r.report?.verdict === "safe" ? "ok" : r.report?.verdict === "review" ? "warn" : r.report?.verdict === "block" ? "fail" : "off"} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-fog">
                      {r.input.employer} <span className="text-mut">· {r.input.role}</span>
                    </div>
                    <div className="font-mono text-[10.5px] text-dim">
                      {r.testId} · {fmtDateFull(r.startedAt)} · {r.recipients.length} seed(s)
                      {r.status === "cancelled" && " · cancelled"}
                    </div>
                  </div>
                  {r.report && <VerdictPill verdict={r.report.verdict} size="sm" />}
                  <Btn size="sm" onClick={() => setViewRun(r)}>
                    Evidence
                  </Btn>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ modals */}
      <Modal open={editorOpen} onClose={() => setEditorOpen(false)} kicker="tracker" title={draft.id ? "Edit application" : "New application"}>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="lbl">Employer *</label>
            <input className="inp" value={draft.employer} onChange={(e) => setDraft({ ...draft, employer: e.target.value })} placeholder="Helios Labs" />
          </div>
          <div>
            <label className="lbl">Role *</label>
            <input className="inp" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} placeholder="Automation Developer" />
          </div>
          <div>
            <label className="lbl">Contact email</label>
            <input className="inp" value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} placeholder="jobs@helios.dev" />
          </div>
          <div>
            <label className="lbl">Subject line *</label>
            <input className="inp" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Jane Doe — Automation Developer" />
          </div>
          <div className="sm:col-span-2">
            <label className="lbl">Notes</label>
            <textarea className="inp resize-y" rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Referral, hiring manager, talking points…" />
          </div>
        </div>
        {draftErr && <p className="mt-2 text-[12.5px] text-red">{draftErr}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => setEditorOpen(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={saveDraft}>
            <IcCheck size={14} /> {draft.id ? "Save changes" : "Add application"}
          </Btn>
        </div>
      </Modal>

      <Modal open={replyFor !== null} onClose={() => setReplyFor(null)} kicker="tracker" title={`Log reply — ${replyFor?.employer ?? ""}`}>
        <p className="mb-3 text-[13px] text-mut">
          Recording a reply removes this application from the follow-up queue.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(["replied", "interview", "rejected"] as ReplyStatus[]).map((s) => (
            <button key={s} onClick={() => replyFor && setReply(replyFor, s)}
              className={cx(
                "rounded-lg border px-3 py-3 text-sm font-medium transition-all hover:-translate-y-0.5",
                s === "rejected"
                  ? "border-red/30 bg-red/8 text-red hover:bg-red/15"
                  : "border-grn/30 bg-grn/8 text-grn hover:bg-grn/15"
              )}>
              {REPLY_LABEL[s]}
            </button>
          ))}
        </div>
        {replyFor?.replyStatus !== "none" && (
          <div className="mt-3 text-right">
            <Btn size="sm" onClick={() => replyFor && setReply(replyFor, "none")}>Clear reply status</Btn>
          </div>
        )}
      </Modal>

      <Modal open={viewRun !== null} onClose={() => setViewRun(null)} kicker="evidence" title={`Preflight run · ${viewRun?.testId ?? ""}`} width="max-w-3xl">
        {viewRun && <RunReport run={viewRun} compact />}
      </Modal>
    </div>
  );
}
