/**
 * Seed-mailbox provider adapters.
 *
 * Every adapter implements the same narrow interface so the orchestrator and
 * the tests are provider-agnostic:
 *
 *   findSeedMessage(testId) → where the message landed (folder/category),
 *     its authentication headers, and attachment fingerprints.
 *
 * - GmailAdapter    → Gmail REST API (OAuth token)
 * - OutlookAdapter  → Microsoft Graph (OAuth token)
 * - ImapAdapter     → Yahoo / Zoho over IMAP (app-specific tokens or OAuth)
 * - MockAdapter     → deterministic fixture for automated tests and MOCK_PROVIDERS
 *                     dev mode. Its output is ALWAYS labelled as simulated.
 */
import { createHash } from "node:crypto";
import type { FolderState, Provider } from "../../shared/types";

export interface ReceivedAttachment {
  filename: string;
  size: number;
  sha256: string;
}

export interface FoundSeedMessage {
  providerMessageId: string;
  folder: FolderState;
  receivedAt: string;
  bounced?: boolean;
  /** Raw Authentication-Results / Received-SPF headers, verbatim. */
  authHeaders: string;
  attachments: ReceivedAttachment[];
}

export interface MailProviderAdapter {
  readonly provider: Provider;
  readonly simulated: boolean;
  findSeedMessage(testId: string, opts: { sinceIso: string }): Promise<FoundSeedMessage | null>;
}

export const sha256Of = (buf: Uint8Array) => createHash("sha256").update(buf).digest("hex");

/* ------------------------------------------------------------------ */
/* Gmail — REST API                                                    */
/* ------------------------------------------------------------------ */

export class GmailAdapter implements MailProviderAdapter {
  readonly provider = "gmail" as const;
  readonly simulated = false;
  constructor(private accessToken: string, private fetchImpl: typeof fetch = fetch) {}

  private async api(path: string): Promise<Record<string, any>> {
    const res = await this.fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
    // Provider payloads are heterogeneous; keep access loose inside this
    // adapter only — the orchestrator consumes strictly typed FoundSeedMessage.
    return (await res.json()) as Record<string, any>;
  }

