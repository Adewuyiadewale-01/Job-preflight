import { useState } from "react";
import type { JobApplication, PreflightRun, SeedMailbox, Settings } from "../lib/types";
import { cx, downloadText, isEmailAddress, normalizeEmail } from "../lib/utils";
import {
  Btn,
  Chip,
  IcAlert,
  IcCheck,
  IcPlus,
  IcShield,
  IcTrash,
  IcX,
  SectionHead,
  Switch,
  toast,
} from "../components/ui";

const ENV_TEMPLATE = `# --- Zoho SMTP (server-side only, never shipped to the browser) ---
ZOHO_SMTP_HOST=smtp.zoho.com
ZOHO_SMTP_PORT=465
ZOHO_SMTP_USER=you@yourdomain.dev
ZOHO_SMTP_PASSWORD=          # app-specific password
MAIL_FROM="Jane Doe <you@yourdomain.dev>"

# --- strict seed recipient allowlist (comma separated) ---
TEST_RECIPIENT_ALLOWLIST=seed1@gmail.com,seed2@outlook.com

# --- storage & secrets ---
DATABASE_URL=file:./dev.db
APP_ENCRYPTION_KEY=          # 32-byte key for token encryption at rest

# --- seed mailbox OAuth apps ---
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
MICROSOFT_OAUTH_CLIENT_ID=
MICROSOFT_OAUTH_CLIENT_SECRET=`;

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="lbl">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="inp !w-24 font-mono"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
          }}
        />
        {suffix && <span className="font-mono text-[11.5px] text-dim">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] text-dim">{hint}</p>}
    </div>
  );
}

function SelField({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
  hint?: string;
}) {
  return (
    <div>
      <label className="lbl">{label}</label>
      <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {hint && <p className="mt-1 text-[11px] text-dim">{hint}</p>}
    </div>
  );
}

