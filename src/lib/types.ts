export type Provider = "gmail" | "outlook" | "yahoo" | "zoho";
export type ConnMethod = "oauth" | "imap";
export type MailboxStatus = "connected" | "disconnected";

export interface SeedMailbox {
  id: string;
  provider: Provider;
  address: string;
  method: ConnMethod;
  status: MailboxStatus;
  connectedAt?: string;
  /** Reference to the encrypted token blob (enc(v1):…). The plaintext token never lives in the DB. */
  tokenRef?: string;
  scopes?: string[];
}

export interface AttachmentMeta {
  name: string;
  size: number;
  sha256: string;
}

export type AuthResult = "pass" | "fail" | "softfail" | "none" | "neutral" | "unknown";

export interface AuthEvaluation {
  spf: AuthResult;
  dkim: AuthResult;
  dmarc: AuthResult;
}

export type DeliveryState = "received" | "missing" | "bounced" | "delayed";
export type FolderState = "inbox" | "spam" | "promotions" | "updates" | "other";
export type StepState = "pending" | "active" | "pass" | "warn" | "fail" | "skip";

export interface StepEvent {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
}

export interface AttachmentCheck {
  name: string;
  expectedSize: number;
  expectedSha: string;
  found: boolean;
  sizeMatch: boolean;
  hashMatch: boolean;
}

export interface SeedResult {
  mailboxId: string;
  provider: Provider;
  address: string;
  checkable: boolean;
  skipReason?: string;
  delivery: DeliveryState | null;
  folder: FolderState | null;
  latencySec: number | null;
  auth: AuthEvaluation | null;
  headerSnippet?: string;
  attachments: AttachmentCheck[];
  steps: StepEvent[];
  outcome: "pass" | "warn" | "fail" | "skip";
}

export type Verdict = "safe" | "review" | "block";

export interface VerdictReason {
  code: string;
  severity: "block" | "review" | "info";
  message: string;
  action: string;
}

export interface VerdictReport {
  verdict: Verdict;
  reasons: VerdictReason[];
}

export interface PreflightInput {
  employer: string;
  role: string;
  subject: string;
  body: string;
  employerEmail?: string;
  attachments: AttachmentMeta[];
}

export type ScenarioId =
  | "nominal"
  | "promotions"
  | "spam"
  | "missing"
  | "bounce"
  | "auth-incomplete"
  | "auth-fail"
  | "attachment-corrupt";

export interface PreflightRun {
  id: string;
  testId: string;
  input: PreflightInput;
  seededSubject: string;
  recipients: string[];
  scenario: ScenarioId;
  status: "running" | "complete" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  timeoutSec: number;
  log: string[];
  seedResults: SeedResult[];
  report?: VerdictReport;
}

export type ReplyStatus = "none" | "replied" | "interview" | "rejected";
export type AppStatus = "draft" | "preflight" | "sent";

export interface JobApplication {
  id: string;
  employer: string;
  role: string;
  contactEmail: string;
  subject: string;
  status: AppStatus;
  replyStatus: ReplyStatus;
  sentDate?: string;
  followUpDate?: string;
  notes: string;
  preflightRunId?: string;
  createdAt: string;
}

export interface Settings {
  timeoutSec: number;
  requiredChecks: number;
  requireAllConnected: boolean;
  promotionsAs: "review" | "block";
  updatesAs: "review" | "block";
  requireDkim: boolean;
  dmarcNoneAs: "review" | "block";
  attachmentMaxMb: number;
  followUpBusinessDays: number;
  allowlist: string[];
}

export type PageId = "preflight" | "applications" | "mailboxes" | "settings";
