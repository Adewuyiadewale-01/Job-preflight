import type { ReactNode } from "react";
import type { BackendMode, PageId } from "../lib/types";
import { cx } from "../lib/utils";
import { IcBrief, IcMail, IcRadar, IcSliders, Lamp, ToastHost } from "./ui";

const tabs: Array<{ id: PageId; label: string; icon: ReactNode }> = [
  { id: "preflight", label: "Preflight", icon: <IcRadar size={16} /> },
  { id: "mailboxes", label: "Seed inboxes", icon: <IcMail size={16} /> },
  { id: "applications", label: "Applications", icon: <IcBrief size={16} /> },
  { id: "settings", label: "Settings", icon: <IcSliders size={16} /> },
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
  onNavigate: (page: PageId) => void;
  running: boolean;
  connected: number;
  totalBoxes: number;
  mode: BackendMode | "offline";
  missing: string[];
  children: ReactNode;
}) {
  const live = mode === "live";
  const mocked = mode === "mock-dev";
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-4 px-5 py-4 md:px-8">
          <div className="mr-auto flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-600 text-white shadow-sm">
              <IcRadar size={21} className={running ? "animate-spin" : ""} />
            </div>
            <div>
              <p className="text-base font-bold tracking-tight text-slate-950">Application Mail Preflight</p>
              <p className="text-xs text-slate-500">Check your application package before you send it.</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm text-slate-600 sm:flex">
            <Lamp state={connected > 0 ? "ok" : "warn"} size={8} pulse={false} />
            <span>{connected}/{totalBoxes} seed inboxes connected</span>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto px-5 md:px-8" aria-label="Dashboard sections">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              className={cx(
                "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                page === tab.id ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-900"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <div className={cx("border-b px-5 py-3 text-sm", live ? "border-emerald-200 bg-emerald-50 text-emerald-900" : mocked ? "border-sky-200 bg-sky-50 text-sky-900" : "border-amber-200 bg-amber-50 text-amber-950")}>
        <div className="mx-auto flex max-w-[1240px] items-start gap-2">
          <Lamp state={live ? "ok" : mocked ? "live" : "warn"} size={8} pulse={mocked} />
          <p>{live ? "Live mode: tests send only to your approved seed inboxes. Employer addresses are never sent automatically." : mocked ? "Demo mode: the complete flow is simulated. No real email is sent." : `Setup mode: connect your seed inboxes and add local credentials to enable live testing.${missing.length ? ` Missing: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}` : ""}`}</p>
        </div>
      </div>

      <main className="mx-auto max-w-[1240px] px-5 py-8 md:px-8 md:py-10">{children}</main>
      <footer className="border-t border-slate-200 bg-white px-5 py-5 text-center text-xs text-slate-500">Preflight tests use your approved seed inboxes only. A successful result is a useful signal, not a guarantee of employer inbox placement.</footer>
      <ToastHost />
    </div>
  );
}