export function SettingsPage({
  settings,
  setSettings,
  mailboxes,
  applications,
  runs,
  onResetDemo,
  onWipeAll,
}: {
  settings: Settings;
  setSettings: (updater: (s: Settings) => Settings) => void;
  mailboxes: SeedMailbox[];
  applications: JobApplication[];
  runs: PreflightRun[];
  onResetDemo: () => void;
  onWipeAll: () => void;
}) {
  const [newAddr, setNewAddr] = useState("");
  const [addrErr, setAddrErr] = useState("");
  const [armedWipe, setArmedWipe] = useState(false);
  const up = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  const addAddress = () => {
    const a = normalizeEmail(newAddr);
    if (!isEmailAddress(a)) {
      setAddrErr("Not a valid email address.");
      return;
    }
    if (settings.allowlist.includes(a)) {
      setAddrErr("Already on the allowlist.");
      return;
    }
    setAddrErr("");
    setNewAddr("");
    up({ allowlist: [...settings.allowlist, a] });
    toast("Address added to the recipient allowlist");
  };

  const exportAll = () => {
    downloadText(
      `mail-preflight-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), settings, mailboxes, applications, runs }, null, 2)
    );
    toast("Workspace exported as JSON");
  };

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------ verdict thresholds */}
      <section>
        <SectionHead kicker="verdict engine" title="Verdict thresholds" />
        <div className="panel panel-notch anim-rise p-5">
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-3">
            <NumField label="Seed wait timeout" value={settings.timeoutSec} min={6} max={180} suffix="sec"
              hint="How long each seed inbox is polled before a message is declared missing." onChange={(n) => up({ timeoutSec: n })} />
            <NumField label="Required clean checks" value={settings.requiredChecks} min={1} max={4} suffix="mailboxes"
              hint="Minimum seed results needed before a Safe verdict is even possible." onChange={(n) => up({ requiredChecks: n })} />
            <div>
              <label className="lbl">Coverage policy</label>
              <div className="rounded-lg border border-edge bg-pit/50 px-3.5 py-3">
                <Switch checked={settings.requireAllConnected} onChange={(v) => up({ requireAllConnected: v })}
                  label="Uncheckable providers force Review" />
              </div>
            </div>
            <SelField label="Promotions placement counts as" value={settings.promotionsAs}
              onChange={(v) => up({ promotionsAs: v as Settings["promotionsAs"] })}
              options={[["review", "Review needed"], ["block", "Do not send"]]} />
            <SelField label="Updates / other category counts as" value={settings.updatesAs}
              onChange={(v) => up({ updatesAs: v as Settings["updatesAs"] })}
              options={[["review", "Review needed"], ["block", "Do not send"]]} />
            <SelField label="DMARC 'none' counts as" value={settings.dmarcNoneAs}
              onChange={(v) => up({ dmarcNoneAs: v as Settings["dmarcNoneAs"] })}
              options={[["review", "Review needed (incomplete)"], ["block", "Do not send"]]}
              hint="SPF/DKIM/DMARC hard failures always block, regardless of this setting." />
            <div>
              <label className="lbl">DKIM policy</label>
              <div className="rounded-lg border border-edge bg-pit/50 px-3.5 py-3">
                <Switch checked={settings.requireDkim} onChange={(v) => up({ requireDkim: v })}
                  label="Require a DKIM result on every seed" />
              </div>
            </div>
          </div>
          <div className="mt-5 grid gap-2 border-t border-edge pt-4 text-[12px] text-mut md:grid-cols-3">
            <p><Chip tone="ok" className="mr-1.5">safe</Chip> all required seeds: primary Inbox, attachments intact, SPF+DKIM+DMARC pass.</p>
            <p><Chip tone="warn" className="mr-1.5">review</Chip> non-primary placement, uncheckable provider, incomplete auth or thin evidence.</p>
            <p><Chip tone="fail" className="mr-1.5">block</Chip> missing, bounced, spam placement, attachment mismatch or auth failure.</p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ allowlist */}
      <section>
        <SectionHead kicker="send gate" title="Recipient allowlist" />
        <div className="panel anim-rise p-5" style={{ animationDelay: "60ms" }}>
          <p className="mb-3 max-w-2xl text-[12.5px] text-mut">
            The only addresses the send path can ever target. The server rejects everything else — including
            employer addresses — before the SMTP conversation starts.
          </p>
          <div className="flex flex-wrap gap-2">
            {settings.allowlist.length === 0 && <Chip tone="warn">empty — no preflight can run</Chip>}
            {settings.allowlist.map((a) => {
              const isSeed = mailboxes.some((m) => normalizeEmail(m.address) === a);
              return (
                <span key={a} className="inline-flex items-center gap-2 rounded-lg border border-edge bg-pit/60 px-2.5 py-1.5 font-mono text-[11.5px] text-fog">
                  <IcShield size={12} className={isSeed ? "text-grn" : "text-dim"} />
                  {a}
                  <button
                    onClick={() => { up({ allowlist: settings.allowlist.filter((x) => x !== a) }); toast("Address removed from allowlist", "warn"); }}
                    className="rounded p-0.5 text-dim transition-colors hover:bg-raise hover:text-red"
                    aria-label={`Remove ${a}`}
                  >
                    <IcX size={12} />
                  </button>
                </span>
              );
            })}
          </div>
          <div className="mt-4 flex max-w-md gap-2">
            <input
              className={cx("inp font-mono", addrErr && "inp-err")}
              placeholder="seed.inbox@provider.com"
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAddress()}
            />
            <Btn variant="primary" onClick={addAddress}>
              <IcPlus size={14} /> Add
            </Btn>
          </div>
          {addrErr && <p className="mt-1.5 text-[12px] text-red">{addrErr}</p>}
        </div>
      </section>

      {/* ------------------------------------------------ attachments & follow-up */}
      <section>
        <SectionHead kicker="policy" title="Attachments & follow-ups" />
        <div className="panel anim-rise p-5" style={{ animationDelay: "100ms" }}>
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-3">
            <NumField label="Max attachment size" value={settings.attachmentMaxMb} min={1} max={25} suffix="MB per PDF"
              hint="PDFs only — other formats are rejected at validation." onChange={(n) => up({ attachmentMaxMb: n })} />
            <NumField label="Default follow-up reminder" value={settings.followUpBusinessDays} min={1} max={15} suffix="business days"
              hint="Queued after 'Mark sent manually', skipped when a reply is logged." onChange={(n) => up({ followUpBusinessDays: n })} />
            <div>
              <label className="lbl">Upload handling</label>
              <p className="rounded-lg border border-edge bg-pit/50 px-3.5 py-3 text-[11.5px] leading-relaxed text-mut">
                Resumes live outside any public web directory under randomized safe names and are cleaned up
                after runs. Only name, size and SHA-256 are referenced in run history.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ env + data */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel anim-rise overflow-hidden" style={{ animationDelay: "140ms" }}>
          <div className="border-b border-edge px-5 py-3.5">
            <h3 className="font-disp text-[15px] font-bold text-fog">Environment template</h3>
            <p className="mt-0.5 text-[11.5px] text-dim">Server-side variables for the production backend — none of these ever reach the browser bundle.</p>
          </div>
          <pre className="max-h-72 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed text-mut">{ENV_TEMPLATE}</pre>
        </div>

        <div className="panel anim-rise p-5" style={{ animationDelay: "180ms" }}>
          <h3 className="font-disp text-[15px] font-bold text-fog">Workspace data</h3>
          <p className="mt-1 text-[12px] text-mut">
            Everything is stored locally in this browser: {applications.length} application(s), {runs.length} run(s),{" "}
            {mailboxes.length} mailbox(es).
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Btn onClick={exportAll}>Export JSON</Btn>
            <Btn onClick={() => { onResetDemo(); toast("Demo workspace restored"); }}>Restore demo data</Btn>
            <Btn variant={armedWipe ? "danger" : "ghost"} onClick={() => {
              if (!armedWipe) { setArmedWipe(true); setTimeout(() => setArmedWipe(false), 2600); return; }
              onWipeAll();
              setArmedWipe(false);
              toast("All local data erased", "warn");
            }}>
              <IcTrash size={13} /> {armedWipe ? "Confirm erase" : "Erase everything"}
            </Btn>
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-edge bg-pit/50 px-3.5 py-3 text-[11.5px] leading-relaxed text-dim">
            <IcAlert size={14} className="mt-0.5 shrink-0 text-amb/80" />
            Never commit secrets, OAuth tokens, the local database or uploaded resumes to version control —
            the provided <span className="font-mono text-mut">.gitignore</span> covers <span className="font-mono text-mut">dev.db</span>,{" "}
            <span className="font-mono text-mut">.env</span> and the uploads directory.
          </p>
        </div>
      </section>
    </div>
  );
}