  async findSeedMessage(testId: string, opts: { sinceIso: string }): Promise<FoundSeedMessage | null> {
    const q = encodeURIComponent(`rfc822msgid-header OR X-Preflight-Test-Id:${testId} in:anywhere newer_than:1d`);
    const list = await this.api(`/messages?q=${q}`);
    for (const m of list.messages ?? []) {
      const full = await this.api(`/messages/${m.id}?format=full`);
      const headers: Array<{ name: string; value: string }> = full.payload?.headers ?? [];
      const idHeader = headers.find((h) => h.name.toLowerCase() === "x-preflight-test-id");
      if (idHeader?.value !== testId) continue;
      const labels: string[] = full.labelIds ?? [];
      const folder: FolderState = labels.includes("SPAM")
        ? "spam"
        : labels.includes("CATEGORY_PROMOTIONS")
          ? "promotions"
          : labels.includes("CATEGORY_UPDATES")
            ? "updates"
            : labels.includes("INBOX")
              ? "inbox"
              : "other";
      const authHeaders = headers
        .filter((h) => /^(authentication-results|received-spf|dkim-signature)$/i.test(h.name))
        .map((h) => `${h.name}: ${h.value}`)
        .join("\n");
      const attachments: ReceivedAttachment[] = [];
      const walk = (part: { filename?: string; mimeType?: string; body?: { size?: number; attachmentId?: string } }) => {
        if (part.filename && part.body?.attachmentId) {
          return this.api(`/messages/${m.id}/attachments/${part.body.attachmentId}`).then((att) => {
            const buf = Buffer.from(att.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
            attachments.push({ filename: part.filename!, size: buf.length, sha256: sha256Of(buf) });
          });
        }
        return Promise.all((part as { parts?: typeof part[] }).parts?.map(walk) ?? []);
      };
      await walk(full.payload);
      return {
        providerMessageId: m.id,
        folder,
        receivedAt: new Date(parseInt(full.internalDate, 10)).toISOString(),
        authHeaders,
        attachments,
      };
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Outlook — Microsoft Graph                                           */
/* ------------------------------------------------------------------ */

export class OutlookAdapter implements MailProviderAdapter {
  readonly provider = "outlook" as const;
  readonly simulated = false;
  constructor(private accessToken: string, private fetchImpl: typeof fetch = fetch) {}

  private async graph(path: string): Promise<Record<string, any>> {
    const res = await this.fetchImpl(`https://graph.microsoft.com/v1.0/me${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new Error(`Graph API ${res.status}: ${await res.text()}`);
    return (await res.json()) as Record<string, any>;
  }

  async findSeedMessage(testId: string, opts: { sinceIso: string }): Promise<FoundSeedMessage | null> {
    const folders = ["inbox", "junkemail", "archivefolders", "deleteditems"];
    for (const folder of folders) {
      const list = await this.graph(
        `/mailFolders/${folder}/messages?$top=25&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${opts.sinceIso}`
      );
      for (const msg of list.value ?? []) {
        const subject: string = msg.subject ?? "";
        const headerMatch: string | undefined = (msg.internetMessageHeaders ?? []).find(
          (h: { name: string; value: string }) => h.name.toLowerCase() === "x-preflight-test-id"
        )?.value;
        if (!subject.includes(testId) && headerMatch !== testId) continue;

        const folderState: FolderState =
          folder === "junkemail" ? "spam" : folder === "inbox" ? "inbox" : "other";
        const authHeaders: string = (msg.internetMessageHeaders ?? [])
          .filter((h: { name: string }) =>
            /^(authentication-results|received-spf|dkim-signature)$/i.test(h.name)
          )
          .map((h: { name: string; value: string }) => `${h.name}: ${h.value}`)
          .join("\n");

        const attachments: ReceivedAttachment[] = [];
        const atts = await this.graph(`/messages/${msg.id}/attachments`);
        for (const a of atts.value ?? []) {
          if (a["@odata.type"]?.includes("fileAttachment") && a.contentBytes) {
            const buf = Buffer.from(a.contentBytes, "base64");
            attachments.push({ filename: a.name ?? "attachment", size: buf.length, sha256: sha256Of(buf) });
          }
        }
        return {
          providerMessageId: msg.id,
          folder: folderState,
          receivedAt: msg.receivedDateTime,
          authHeaders,
          attachments,
        };
      }
    }
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* IMAP — Yahoo & Zoho (imapflow, pure JS)                             */
/* ------------------------------------------------------------------ */

const IMAP_SERVERS: Record<string, { host: string; port: number }> = {
  yahoo: { host: "imap.mail.yahoo.com", port: 993 },
  zoho: { host: "imap.zoho.com", port: 993 },
};
const JUNK_FOLDERS = ["junk", "spam", "junk email", "bulk mail", "spam/junk"];

export interface ImapLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  listMailboxes(): Promise<Array<{ path: string; specialUse?: string }>>;
  fetchAll(folder: string, query: { header: [string, string] }): Promise<
    Array<{ uid: number; headers: Map<string, string[]>; folder: string }>
  >;
  download(folder: string, uid: number): Promise<Buffer>;
}

export class ImapAdapter implements MailProviderAdapter {
  readonly simulated = false;
  constructor(
    readonly provider: Provider,
    private user: string,
    private pass: string,
    private makeClient: (cfg: { host: string; port: number; user: string; pass: string }) => ImapLike
  ) {}

  async findSeedMessage(testId: string, opts: { sinceIso: string }): Promise<FoundSeedMessage | null> {
    const server = IMAP_SERVERS[this.provider];
    if (!server) throw new Error(`No IMAP server known for provider ${this.provider}`);
    const client = this.makeClient({ ...server, user: this.user, pass: this.pass });
    try {
      await client.connect();
      const mailboxes = await client.listMailboxes();
      const candidates = ["INBOX", ...mailboxes.map((m) => m.path)];
      for (const folder of candidates) {
        let hits: Awaited<ReturnType<ImapLike["fetchAll"]>> = [];
        try {
          hits = await client.fetchAll(folder, { header: ["X-Preflight-Test-Id", testId] });
        } catch {
          continue;
        }
        for (const hit of hits) {
          const headerVal = (name: string) => hit.headers.get(name.toLowerCase())?.[0] ?? "";
          const authHeaders = ["authentication-results", "received-spf"]
            .map((n) => (headerVal(n) ? `${n}: ${headerVal(n)}` : ""))
            .filter(Boolean)
            .join("\n");
          const lower = folder.toLowerCase();
          const folderState: FolderState = JUNK_FOLDERS.some((j) => lower.includes(j))
            ? "spam"
            : lower === "inbox"
              ? "inbox"
              : "other";
          const raw = await client.download(folder, hit.uid);
          const attachments = parseMimeAttachments(raw);
          return {
            providerMessageId: `${folder}#${hit.uid}`,
            folder: folderState,
            receivedAt: headerVal("date") ? new Date(headerVal("date")).toISOString() : opts.sinceIso,
            authHeaders,
            attachments,
          };
        }
      }
      return null;
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}

/** Minimal multipart scanner — enough to fingerprint PDF attachments by name/size/hash. */
export function parseMimeAttachments(raw: Buffer): ReceivedAttachment[] {
  const text = raw.toString("binary");
  const boundaryMatch = text.match(/boundary="?([^";\r\n]+)"?/i);
  if (!boundaryMatch) return [];
  const parts = text.split(`--${boundaryMatch[1]}`);
  const out: ReceivedAttachment[] = [];
  for (const part of parts) {
    const name = part.match(/filename="?([^";\r\n]+)"?/i)?.[1];
    const enc = part.match(/content-transfer-encoding:\s*([a-z0-9-]+)/i)?.[1]?.toLowerCase();
    if (!name) continue;
    const body = part.split(/\r?\n\r?\n/).slice(1).join("\n").trim();
    let buf: Buffer;
    if (enc === "base64") buf = Buffer.from(body.replace(/\s+/g, ""), "base64");
    else buf = Buffer.from(body, "binary");
    out.push({ filename: name, size: buf.length, sha256: sha256Of(buf) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Mock — automated tests + MOCK_PROVIDERS dev mode                    */
/* ------------------------------------------------------------------ */

export interface MockScript {
  /** ms after send when the message appears (null → never arrives). */
  deliverAfterMs: number | null;
  folder: FolderState;
  bounced?: boolean;
  authHeaders: string;
  attachments: ReceivedAttachment[];
}

export const MOCK_PASS_HEADERS =
  "Authentication-Results: mx.mock.local;\n" +
  "  spf=pass smtp.mailfrom=yourdomain.dev;\n" +
  "  dkim=pass header.i=@yourdomain.dev;\n" +
  "  dmarc=pass header.from=yourdomain.dev";

/**
 * Deterministic fixture adapter. Tests inject scripts per mailbox; dev mode
 * (MOCK_PROVIDERS=1) uses a nominal script. `simulated` is always true so no
 * consumer can mistake its output for a live deliverability result.
 */
export class MockAdapter implements MailProviderAdapter {
  readonly simulated = true;
  constructor(
    readonly provider: Provider,
    private script: MockScript,
    private clock: () => number = Date.now
  ) {}
  private sentAt: number | null = null;
  markSent() {
    this.sentAt = this.clock();
  }
  async findSeedMessage(): Promise<FoundSeedMessage | null> {
    const s = this.script;
    if (s.bounced) {
      return {
        providerMessageId: "mock-bounce",
        folder: "other",
        receivedAt: new Date(this.clock()).toISOString(),
        bounced: true,
        authHeaders: "",
        attachments: [],
      };
    }
    if (s.deliverAfterMs === null || this.sentAt === null) return null;
    if (this.clock() - this.sentAt < s.deliverAfterMs) return null;
    return {
      providerMessageId: "mock-1",
      folder: s.folder,
      receivedAt: new Date(this.sentAt + s.deliverAfterMs).toISOString(),
      authHeaders: s.authHeaders,
      attachments: s.attachments,
    };
  }
}
