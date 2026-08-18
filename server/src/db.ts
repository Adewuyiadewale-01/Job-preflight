/**
 * Persistence layer.
 *
 * - `Repository` is the only interface the rest of the backend talks to.
 * - `MemoryRepository` backs the automated tests (no disk, no credentials).
 * - `SqliteRepository` is a real SQLite database via sql.js (pure WASM — no
 *   native build step), persisted to DATA_DIR/dev.db, which is git-ignored.
 *
 * Run documents are stored as JSON blobs with indexed status/verdict columns;
 * mailbox rows store ONLY the encrypted token envelope, never plaintext.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JobApplication, PreflightRun, SeedMailbox, Settings } from "../../shared/types";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  employer TEXT NOT NULL,
  role TEXT NOT NULL,
  contact_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  reply_status TEXT NOT NULL DEFAULT 'none',
  sent_date TEXT,
  follow_up_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  preflight_run_id TEXT,
  created_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preflight_runs (
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT,
  scenario TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS seed_mailboxes (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  address TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  token_enc TEXT,
  connected_at TEXT,
  scopes TEXT,
  doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export interface StoredMailbox extends SeedMailbox {
  /** Encrypted token envelope (enc.v1:…). Never plaintext. */
  tokenEnc?: string;
}

export interface Repository {
  listRuns(): PreflightRun[];
  getRun(id: string): PreflightRun | undefined;
  upsertRun(run: PreflightRun): void;
  deleteRun(id: string): void;

  listMailboxes(): StoredMailbox[];
  getMailbox(id: string): StoredMailbox | undefined;
  upsertMailbox(m: StoredMailbox): void;

  listApplications(): JobApplication[];
  upsertApplication(a: JobApplication): void;
  deleteApplication(id: string): void;

  getSettings(): Partial<Settings> | null;
  saveSettings(s: Settings): void;
}

/* ------------------------------------------------------------------ */
/* In-memory (tests + first boot)                                      */
/* ------------------------------------------------------------------ */

export class MemoryRepository implements Repository {
  private runs = new Map<string, PreflightRun>();
  private boxes = new Map<string, StoredMailbox>();
  private apps = new Map<string, JobApplication>();
  private settings: Partial<Settings> | null = null;

  listRuns() {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  getRun(id: string) {
    return this.runs.get(id);
  }
  upsertRun(run: PreflightRun) {
    this.runs.set(run.id, run);
  }
  deleteRun(id: string) {
    this.runs.delete(id);
  }
  listMailboxes() {
    return [...this.boxes.values()];
  }
  getMailbox(id: string) {
    return this.boxes.get(id);
  }
  upsertMailbox(m: StoredMailbox) {
    this.boxes.set(m.id, m);
  }
  listApplications() {
    return [...this.apps.values()];
  }
  upsertApplication(a: JobApplication) {
    this.apps.set(a.id, a);
  }
  deleteApplication(id: string) {
    this.apps.delete(id);
  }
  getSettings() {
    return this.settings;
  }
  saveSettings(s: Settings) {
    this.settings = s;
  }
}

/* ------------------------------------------------------------------ */
/* SQLite via sql.js (WASM — no native deps)                           */
/* ------------------------------------------------------------------ */

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
}
interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): SqlJsDatabase;
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
  export(): Uint8Array;
  close(): void;
}

export class SqliteRepository implements Repository {
  private db: SqlJsDatabase;
  private file: string;

  constructor(SQL: SqlJsStatic, file: string) {
    this.file = file;
    let data: Buffer | null = null;
    if (existsSync(file)) data = readFileSync(file);
    else mkdirSync(dirname(file), { recursive: true });
    this.db = new SQL.Database(data);
    this.db.run(SCHEMA_SQL);
    this.persist();
  }

  private persist() {
    writeFileSync(this.file, Buffer.from(this.db.export()));
  }

