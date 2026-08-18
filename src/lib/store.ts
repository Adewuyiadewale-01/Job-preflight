import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type {
  JobApplication,
  PreflightRun,
  Provider,
  SeedMailbox,
  Settings,
  StepEvent,
} from "./types";
import { addBusinessDays, encryptToken, todayIso, uid } from "./utils";

export const K = {
  settings: "amp.settings.v1",
  mailboxes: "amp.mailboxes.v1",
  applications: "amp.applications.v1",
  runs: "amp.runs.v1",
};

export function usePersistentState<T>(
  key: string,
  initial: () => T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* corrupted storage falls back to seed */
    }
    return initial();
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full — non-fatal in demo */
    }
  }, [key, value]);
  return [value, setValue];
}

export const defaultSettings = (): Settings => ({
  timeoutSec: 24,
  requiredChecks: 2,
  requireAllConnected: false,
  promotionsAs: "review",
  updatesAs: "review",
  requireDkim: true,
  dmarcNoneAs: "review",
  attachmentMaxMb: 10,
  followUpBusinessDays: 5,
  allowlist: [
    "preflight.inbox@gmail.com",
    "preflight.tests@outlook.com",
    "pf.seedbox@yahoo.com",
    "preflight@janedoe.dev",
  ],
});

export const PROVIDER_META: Record<
  Provider,
  { label: string; dot: string; method: string; scopes: string; note: string }
> = {
  gmail: {
    label: "Gmail",
    dot: "#ea4335",
    method: "OAuth · Gmail API",
    scopes: "gmail.readonly",
    note: "Read-only scope. Promotions/Updates categories are detected via the Gmail API.",
  },
  outlook: {
    label: "Outlook",
    dot: "#4cc3e8",
    method: "OAuth · Microsoft Graph",
    scopes: "Mail.Read",
    note: "Read-only scope. Junk Email folder is detected via Graph well-known folder names.",
  },
  yahoo: {
    label: "Yahoo",
    dot: "#a78bfa",
    method: "OAuth · Yahoo Mail API",
    scopes: "mail-r",
    note: "OAuth preferred; IMAP with an app-specific token is the documented fallback.",
  },
  zoho: {
    label: "Zoho",
    dot: "#ffb454",
    method: "OAuth · Zoho Mail API",
    scopes: "ZohoMail.messages.READ",
    note: "A Zoho seed on your own domain is the strongest same-provider signal.",
  },
};

/* ------------------------------------------------------------------ */
/* Demo seed data                                                      */
/* ------------------------------------------------------------------ */

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

export const demoMailboxes = (): SeedMailbox[] => [
  {
    id: "mbx-gmail",
    provider: "gmail",
    address: "preflight.inbox@gmail.com",
    method: "oauth",
    status: "connected",
    connectedAt: hoursAgo(72),
    tokenRef: encryptToken("gmail-demo-access-token"),
    scopes: ["gmail.readonly"],
  },
  {
    id: "mbx-outlook",
    provider: "outlook",
    address: "preflight.tests@outlook.com",
    method: "oauth",
    status: "connected",
    connectedAt: hoursAgo(71),
    tokenRef: encryptToken("outlook-demo-access-token"),
    scopes: ["Mail.Read"],
  },
  {
    id: "mbx-yahoo",
    provider: "yahoo",
    address: "pf.seedbox@yahoo.com",
    method: "imap",
    status: "disconnected",
  },
  {
    id: "mbx-zoho",
    provider: "zoho",
    address: "preflight@janedoe.dev",
    method: "oauth",
    status: "disconnected",
  },
];

const passSteps = (details: string[]): StepEvent[] =>
  [
    "SMTP handoff · Zoho relay",
    "Transit to provider",
    "Polling seed inbox",
    "Folder classification",
    "Auth headers · SPF/DKIM/DMARC",
    "Attachment integrity · SHA-256",
  ].map((label, i) => ({ id: `s${i}`, label, state: "pass" as const, detail: details[i] }));

const DEMO_SHA = "9f3c4e2a1b7d8c5f6a0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a";

export const demoRun = (): PreflightRun => {
  const mk = (provider: Provider, address: string, latency: number) => ({
    mailboxId: `mbx-${provider}`,
    provider,
    address,
    checkable: true,
    delivery: "received" as const,
    folder: "inbox" as const,
    latencySec: latency,
    auth: { spf: "pass" as const, dkim: "pass" as const, dmarc: "pass" as const },
    headerSnippet: [
      `Authentication-Results: mx.${provider}.example;`,
      "  spf=pass smtp.mailfrom=yourdomain.dev;",
      "  dkim=pass header.i=@yourdomain.dev;",
      "  dmarc=pass header.from=yourdomain.dev",
      "X-Preflight-Test-Id: PFT-HIST01-7Q2M",
    ].join("\n"),
    attachments: [
      {
        name: "resume_jane_doe.pdf",
        expectedSize: 182_334,
        expectedSha: DEMO_SHA,
        found: true,
        sizeMatch: true,
        hashMatch: true,
      },
    ],
    steps: passSteps([
      "250 OK · queued",
      "accepted by provider MX",
      `received in ${latency}s`,
      "INBOX",
      "SPF pass · DKIM pass · DMARC pass",
      "1/1 verified",
    ]),
    outcome: "pass" as const,
  });

  return {
    id: "run-demo-northwind",
    testId: "PFT-HIST01-7Q2M",
    input: {
      employer: "Northwind Robotics",
      role: "Backend Engineer (Platform)",
      subject: "Application — Backend Engineer (Platform) — Jane Doe",
      body: "Dear Northwind hiring team, I am writing to apply for the Backend Engineer (Platform) role…",
      employerEmail: "hiring@northwind.example",
      attachments: [{ name: "resume_jane_doe.pdf", size: 182_334, sha256: DEMO_SHA }],
    },
    seededSubject: "[TEST PFT-HIST01-7Q2M] Application — Backend Engineer (Platform) — Jane Doe",
    recipients: ["preflight.inbox@gmail.com", "preflight.tests@outlook.com"],
    scenario: "nominal",
    status: "complete",
    startedAt: hoursAgo(120),
    finishedAt: hoursAgo(119.9),
    timeoutSec: 24,
    log: ["historical demo run — see README for how live telemetry is gathered in production"],
    seedResults: [
      mk("gmail", "preflight.inbox@gmail.com", 2.8),
      mk("outlook", "preflight.tests@outlook.com", 3.6),
    ],
    report: { verdict: "safe", reasons: [] },
  };
};

export const demoApplications = (): JobApplication[] => {
  const sent = daysAgo(8);
  return [
    {
      id: uid("app"),
      employer: "Northwind Robotics",
      role: "Backend Engineer (Platform)",
      contactEmail: "hiring@northwind.example",
      subject: "Application — Backend Engineer (Platform) — Jane Doe",
      status: "sent",
      replyStatus: "none",
      sentDate: sent,
      followUpDate: addBusinessDays(sent, 5),
      notes: "Posted on the careers page. Hiring manager: L. Verne (platform team).",
      preflightRunId: "run-demo-northwind",
      createdAt: hoursAgo(130),
    },
    {
      id: uid("app"),
      employer: "Helios Labs",
      role: "Automation Developer",
      contactEmail: "jobs@helioslabs.example",
      subject: "Jane Doe — Automation Developer application",
      status: "preflight",
      replyStatus: "none",
      notes: "Referral from M. Okafor — mention the CI automation pipeline work.",
      createdAt: hoursAgo(30),
    },
  ];
};

export const todayKey = todayIso;
