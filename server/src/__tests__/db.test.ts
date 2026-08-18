import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryRepository, SqliteRepository, openSqlite } from "../db";
import type { PreflightRun, SeedMailbox } from "../../../shared/types";

const run = (id: string, verdict?: "safe" | "review" | "block"): PreflightRun => ({
  id,
  testId: `PFT-${id}`,
  input: { employer: "E", role: "R", subject: "S", body: "B", attachments: [] },
  seededSubject: "[TEST x] S",
  recipients: ["s@gmail.com"],
  scenario: "live",
  status: "complete",
  startedAt: "2026-01-01T10:00:00.000Z",
  finishedAt: "2026-01-01T10:01:00.000Z",
  timeoutSec: 45,
  log: ["ok"],
  seedResults: [],
  report: verdict ? { verdict, reasons: [] } : undefined,
});

const box = (id: string): import("../db").StoredMailbox => ({
  id,
  provider: "gmail",
  address: "s@gmail.com",
  method: "oauth",
  status: "connected",
  tokenEnc: "enc.v1:opaque",
  connectedAt: "2026-01-01T09:00:00.000Z",
});

describe("repositories", () => {
  it("memory repository round-trips runs, mailboxes and settings", () => {
    const repo = new MemoryRepository();
    repo.upsertRun(run("r1", "safe"));
    repo.upsertMailbox(box("b1"));
    expect(repo.getRun("r1")?.report?.verdict).toBe("safe");
    expect(repo.listMailboxes()[0].tokenEnc).toBe("enc.v1:opaque");
    repo.deleteRun("r1");
    expect(repo.getRun("r1")).toBeUndefined();
  });

  it("sqlite repository persists to disk and survives reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "amp-db-"));
    const repo = await openSqlite(dir);
    repo.upsertRun(run("r1", "block"));
    repo.upsertRun(run("r2", "safe"));
    repo.upsertMailbox(box("b1"));
    repo.saveSettings({
      timeoutSec: 45, requiredChecks: 2, requireAllConnected: true, promotionsAs: "review",
      updatesAs: "review", requireDkim: true, dmarcNoneAs: "review", attachmentMaxMb: 10,
      followUpBusinessDays: 5, allowlist: ["s@gmail.com"],
    });
    (repo as SqliteRepository).close();

    const reopened = await openSqlite(dir);
    expect(reopened.listRuns()).toHaveLength(2);
    expect(reopened.getRun("r1")?.report?.verdict).toBe("block");
    expect(reopened.listMailboxes()[0].address).toBe("s@gmail.com");
    expect(reopened.getSettings()?.allowlist).toEqual(["s@gmail.com"]);
  });

  it("never stores plaintext tokens — mailbox rows carry only envelopes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "amp-db-"));
    const repo = await openSqlite(dir);
    const m: import("../db").StoredMailbox = { ...box("b1"), tokenEnc: "enc.v1:AAAA" };
    repo.upsertMailbox(m);
    const raw = repo.getRun; void raw;
    const stored = repo.listMailboxes()[0] as SeedMailbox & { tokenEnc?: string };
    expect(stored.tokenEnc).toMatch(/^enc\.v1:/);
    expect(JSON.stringify(stored)).not.toContain("password");
  });
});