  private all<T>(sql: string, params: unknown[] = []): T[] {
    const res = this.db.exec(sql, params);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]]))) as T[];
  }

  private doc<T>(sql: string, params: unknown[] = []): T | undefined {
    const rows = this.all<{ doc: string }>(sql, params);
    return rows[0] ? (JSON.parse(rows[0].doc) as T) : undefined;
  }

  listRuns() {
    return this.all<{ doc: string }>("SELECT doc FROM preflight_runs ORDER BY started_at DESC").map(
      (r) => JSON.parse(r.doc) as PreflightRun
    );
  }
  getRun(id: string) {
    return this.doc<PreflightRun>("SELECT doc FROM preflight_runs WHERE id = ?", [id]);
  }
  upsertRun(run: PreflightRun) {
    this.db.run(
      `INSERT INTO preflight_runs (id, test_id, status, verdict, scenario, started_at, finished_at, doc)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, verdict=excluded.verdict,
         finished_at=excluded.finished_at, doc=excluded.doc`,
      [
        run.id,
        run.testId,
        run.status,
        run.report?.verdict ?? null,
        run.scenario,
        run.startedAt,
        run.finishedAt ?? null,
        JSON.stringify(run),
      ]
    );
    this.persist();
  }
  deleteRun(id: string) {
    this.db.run("DELETE FROM preflight_runs WHERE id = ?", [id]);
    this.persist();
  }

  listMailboxes() {
    return this.all<{ doc: string }>("SELECT doc FROM seed_mailboxes").map(
      (r) => JSON.parse(r.doc) as StoredMailbox
    );
  }
  getMailbox(id: string) {
    return this.doc<StoredMailbox>("SELECT doc FROM seed_mailboxes WHERE id = ?", [id]);
  }
  upsertMailbox(m: StoredMailbox) {
    this.db.run(
      `INSERT INTO seed_mailboxes (id, provider, address, method, status, token_enc, connected_at, scopes, doc)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, token_enc=excluded.token_enc,
         address=excluded.address, method=excluded.method, connected_at=excluded.connected_at, doc=excluded.doc`,
      [
        m.id,
        m.provider,
        m.address,
        m.method,
        m.status,
        m.tokenEnc ?? null,
        m.connectedAt ?? null,
        m.scopes ? JSON.stringify(m.scopes) : null,
        JSON.stringify(m),
      ]
    );
    this.persist();
  }

  listApplications() {
    return this.all<{ doc: string }>("SELECT doc FROM applications ORDER BY created_at DESC").map(
      (r) => JSON.parse(r.doc) as JobApplication
    );
  }
  upsertApplication(a: JobApplication) {
    this.db.run(
      `INSERT INTO applications (id, employer, role, contact_email, subject, status, reply_status,
        sent_date, follow_up_date, notes, preflight_run_id, created_at, doc)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET doc=excluded.doc, status=excluded.status,
         reply_status=excluded.reply_status, sent_date=excluded.sent_date,
         follow_up_date=excluded.follow_up_date, preflight_run_id=excluded.preflight_run_id`,
      [
        a.id,
        a.employer,
        a.role,
        a.contactEmail,
        a.subject,
        a.status,
        a.replyStatus,
        a.sentDate ?? null,
        a.followUpDate ?? null,
        a.notes,
        a.preflightRunId ?? null,
        a.createdAt,
        JSON.stringify(a),
      ]
    );
    this.persist();
  }
  deleteApplication(id: string) {
    this.db.run("DELETE FROM applications WHERE id = ?", [id]);
    this.persist();
  }

  getSettings() {
    const rows = this.all<{ value: string }>("SELECT value FROM settings WHERE key = 'app'");
    return rows[0] ? (JSON.parse(rows[0].value) as Partial<Settings>) : null;
  }
  saveSettings(s: Settings) {
    this.db.run(
      `INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [JSON.stringify(s)]
    );
    this.persist();
  }

  close() {
    this.db.close();
  }
}

export async function openSqlite(dataDir: string): Promise<SqliteRepository> {
  // sql.js ships its WASM binary; resolve it relative to the package so the
  // server works from any cwd.
  const initSqlJs = (await import("sql.js")).default as unknown as (cfg: {
    locateFile: (f: string) => string;
  }) => Promise<SqlJsStatic>;
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const SQL = await initSqlJs({ locateFile: (f: string) => req.resolve(`sql.js/dist/${f}`) });
  return new SqliteRepository(SQL, join(dataDir, "dev.db"));
}
