# Application Mail Preflight

A local-first console for **pre-testing the exact email package** of a job application — subject line,
cover-letter body and resume PDFs — against seed inboxes you control, **before** you manually send the
real thing to an employer from your custom-domain Zoho Mail mailbox.

One run produces exactly one automated verdict:

| Verdict | Meaning |
| --- | --- |
| **Safe to send** | Received in the primary Inbox of the required seed inboxes, attachments intact (name/size/SHA-256), SPF + DKIM + DMARC passing. |
| **Review needed** | Delivery works but placement is non-primary, a provider can't be checked, authentication is incomplete, or evidence is thin. |
| **Do not send** | Message missing or bounced, landed in Spam/Junk, attachments failed validation, or an auth check failed. |

> The app **never** sends mail to an employer. Seed recipients only, from a strict server-side
> allowlist. The final application is always a manual send by you. Verdicts are best-effort
> preflight assessments, not guarantees of any employer's inbox placement.

---

## Repository note — what this build is

This workspace delivers the **complete product as a local-first TypeScript + React + Vite + Tailwind
application**. All decision logic is real, pure and unit-tested:

- strict recipient **allowlisting** (throws on any non-allowlisted address),
- **verdict rules** (`src/lib/verdict.ts`) with configurable thresholds,
- **Authentication-Results / Received-SPF header parsing**,
- **attachment validation** (PDF-only, size caps, SHA-256),
- **mailbox-result handling** (received / missing / bounced / delayed, Inbox vs Spam vs Promotions),
- business-day **follow-up scheduling**.

The pieces that inherently require a server with secrets — live Zoho SMTP sending, real OAuth code
exchange, live IMAP/Gmail/Graph polling — are executed here through a clearly labeled **simulated
pipeline** (`src/lib/engine.ts`) with a scenario injector (nominal, promotions, spam trap, silent
loss, bounce, DMARC missing, DKIM failure, corrupted attachment) so every verdict path and the full
progress/telemetry UX can be exercised and demonstrated offline. The "Production backend blueprint"
section below maps each simulated step onto its real Next.js + Prisma implementation.

## Quickstart

```bash
npm install
npm run dev        # console only (demo mode) — http://localhost:5173
npm run build      # production build → dist/
npx vitest run     # unit tests: allowlist gate, verdict rules, header parsing,
                   # attachment validation, mailbox-result handling, SMTP sender,
                   # token encryption, OAuth flows, orchestrator (mock adapters)
```

## Local backend — demo vs live mode

The console probes `GET /api/health` on boot and shows a mode banner that states
exactly what any run did.

| Mode | When | What a run does |
| --- | --- | --- |
| **Demo** | no backend, or backend missing env vars | Built-in simulated scenarios. Banner: *"Demo mode — no real email was sent."* |
| **Mock-dev** | backend started with `MOCK_PROVIDERS=1` | Full real pipeline; provider responses are deterministic fixtures, labelled as mocked. |
| **Live** | all env vars real **and** seed mailboxes connected | Sends through Zoho SMTP, polls real inboxes via Gmail API / Graph / IMAP. |

```bash
# 1. build the console once
npm run build

# 2. start the backend (serves dist/ + /api on one origin)
npx tsx server/src/server.ts                       # http://localhost:3100
MOCK_PROVIDERS=1 npx tsx server/src/server.ts      # pipeline with mocked providers

# optional: type-check the server
npx tsc -p tsconfig.server.json --noEmit
```

**Live activation checklist** (the server prints what is still missing):

1. Copy `.env.example` → `.env` and add your **Zoho SMTP** app-password
   (`ZOHO_SMTP_USER`, `ZOHO_SMTP_PASSWORD`, `MAIL_FROM`).
2. Create OAuth apps and add `GOOGLE_OAUTH_CLIENT_ID/SECRET` (Gmail API,
   read-only scope) and `MICROSOFT_OAUTH_CLIENT_ID/SECRET` (Graph `Mail.Read`),
   with redirect URI `http://localhost:3100/api/oauth/<provider>/callback`.
   Yahoo/Zoho seeds connect via IMAP + app password instead.
3. Set `TEST_RECIPIENT_ALLOWLIST` to the seed addresses you control and a
   ≥32-char `APP_ENCRYPTION_KEY`.
4. Connect seed mailboxes (OAuth start → `/api/oauth/<provider>/start`), then
   run a preflight from the console.

Backend layout: `server/src/config.ts` (dummy defaults, live gating) ·
`smtp.ts` (Zoho sender + double allowlist gate) · `adapters.ts` (Gmail /
Graph / IMAP / mock) · `orchestrator.ts` (polling queue) · `oauth.ts`
(PKCE flows) · `crypto.ts` (AES-256-GCM token envelopes) · `db.ts`
(SQLite via sql.js, persisted to git-ignored `data/dev.db`).

First load seeds a demo workspace (two connected seed mailboxes, one historical run, two tracker
entries). **Settings → Workspace data → Erase everything** starts clean; **Restore demo data** brings
the samples back.

## Pages

