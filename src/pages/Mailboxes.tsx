import { useEffect, useRef, useState } from "react";
import type { ConnMethod, Provider, SeedMailbox, Settings } from "../lib/types";
import { cx, encryptToken, fmtDateFull, isEmailAddress, maskToken, normalizeEmail } from "../lib/utils";
import { PROVIDER_META } from "../lib/store";
import {
  Btn,
  Chip,
  IcCheck,
  IcInbox,
  IcLink,
  IcLock,
  IcMail,
  IcRefresh,
  IcShield,
  IcTrash,
  Lamp,
  Modal,
  SectionHead,
  toast,
} from "../components/ui";

const PROVIDERS: Provider[] = ["gmail", "outlook", "yahoo", "zoho"];

export function MailboxesPage({
  mailboxes,
  setMailboxes,
  settings,
  setSettings,
}: {
  mailboxes: SeedMailbox[];
  setMailboxes: (updater: (xs: SeedMailbox[]) => SeedMailbox[]) => void;
  settings: Settings;
  setSettings: (updater: (s: Settings) => Settings) => void;
}) {
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const [address, setAddress] = useState("");
  const [method, setMethod] = useState<ConnMethod>("oauth");
  const [phase, setPhase] = useState<"form" | "authorizing" | "exchanging">("form");
  const [addToList, setAddToList] = useState(true);
  const [addrErr, setAddrErr] = useState("");
  const [armedDisconnect, setArmedDisconnect] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const openConnect = (p: Provider) => {
    const existing = mailboxes.find((m) => m.provider === p);
    setConnecting(p);
    setAddress(existing?.address ?? "");
    setMethod(existing?.method ?? "oauth");
    setPhase("form");
    setAddrErr("");
    setAddToList(true);
  };

  const startAuth = () => {
    if (!connecting) return;
    const provider = connecting;
    const box = mailboxes.find((m) => m.provider === provider);
    const addr = address.trim();
    if (!isEmailAddress(addr)) {
      setAddrErr("Enter a valid inbox address for this seed account.");
      return;
    }
    if (box && box.address !== addr && mailboxes.some((m) => normalizeEmail(m.address) === normalizeEmail(addr))) {
      setAddrErr("That address is already registered to another seed mailbox.");
      return;
    }
    setAddrErr("");
    setPhase("authorizing");
    timers.current.push(
      window.setTimeout(() => {
        setPhase("exchanging");
        timers.current.push(
          window.setTimeout(() => {
            const allowed = settings.allowlist.some((a) => normalizeEmail(a) === normalizeEmail(addr));
            setMailboxes((xs) =>
              xs.map((m) =>
                m.provider === provider
                  ? {
                      ...m,
                      address: addr,
                      method,
                      status: "connected",
                      connectedAt: new Date().toISOString(),
                      tokenRef: encryptToken(`${provider}-access-${Date.now().toString(36)}`),
                      scopes: [PROVIDER_META[provider].scopes],
                    }
                  : m
              )
            );
            if (!allowed && addToList) {
              setSettings((s) => ({ ...s, allowlist: [...s.allowlist, normalizeEmail(addr)] }));
              toast("Connected — address added to the recipient allowlist");
            } else if (!allowed) {
              toast("Connected — remember to allowlist the address or it will be skipped", "warn");
            } else {
              toast(`${PROVIDER_META[provider].label} seed connected`);
            }
            setConnecting(null);
          }, 950)
        );
      }, 1150)
    );
  };

  const disconnect = (m: SeedMailbox) => {
    if (armedDisconnect !== m.id) {
      setArmedDisconnect(m.id);
      setTimeout(() => setArmedDisconnect((v) => (v === m.id ? null : v)), 2600);
      return;
    }
    setMailboxes((xs) =>
      xs.map((x) => (x.id === m.id ? { ...x, status: "disconnected", tokenRef: undefined, connectedAt: undefined } : x))
    );
    setArmedDisconnect(null);
    toast("Seed disconnected — stored token reference destroyed", "warn");
  };

  const connectedCount = mailboxes.filter((m) => m.status === "connected").length;

  return (
    <div className="space-y-8">
      <section>
        <SectionHead
          kicker="providers"
          title="Seed mailboxes"
          right={
            <Chip tone={connectedCount > 0 ? "ok" : "warn"}>
              <Lamp size={6} pulse={false} state={connectedCount > 0 ? "ok" : "warn"} />
              {connectedCount}/{mailboxes.length} connected
            </Chip>
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          {mailboxes.map((m, i) => {
            const meta = PROVIDER_META[m.provider];
            const connected = m.status === "connected";
            const allowed = settings.allowlist.some((a) => normalizeEmail(a) === normalizeEmail(m.address));
            return (
              <div key={m.id} className={cx("panel anim-rise p-5 transition-colors", connected && "border-edge2")} style={{ animationDelay: `${i * 60}ms` }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-lg border border-edge bg-pit/70 font-disp text-lg font-bold" style={{ color: meta.dot }}>
                      {meta.label[0]}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-disp text-[16px] font-bold text-fog">{meta.label}</h3>
                        <Lamp state={connected ? "ok" : "off"} size={8} pulse={false} />
                      </div>
                      <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">{meta.method}</div>
                    </div>
                  </div>
                  <Chip tone={connected ? "ok" : "neutral"}>{connected ? "connected" : "disconnected"}</Chip>
                </div>

                <div className="mt-4 space-y-1.5 rounded-lg border border-edge bg-pit/50 px-3.5 py-3 font-mono text-[11.5px]">
                  <div className="flex justify-between gap-3">
                    <span className="text-dim">address</span>
                    <span className="truncate text-fog">{m.address}</span>
                  </div>
                  {connected ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <span className="text-dim">token</span>
                        <span className="text-cy">{maskToken(m.tokenRef)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-dim">linked</span>
                        <span className="text-mut">{fmtDateFull(m.connectedAt)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-dim">allowlisted</span>
                        <span className={allowed ? "text-grn" : "text-amb"}>{allowed ? "yes" : "no — runs will skip it"}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between gap-3">
                      <span className="text-dim">state</span>
                      <span className="text-mut">awaiting OAuth consent</span>
                    </div>
                  )}
                </div>

                <p className="mt-3 text-[12px] leading-relaxed text-dim">{meta.note}</p>

                <div className="mt-4 flex gap-2">
                  {connected ? (
                    <>
                      <Btn size="sm" onClick={() => openConnect(m.provider)}>
                        <IcRefresh size={13} /> Re-auth
                      </Btn>
                      <Btn size="sm" variant={armedDisconnect === m.id ? "danger" : "ghost"} onClick={() => disconnect(m)}>
                        <IcTrash size={13} /> {armedDisconnect === m.id ? "Confirm disconnect" : "Disconnect"}
                      </Btn>
                    </>
                  ) : (
                    <Btn size="sm" variant="primary" onClick={() => openConnect(m.provider)}>
                      <IcLink size={13} /> Connect {meta.label}
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel anim-rise p-5" style={{ animationDelay: "120ms" }}>
          <div className="mb-2.5 flex items-center gap-2">
            <IcInbox size={16} className="text-cy" />
            <h3 className="font-disp text-[15px] font-bold text-fog">How seed verification works</h3>
          </div>
          <ul className="space-y-1.5 text-[12.5px] text-mut">
            <li>· Every preflight message carries a unique <span className="font-mono text-cy">X-Preflight-Test-Id</span> header and a <span className="font-mono text-cy">[TEST …]</span> subject suffix, so the exact message is located unambiguously.</li>
            <li>· Gmail and Outlook expose category/folder placement via API; Yahoo and Zoho are read via OAuth or IMAP folder state (Inbox vs Spam/Junk).</li>
            <li>· Received headers are parsed for SPF, DKIM and DMARC results exactly as the provider evaluated them.</li>
            <li>· Attachments are re-downloaded and compared by file name, byte size and SHA-256 against your upload.</li>
          </ul>
        </div>
        <div className="panel anim-rise p-5" style={{ animationDelay: "180ms" }}>
          <div className="mb-2.5 flex items-center gap-2">
            <IcShield size={16} className="text-grn" />
            <h3 className="font-disp text-[15px] font-bold text-fog">Security model</h3>
          </div>
          <ul className="space-y-1.5 text-[12.5px] text-mut">
            <li className="flex gap-2"><IcLock size={13} className="mt-0.5 shrink-0 text-grn/80" /> OAuth everywhere possible — the app only ever receives read-only mailbox scopes. It can never send from a seed account.</li>
            <li className="flex gap-2"><IcLock size={13} className="mt-0.5 shrink-0 text-grn/80" /> Passwords are never stored. Where IMAP is the fallback, only app-specific tokens are used.</li>
            <li className="flex gap-2"><IcLock size={13} className="mt-0.5 shrink-0 text-grn/80" /> Tokens are encrypted at rest with the app encryption key (<span className="font-mono text-[11px] text-cy">APP_ENCRYPTION_KEY</span>); only an opaque reference is kept.</li>
            <li className="flex gap-2"><IcLock size={13} className="mt-0.5 shrink-0 text-grn/80" /> Sends go through server-side Zoho SMTP to the strict allowlist only. Non-allowlisted recipients are rejected at the server — employer addresses can never enter the send path.</li>
          </ul>
          <p className="mt-3 rounded-md border border-amb/25 bg-amb/6 px-3 py-2 text-[11.5px] text-amb">
            Demo note: in this local build the consent round-trip and token exchange are simulated; token refs shown are demo ciphertext.
          </p>
        </div>
      </section>

      {/* connect modal */}
      <Modal
        open={connecting !== null}
        onClose={() => connecting && phase === "form" && setConnecting(null)}
        kicker="oauth flow"
        title={connecting ? `Connect ${PROVIDER_META[connecting].label} seed inbox` : ""}
      >
        {connecting && phase === "form" && (
          <div>
            <div className="mb-3.5">
              <label className="lbl">Seed inbox address</label>
              <input className={cx("inp font-mono", addrErr && "inp-err")} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`preflight-you@${connecting === "outlook" ? "outlook.com" : connecting === "gmail" ? "gmail.com" : connecting === "yahoo" ? "yahoo.com" : "yourdomain.dev"}`} />
              {addrErr && <p className="mt-1.5 text-[12px] text-red">{addrErr}</p>}
            </div>
            <div className="mb-3.5">
              <label className="lbl">Connection method</label>
              <div className="grid grid-cols-2 gap-2">
                {(["oauth", "imap"] as ConnMethod[]).map((mm) => (
                  <button key={mm} onClick={() => setMethod(mm)}
                    className={cx(
                      "rounded-lg border px-3 py-2.5 text-left text-[12.5px] transition-all",
                      method === mm ? "border-cy/60 bg-cy/10 text-fog" : "border-edge bg-pit/50 text-mut hover:border-edge2"
                    )}>
                    <span className="block font-medium">{mm === "oauth" ? "OAuth (recommended)" : "IMAP + app token"}</span>
                    <span className="mt-0.5 block text-[11px] text-dim">
                      {mm === "oauth" ? `scope: ${PROVIDER_META[connecting].scopes}` : "fallback for Yahoo/Zoho"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {!settings.allowlist.some((a) => normalizeEmail(a) === normalizeEmail(address.trim())) && address.trim() && (
              <label className="mb-3.5 flex cursor-pointer items-center gap-2.5 rounded-lg border border-amb/30 bg-amb/6 px-3 py-2.5 text-[12.5px] text-amb">
                <input type="checkbox" checked={addToList} onChange={(e) => setAddToList(e.target.checked)} className="accent-[#ffb454]" />
                Address is not on the allowlist yet — add it so runs can use this seed
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setConnecting(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={startAuth}>
                <IcLink size={14} /> Authorize access
              </Btn>
            </div>
          </div>
        )}
        {connecting && phase !== "form" && (
          <div className="grid place-items-center py-8 text-center">
            <div className="relative h-12 w-12">
              <span className="absolute inset-0 rounded-full border-2 border-edge" />
              <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-cy anim-spin" />
              <IcMail size={18} className="absolute inset-0 m-auto text-cy" />
            </div>
            <p className="mt-4 font-mono text-[12px] uppercase tracking-[0.18em] text-mut">
              {phase === "authorizing" ? `redirecting to ${PROVIDER_META[connecting].label} consent…` : "exchanging code for scoped token…"}
            </p>
            <p className="mt-1.5 text-[11.5px] text-dim">
              {phase === "authorizing"
                ? "You would approve read-only mailbox access here."
                : "Token will be encrypted with APP_ENCRYPTION_KEY before storage."}
            </p>
          </div>
        )}
        {phase === "exchanging" && (
          <div className="mt-2 flex items-center justify-center gap-2 text-[11.5px] text-grn">
            <IcCheck size={13} /> scopes locked to read-only
          </div>
        )}
      </Modal>
    </div>
  );
}
