/**
 * Local backend entry point.
 *
 * Serves the built console (dist/) and the /api routes on one origin, so the
 * frontend needs no CORS setup:  npx tsx server/src/server.ts
 *
 * Mode gating:
 *   - live      → real env credentials present; sends via Zoho SMTP and polls
 *                 the connected seed inboxes with real provider adapters.
 *   - mock-dev  → MOCK_PROVIDERS=1; identical pipeline but every provider
 *                 response is a labelled simulation (dev + tests only).
 *   - demo      → credentials missing; run endpoints refuse and explain why.
 *                 The browser console falls back to its built-in demo engine.
 */
import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, liveReadiness, type ServerConfig } from "./config";
import { MemoryRepository, openSqlite, type Repository, type StoredMailbox } from "./db";
import { fileURLToPath } from "node:url";
import { decryptToken, encryptToken } from "./crypto";
import { buildAuthorizationUrl, exchangeCode, sealToken, PROVIDER_SCOPES } from "./oauth";
import {
  GmailAdapter,
  OutlookAdapter,
  MockAdapter,
  MOCK_PASS_HEADERS,
  ImapAdapter,
  type ImapLike,
  type MailProviderAdapter,
} from "./adapters";
import { sendPreflightPackage, zohoTransportFactory } from "./smtp";
import { createRunRecord, RunQueue, type StartRunArgs } from "./orchestrator";
import { uid, isEmailAddress, normalizeEmail, enforceAllowlist } from "../../shared/strings";
import type { BackendHealth, PreflightInput, Provider, Settings } from "../../shared/types";

const DEFAULT_SETTINGS: Settings = {
  timeoutSec: 45,
  requiredChecks: 2,
  requireAllConnected: true,
  promotionsAs: "review",
  updatesAs: "review",
  requireDkim: true,
  dmarcNoneAs: "review",
  attachmentMaxMb: 10,
  followUpBusinessDays: 5,
  allowlist: [],
};

export interface AppDeps {
  config: ServerConfig;
  repo: Repository;
  queue: RunQueue;
  /** Pending OAuth PKCE state: state → { provider, codeVerifier } */
  oauthPending: Map<string, { provider: Provider; codeVerifier: string }>;
}