- **Preflight Test** — enter employer/role, real subject + cover-letter body, attach the resume PDF
  (plus one optional PDF; PDF-only, hashed with SHA-256 in-browser), then **Run preflight test**.
  Watch SMTP handoff → transit → seed polling → folder classification → SPF/DKIM/DMARC parsing →
  attachment verification, with a live wire log and timeout. The report shows the stamp verdict,
  every finding with its exact next action, and the per-seed evidence (steps, headers, checksums).
- **Applications** — tracker (employer, role, contact email, subject, sent date, reply status,
  follow-up date, notes, linked preflight run), a follow-up dashboard (default reminder: **5 business
  days** after *Mark sent manually*, skipped when a reply is logged), and the preflight history with
  full evidence viewer.
- **Seed Mailboxes** — connect Gmail, Outlook, Yahoo and Zoho seeds. OAuth everywhere possible
  (read-only scopes), IMAP + app token only as the documented Yahoo/Zoho fallback. Passwords are
  never stored; only an encrypted token reference is kept. Disconnecting destroys the reference.
- **Settings** — verdict thresholds (timeout, required clean checks, promotions/updates policy,
  DKIM/DMARC strictness), the strict recipient allowlist, attachment limits, follow-up cadence,
  JSON export / demo reset / wipe, and the environment template.

## Environment template

See `.env.example` — `ZOHO_SMTP_*`, `MAIL_FROM`, `TEST_RECIPIENT_ALLOWLIST`, `DATABASE_URL`,
`APP_ENCRYPTION_KEY`, and the Google/Microsoft OAuth client pairs. All of it is server-side; nothing
secret ever reaches the browser bundle.

### Zoho SMTP setup (production)

1. Add and verify your custom domain in Zoho Mail; publish its **SPF**, **DKIM** and **DMARC**
   records (the whole point of this tool is proving those pass).
2. Create an **app-specific password** for SMTP (or an OAuth token for Zoho's SMTP relay).
3. Put `ZOHO_SMTP_HOST=smtp.zoho.com`, `ZOHO_SMTP_PORT=465`, the user/password and `MAIL_FROM` in
   `.env`. The send endpoint uses `MAIL_FROM` verbatim — same From address, body, formatting and
   PDFs as the real application, plus only a `[TEST <id>]` subject prefix and an
   `X-Preflight-Test-Id` header. No open/click tracking, no pixels, no link rewriting.

### Seed-mailbox OAuth setup (production)

- **Gmail**: Google Cloud project → OAuth client (Web) → redirect `/api/oauth/google/callback` →
  scope `gmail.readonly`.
- **Outlook**: Entra app registration → redirect `/api/oauth/microsoft/callback` → `Mail.Read`.
- **Yahoo**: Yahoo developer app → OAuth; IMAP with an app-specific token is the fallback.
- **Zoho**: Zoho API console → `ZohoMail.messages.READ`.
  Tokens are exchanged server-side and encrypted with `APP_ENCRYPTION_KEY` (AES-256-GCM) before
  storage; the DB holds only an opaque reference.

## Production backend blueprint

For the full server build (Next.js App Router + Prisma + SQLite):

- `POST /api/preflight` — validates input/attachments (PDF-only, size caps), stores uploads outside
  public dirs under randomized names, enforces `TEST_RECIPIENT_ALLOWLIST` (rejects everything else),
  sends via Zoho SMTP with the unique test id, enqueues a poll job.
- **Polling queue** (e.g. `pg-boss`-style worker or `setInterval` job runner): for each seed, fetch
  via Gmail API / Microsoft Graph / IMAP, match `X-Preflight-Test-Id`, classify folder
  (Inbox / Spam / Promotions / Updates), download attachments and compare name/size/SHA-256, parse
  `Authentication-Results`, then run the same `computeVerdict()` rules shipped in this repo.
- Prisma models: `Application`, `PreflightRun`, `SeedMailbox` (encrypted `tokenRef`), `Settings`.
- Never commit `.env`, `dev.db`, tokens or `uploads/` — `.gitignore` already covers them.
- Docker is optional: a two-stage `node:20` image plus a volume for `dev.db` and `uploads/` works,
  but plain `npm run dev` is the intended local flow.

## Git workflow

Target repository: `https://github.com/Adewuyiadewale-01/job-mailboxes-preflight`

One-shot setup — initializes the repo, creates small logical commits
(scaffold → core logic → engine → tests → UI → pages → wiring/docs),
adds the remote and pushes:

```bash
bash scripts/git-setup.sh
```

Or manually:

```bash
git init -b main
git add -A && git commit -m "mail preflight console"
git remote add origin https://github.com/Adewuyiadewale-01/job-mailboxes-preflight.git
git push -u origin main
```

`.gitignore` already excludes `.env`, `dev.db`, `node_modules` and uploaded
resumes — verify with `git status` before pushing.

## Limitations

- Best-effort only: seed results predict but never guarantee employer-inbox placement.
- Promotions/category detection depends on what each provider exposes (Gmail API categories,
  Graph well-known folders, IMAP folder names).
- This build's network steps are simulated; wire the blueprint endpoints for live telemetry.
- Local browser storage: export your workspace from Settings before clearing site data.
