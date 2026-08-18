import type { ReactNode } from "react";
import type { BackendMode, PageId } from "../lib/types";
import { cx } from "../lib/utils";
import {
  IcBrief,
  IcMail,
  IcRadar,
  IcSliders,
  Lamp,
  ToastHost,
} from "./ui";

const NAV: Array<{ id: PageId; label: string; icon: (p: { size?: number }) => ReactNode; kicker: string }> = [
  { id: "preflight", label: "Preflight Test", icon: (p) => <IcRadar {...p} />, kicker: "console" },
  { id: "applications", label: "Applications", icon: (p) => <IcBrief {...p} />, kicker: "tracker" },
  { id: "mailboxes", label: "Seed Mailboxes", icon: (p) => <IcMail {...p} />, kicker: "providers" },
  { id: "settings", label: "Settings", icon: (p) => <IcSliders {...p} />, kicker: "thresholds" },
];

export function Layout({
  page,
  onNavigate,
  running,
  connected,
  totalBoxes,
  mode,
  missing,
  children,
}: {
  page: PageId;
  onNavigate: (p: PageId) => void;
  running: boolean;
  connected: number;
  totalBoxes: number;
  mode: BackendMode | "offline";
  missing: string[];
  children: ReactNode;
}) {
  const current = NAV.find((n) => n.id === page)!;
  const modeChip =
    mode === "live"
      ? { cls: "border-grn/40 bg-grn/10 text-grn", label: "live · zoho smtp", lamp: "ok" as const }
      : mode === "mock-dev"
        ? { cls: "border-cy/40 bg-cy/10 text-cy", label: "dev · mocked providers", lamp: "live" as const }
        : { cls: "border-amb/30 bg-amb/8 text-amb", label: mode === "demo" ? "demo · backend idle" : "demo · no backend", lamp: "warn" as const };

  return (
    <div className="relative min-h-screen">
      {/* ambient layers */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-blueprint" />
        <div className="absolute inset-0 bg-glow-cy" />
        <div className="absolute inset-0 bg-glow-amb" />
        <div className="absolute inset-0 bg-glow-grn" />
        <div className="scanline" />
      </div>

      {/* sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-edge bg-pit/85 backdrop-blur md:flex">
        <div className="border-b border-edge px-5 pb-5 pt-6">
          <div className="flex items-center gap-2.5">
            <div className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-lg border border-cy/40 bg-cy/10">
              {running ? (
                <span className="radar-sweep absolute inset-0" />
              ) : (
                <IcRadar size={19} className="text-cy" />
              )}
              {running && <IcRadar size={19} className="relative text-cy" />}
            </div>
            <div>
              <div className="font-disp text-[15px] font-bold leading-tight tracking-wide text-fog">
                MAIL<span className="text-cy">·</span>PREFLIGHT
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-dim">
                application console
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((n) => {
            const active = n.id === page;
            return (
              <button
                key={n.id}
                onClick={() => onNavigate(n.id)}
                className={cx(
                  "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150",
                  active
                    ? "bg-cy/10 text-fog shadow-[inset_2px_0_0_0_var(--color-cy)]"
                    : "text-mut hover:bg-raise/60 hover:text-fog"
                )}
              >
                <span className={cx("transition-colors", active ? "text-cy" : "text-dim group-hover:text-mut")}>
                  {n.icon({ size: 17 })}
                </span>
                <span className="flex-1">
                  <span className="block text-[13.5px] font-medium leading-tight">{n.label}</span>
                  <span className="block font-mono text-[9px] uppercase tracking-[0.2em] text-dim">{n.kicker}</span>
                </span>
                <Lamp state={active ? (running && n.id === "preflight" ? "live" : "ok") : "off"} size={6} pulse={false} />
              </button>
            );
          })}
        </nav>

        <div className="border-t border-edge px-5 py-4">
          <div className="flex items-center justify-between font-mono text-[10.5px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <Lamp state={connected > 0 ? "ok" : "warn"} size={6} pulse={false} />
              {connected}/{totalBoxes} seeds linked
            </span>
            <span>v0.1</span>
          </div>
          <p className="mt-2.5 text-[10.5px] leading-relaxed text-dim">
            Local-first · nothing leaves this machine in demo mode. Real sends to employers are always manual.
          </p>
        </div>
      </aside>

      {/* main column */}
      <div className="relative z-10 md:pl-[232px]">
        <header className="sticky top-0 z-20 border-b border-edge bg-pit/80 backdrop-blur">
          <div className="mx-auto flex max-w-[1180px] items-center gap-4 px-4 py-3.5 md:px-8">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-cy/80">
                application mail preflight / {current.kicker}
              </div>
              <h1 className="truncate font-disp text-xl font-bold leading-tight text-fog md:text-2xl">
                {current.label}
              </h1>
            </div>

            <div
              className={cx(
                "hidden items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] sm:inline-flex",
                running ? "border-cy/40 bg-cy/10 text-cy" : "border-edge bg-panel text-dim"
              )}
            >
              <Lamp state={running ? "live" : "off"} size={7} />
              {running ? "run in progress" : "console idle"}
            </div>
            <div
              className={cx(
                "hidden items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] lg:inline-flex",
                modeChip.cls
              )}
              title={missing.length ? `Missing for live mode: ${missing.join(", ")}` : undefined}
            >
              <Lamp state={modeChip.lamp} size={7} pulse={modeChip.lamp !== "ok"} />
              {modeChip.label}
            </div>

            {/* mobile nav */}
            <nav className="flex items-center gap-1 md:hidden">
              {NAV.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onNavigate(n.id)}
                  aria-label={n.label}
                  className={cx(
                    "rounded-lg p-2 transition-colors",
                    page === n.id ? "bg-cy/15 text-cy" : "text-dim hover:text-fog"
                  )}
                >
                  {n.icon({ size: 18 })}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {/* mode banner — states exactly what a run did */}
        <div
          className={cx(
            "border-b px-4 py-2 md:px-8",
            mode === "live"
              ? "border-grn/25 bg-grn/8"
              : mode === "mock-dev"
                ? "border-cy/25 bg-cy/8"
                : "border-amb/25 bg-amb/8"
          )}
        >
          <p className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] leading-relaxed">
            {mode === "live" ? (
              <>
                <Lamp state="ok" size={7} pulse={false} />
                <span className="font-semibold uppercase tracking-[0.14em] text-grn">Live mode</span>
                <span className="text-mut">
                  Preflight runs send through Zoho SMTP and poll your connected seed inboxes. Employer addresses can never be targeted.
                </span>
              </>
            ) : mode === "mock-dev" ? (
              <>
                <Lamp state="live" size={7} />
                <span className="font-semibold uppercase tracking-[0.14em] text-cy">Dev mode — mocked providers</span>
                <span className="text-mut">
                  The full pipeline runs locally, but provider responses are simulated. No real email was sent.
                </span>
              </>
            ) : (
              <>
                <Lamp state="warn" size={7} pulse={false} />
                <span className="font-semibold uppercase tracking-[0.14em] text-amb">
                  Demo mode — no real email was sent.
                </span>
                <span className="text-mut">
                  {mode === "offline"
                    ? "Start the local backend for live runs: npm run build, then npx tsx server/src/server.ts."
                    : `Backend is waiting for credentials: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""} (see .env.example).`}
                </span>
              </>
            )}
          </p>
        </div>

        <main className="mx-auto max-w-[1180px] px-4 py-6 md:px-8 md:py-8">{children}</main>

        <footer className="mx-auto max-w-[1180px] border-t border-edge/70 px-4 py-5 md:px-8">
          <p className="font-mono text-[10.5px] leading-relaxed text-dim">
            MAIL·PREFLIGHT never sends mail to employers — seed recipients only, from a strict allowlist.
            Verdicts are best-effort preflight assessments, not delivery guarantees.
          </p>
        </footer>
      </div>

      <ToastHost />
    </div>
  );
}