export function buildApp(deps: AppDeps) {
  const app = express();
  const { config, repo } = deps;
  app.use(express.json({ limit: "30mb" }));

  const mode = (): BackendHealth["mode"] =>
    config.mockProviders ? "mock-dev" : liveReadiness(config).length === 0 ? "live" : "demo";

  const settings = (): Settings => ({ ...DEFAULT_SETTINGS, ...(repo.getSettings() ?? {}) });

  /* ---------------- health / mode ---------------- */
  app.get("/api/health", (_req: Request, res: Response) => {
    const health: BackendHealth = {
      ok: true,
      mode: mode(),
      missing: liveReadiness(config),
      providers: config.mockProviders ? "mock" : "real",
      mailboxesConnected: repo.listMailboxes().filter((m) => m.status === "connected").length,
      version: "0.2.0",
    };
    res.json(health);
  });

  /* ---------------- preflight runs ---------------- */
  app.post("/api/preflight/runs", async (req: Request, res: Response) => {
    if (mode() === "demo") {
      return res.status(409).json({
        error: "Backend is in demo mode — required environment variables are missing.",
        missing: liveReadiness(config),
        hint: "Fill .env (see .env.example), restart the server, and connect seed mailboxes. The console keeps working in demo mode meanwhile.",
      });
    }
    const body = req.body as { input?: PreflightInput; payloads?: Record<string, string> };
    const input = body.input;
    if (!input || !input.employer || !input.subject || !input.body || !Array.isArray(input.attachments)) {
      return res.status(400).json({ error: "Invalid preflight input." });
    }
    for (const a of input.attachments) {
      if (!a.name.toLowerCase().endsWith(".pdf"))
        return res.status(400).json({ error: `Attachment ${a.name} is not a PDF — only PDFs are allowed.` });
      if (a.size > settings().attachmentMaxMb * 1024 * 1024)
        return res.status(400).json({ error: `Attachment ${a.name} exceeds the size limit.` });
    }
    const payloads = new Map<string, Buffer>();
    for (const a of input.attachments) {
      const b64 = body.payloads?.[a.name];
      if (!b64) return res.status(400).json({ error: `Missing payload for ${a.name}.` });
      payloads.set(a.name, Buffer.from(b64, "base64"));
    }

    const mailboxes = repo.listMailboxes();
    const s = settings();
    const run = createRunRecord({ input, payloads, mailboxes }, s);
    if (run.recipients.length === 0) {
      return res.status(409).json({
        error: "No connected, allowlisted seed mailboxes — nothing to send to.",
        hint: "Connect at least one seed mailbox under /api/mailboxes and add its address to the allowlist.",
      });
    }
    repo.upsertRun(run);
    const args: StartRunArgs = { input, payloads, mailboxes };
    void deps.queue.enqueue(run, args);
    res.status(202).json({ id: run.id, testId: run.testId });
  });

  app.get("/api/preflight/runs", (_req: Request, res: Response) => {
    res.json(repo.listRuns().map((r) => ({ ...r, log: undefined })));
  });
  app.get("/api/preflight/runs/:id", (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const run = id ? repo.getRun(id) : undefined;
    if (!run) return res.status(404).json({ error: "Run not found." });
    res.json(run);
  });

  /* ---------------- mailboxes ---------------- */
  app.get("/api/mailboxes", (_req: Request, res: Response) => {
    res.json(
      repo.listMailboxes().map((m) => ({
        ...m,
        tokenEnc: undefined,
        tokenRef: m.tokenEnc ? `${m.tokenEnc.slice(0, 12)}…` : undefined,
      }))
    );
  });

  /** IMAP flow (Yahoo/Zoho): accepts an app-specific password, encrypts it, never stores plaintext. */
  app.post("/api/mailboxes/:provider/imap", (req: Request, res: Response) => {
    const provider = req.params.provider as Provider;
    if (provider !== "yahoo" && provider !== "zoho")
      return res.status(400).json({ error: `${provider} must connect via OAuth.` });
    const { address, appPassword } = req.body as { address?: string; appPassword?: string };
    if (!address || !isEmailAddress(address)) return res.status(400).json({ error: "Valid address required." });
    if (!appPassword || appPassword.length < 6) return res.status(400).json({ error: "App password required." });
    const existing = repo.listMailboxes().find((m) => m.provider === provider);
    const box: StoredMailbox = {
      id: existing?.id ?? uid("box"),
      provider,
      address: normalizeEmail(address),
      method: "imap",
      status: "connected",
      connectedAt: new Date().toISOString(),
      scopes: ["imap.readonly"],
      tokenEnc: sealImapCreds(address, appPassword, config),
    };
    repo.upsertMailbox(box);
    res.json({ id: box.id, status: box.status });
  });

  /* ---------------- OAuth ---------------- */
  app.get("/api/oauth/:provider/start", (req: Request, res: Response) => {
    const provider = req.params.provider as Provider;
    try {
      const { authorizeUrl, state, codeVerifier } = buildAuthorizationUrl(provider, config);
      deps.oauthPending.set(state, { provider, codeVerifier });
      res.redirect(authorizeUrl);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get("/api/oauth/:provider/callback", async (req: Request, res: Response) => {
    const provider = req.params.provider as Provider;
    const state = qstr(req, "state");
    const code = qstr(req, "code");
    const pending = deps.oauthPending.get(state);
    if (!pending || pending.provider !== provider)
      return res.status(400).send("Invalid OAuth state — restart the connection flow.");
    deps.oauthPending.delete(state);
    try {
      const token = await exchangeCode(provider, config, code, pending.codeVerifier);
      const address = qstr(req, "address") || `${provider}-seed@connected.local`;
      const existing = repo.listMailboxes().find((m) => m.provider === provider);
      const box: StoredMailbox = {
        id: existing?.id ?? uid("box"),
        provider,
        address: normalizeEmail(address),
        method: "oauth",
        status: "connected",
        connectedAt: new Date().toISOString(),
        scopes: [PROVIDER_SCOPES[provider] ?? "readonly"],
        tokenEnc: sealToken(token, config),
      };
      repo.upsertMailbox(box);
      res.redirect("/mailboxes?connected=1");
    } catch (err) {
      res.status(502).send(`OAuth token exchange failed: ${(err as Error).message}`);
    }
  });

  /* ---------------- settings & applications ---------------- */
  app.get("/api/settings", (_req: Request, res: Response) => res.json(settings()));
  app.put("/api/settings", (req: Request, res: Response) => {
    const next = { ...settings(), ...(req.body as Partial<Settings>) };
    repo.saveSettings(next);
    res.json(next);
  });

  app.get("/api/applications", (_req: Request, res: Response) => res.json(repo.listApplications()));
  app.put("/api/applications", (req: Request, res: Response) => {
    repo.upsertApplication(req.body);
    res.json({ ok: true });
  });

  /* ---------------- static console ---------------- */
  const dist = resolve(process.cwd(), "dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req: Request, res: Response) => res.sendFile(join(dist, "index.html")));
  }

  return app;
}

function sealImapCreds(address: string, appPassword: string, config: ServerConfig): string {
  return encryptToken(JSON.stringify({ user: address, pass: appPassword }), config.appEncryptionKey);
}

/**
 * Reads a string query parameter regardless of how the active Express typings
 * model `req.query` (ParsedQs vs URLSearchParams-backed shapes).
 */
function qstr(req: Request, key: string): string {
  const v = (req.query as unknown as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

/** Builds an adapter for a mailbox. Returns null when the mailbox is uncheckable. */
export function liveAdapterFactory(config: ServerConfig) {
  return (m: StoredMailbox): MailProviderAdapter | null => {
    if (m.status !== "connected" || !m.tokenEnc) return null;
    let plain: string;
    try {
      plain = decryptToken(m.tokenEnc, config.appEncryptionKey);
    } catch {
      return null;
    }
    if (m.provider === "gmail") {
      const token = JSON.parse(plain) as { accessToken: string };
      return new GmailAdapter(token.accessToken);
    }
    if (m.provider === "outlook") {
      const token = JSON.parse(plain) as { accessToken: string };
      return new OutlookAdapter(token.accessToken);
    }
    if (m.provider === "yahoo" || m.provider === "zoho") {
      const creds = JSON.parse(plain) as { user: string; pass: string };
      return new ImapAdapter(m.provider, creds.user, creds.pass, (cfg) => new LazyImapClient(cfg));
    }
    return null;
  };
}

/**
 * imapflow is loaded lazily so the server and the test-suite boot without
 * touching a socket; the import happens only when a live IMAP check runs.
 */
class LazyImapClient implements ImapLike {
  private client: import("imapflow").ImapFlow | null = null;
  constructor(private cfg: { host: string; port: number; user: string; pass: string }) {}

  private async ensure() {
    if (!this.client) {
      const { ImapFlow } = await import("imapflow");
      this.client = new ImapFlow({
        host: this.cfg.host,
        port: this.cfg.port,
        secure: true,
        auth: { user: this.cfg.user, pass: this.cfg.pass },
        logger: false,
      });
    }
    return this.client;
  }

  async connect() {
    await (await this.ensure()).connect();
  }
  async logout() {
    if (this.client) await this.client.logout();
  }
  async listMailboxes() {
    const client = await this.ensure();
    const tree = await client.listTree();
    const paths: Array<{ path: string; specialUse?: string }> = [];
    const walk = (nodes: Array<{ path: string; specialUse?: string; folders?: typeof nodes }>) => {
      for (const n of nodes) {
        paths.push({ path: n.path, specialUse: n.specialUse });
        if (n.folders) walk(n.folders as never);
      }
    };
    walk(tree.folders as never);
    return paths;
  }
  async fetchAll(folder: string, query: { header: [string, string] }) {
    const client = await this.ensure();
    const lock = await client.getMailboxLock(folder);
    try {
      const seq = await client.search(query as never);
      const out: Array<{ uid: number; headers: Map<string, string[]>; folder: string }> = [];
      for (const uidNum of seq || []) {
        const msg = await client.fetchOne(
          String(uidNum),
          { headers: ["authentication-results", "received-spf", "date"] },
          { uid: true }
        );
        if (!msg) continue;
        out.push({ uid: uidNum, headers: (msg.headers as never) ?? new Map(), folder });
      }
      return out;
    } finally {
      lock.release();
    }
  }
  async download(folder: string, uidNum: number) {
    const client = await this.ensure();
    const lock = await client.getMailboxLock(folder);
    try {
      const stream = await client.download(String(uidNum), undefined, { uid: true });
      const chunks: Buffer[] = [];
      for await (const c of stream.content) chunks.push(Buffer.from(c as never));
      return Buffer.concat(chunks);
    } finally {
      lock.release();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

export async function main() {
  const config = loadConfig();
  const repo = config.mockProviders
    ? new MemoryRepository()
    : await openSqlite(config.dataDir).catch(() => new MemoryRepository());
  const queue = new RunQueue({
    repo,
    settings: { ...DEFAULT_SETTINGS, ...(repo.getSettings() ?? {}) },
    send: config.mockProviders
      ? async (args) => {
          // Mock-dev runs the REAL strict allowlist gate but never opens a
          // socket — the transport is not created at all.
          const to = enforceAllowlist(args.recipients, config.testRecipientAllowlist);
          return { accepted: to, messageId: `mock-dev-${args.testId}` };
        }
      : async (args) => {
          // Live: real Zoho SMTP. The sender re-enforces the allowlist before
          // the transport is handed any recipient.
          const transport = await zohoTransportFactory()(config);
          return sendPreflightPackage({ config, makeTransport: () => transport }, args);
        },
    adapterFor: config.mockProviders
      ? (m, run) => {
          // Mock-dev mirrors the package's expected attachments so the
          // validation logic runs against a consistent, labelled fixture.
          const mock = new MockAdapter(m.provider, {
            deliverAfterMs: 1200,
            folder: "inbox",
            authHeaders: MOCK_PASS_HEADERS,
            attachments: run.input.attachments.map((a) => ({
              filename: a.name,
              size: a.size,
              sha256: a.sha256,
            })),
          });
          mock.markSent();
          return mock;
        }
      : liveAdapterFactory(config),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    clock: Date.now,
    pollIntervalMs: config.pollIntervalSec * 1000,
    timeoutMs: config.seedWaitTimeoutSec * 1000,
  });

  const app = buildApp({ config, repo, queue, oauthPending: new Map() });
  app.listen(config.port, () => {
    const missing = liveReadiness(config);
    const m = config.mockProviders ? "mock-dev" : missing.length === 0 ? "LIVE" : "demo";
    console.log(`\n  MAIL·PREFLIGHT backend on http://localhost:${config.port}  [${m} mode]`);
    if (missing.length) console.log(`  missing for live mode: ${missing.join(", ")}\n`);
    else console.log("  live mode: Zoho SMTP + provider OAuth configured. Mock results are never shown as live.\n");
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
