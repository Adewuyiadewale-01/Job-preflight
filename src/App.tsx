import { useCallback, useState } from "react";
import type {
  JobApplication,
  PageId,
  PreflightInput,
  PreflightRun,
  SeedMailbox,
  Settings,
} from "./lib/types";
import {
  demoApplications,
  demoMailboxes,
  demoRun,
  defaultSettings,
  K,
  usePersistentState,
} from "./lib/store";
import { useEffect } from "react";
import type { BackendHealth } from "./lib/types";
import { probeBackend } from "./lib/api";
import { Layout } from "./components/Layout";
import { PreflightPage } from "./pages/Preflight";
import { ApplicationsPage } from "./pages/Applications";
import { MailboxesPage } from "./pages/Mailboxes";
import { SettingsPage } from "./pages/Settings";
import { toast } from "./components/ui";

const disconnectedSlots = (): SeedMailbox[] =>
  demoMailboxes().map((m) => ({ ...m, address: "", status: "disconnected", tokenRef: undefined, connectedAt: undefined }));

export default function App() {
  const [page, setPage] = useState<PageId>("preflight");
  const [settings, setSettings] = usePersistentState<Settings>(K.settings, defaultSettings);
  const [mailboxes, setMailboxes] = usePersistentState<SeedMailbox[]>(K.mailboxes, disconnectedSlots);
  const [applications, setApplications] = usePersistentState<JobApplication[]>(
    K.applications,
    () => []
  );
  const [runs, setRuns] = usePersistentState<PreflightRun[]>(K.runs, () => []);
  const [running, setRunning] = useState(false);
  const [consoleDraft, setConsoleDraft] = useState<Partial<PreflightInput> | null>(null);
  const [backend, setBackend] = useState<BackendHealth | null>(null);

  useEffect(() => {
    void probeBackend().then(setBackend);
  }, []);

  // The first generated UI shipped with seeded demonstration records. Remove
  // those exact placeholders once so they cannot be mistaken for real links.
  useEffect(() => {
    const sampleAddresses = new Set(demoMailboxes().map((mailbox) => mailbox.address));
    const hasSampleConnection = mailboxes.some(
      (mailbox) => mailbox.status === "connected" && sampleAddresses.has(mailbox.address)
    );
    if (!hasSampleConnection) return;
    setMailboxes(disconnectedSlots());
    setSettings((current) => ({
      ...current,
      allowlist: current.allowlist.filter((address) => !sampleAddresses.has(address)),
    }));
    setApplications([]);
    setRuns([]);
  // This is a one-time migration for the known demo data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = mailboxes.filter((m) => m.status === "connected").length;

  const handleSaveRun = useCallback(
    (run: PreflightRun) => setRuns((rs) => [run, ...rs].slice(0, 40)),
    [setRuns]
  );

  const handleLinkApp = useCallback(
    (appId: string, run: PreflightRun) =>
      setApplications((xs) =>
        xs.map((a) =>
          a.id === appId
            ? { ...a, preflightRunId: run.id, status: a.status === "draft" ? "preflight" : a.status }
            : a
        )
      ),
    [setApplications]
  );

  const handlePrepare = useCallback(
    (app: JobApplication) => {
      setConsoleDraft({
        employer: app.employer,
        role: app.role,
        subject: app.subject,
        employerEmail: app.contactEmail || undefined,
      });
      setPage("preflight");
    },
    []
  );

  const consumeDraft = useCallback(() => setConsoleDraft(null), []);
  const handlePhase = useCallback((p: "idle" | "running" | "done") => setRunning(p === "running"), []);

  const resetDemo = () => {
    setSettings(defaultSettings());
    setMailboxes(demoMailboxes());
    setApplications(demoApplications());
    setRuns([demoRun()]);
  };

  const wipeAll = () => {
    setSettings(defaultSettings());
    setMailboxes(disconnectedSlots());
    setApplications([]);
    setRuns([]);
  };

  return (
    <Layout
      page={page}
      onNavigate={setPage}
      running={running}
      connected={connected}
      totalBoxes={mailboxes.length}
      mode={backend ? backend.mode : "offline"}
      missing={backend?.missing ?? []}
    >
      {page === "preflight" && (
        <PreflightPage
          mailboxes={mailboxes}
          settings={settings}
          apps={applications}
          onSaveRun={handleSaveRun}
          onLinkApp={(id, run) => {
            handleLinkApp(id, run);
            toast("Preflight evidence attached to the application");
          }}
          consoleDraft={consoleDraft}
          onDraftConsumed={consumeDraft}
          onPhaseChange={handlePhase}
          backend={backend}
          hasCompletedRun={runs.some((r) => r.status === "complete")}
        />
      )}
      {page === "applications" && (
        <ApplicationsPage
          apps={applications}
          setApps={setApplications}
          runs={runs}
          settings={settings}
          onPrepare={handlePrepare}
        />
      )}
      {page === "mailboxes" && (
        <MailboxesPage
          mailboxes={mailboxes}
          setMailboxes={setMailboxes}
          settings={settings}
          setSettings={setSettings}
        />
      )}
      {page === "settings" && (
        <SettingsPage
          settings={settings}
          setSettings={setSettings}
          mailboxes={mailboxes}
          applications={applications}
          runs={runs}
          onResetDemo={() => {
            resetDemo();
          }}
          onWipeAll={wipeAll}
        />
      )}
    </Layout>
  );
}
