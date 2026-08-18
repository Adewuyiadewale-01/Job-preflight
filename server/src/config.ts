/**
 * Local backend configuration.
 *
 * Every variable has a DUMMY default so the project builds, boots and tests
 * with zero credentials. `liveReady()` decides whether the backend may enter
 * live mode; otherwise it stays in demo/mock-dev mode and says so loudly.
 * Real values come from .env (see .env.example) — never hard-coded here.
 */

export interface ServerConfig {
  port: number;
  dataDir: string;
  zohoSmtpHost: string;
  zohoSmtpPort: number;
  zohoSmtpUser: string;
  zohoSmtpPassword: string;
  mailFrom: string;
  testRecipientAllowlist: string[];
  appEncryptionKey: string;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  microsoftOAuthClientId: string;
  microsoftOAuthClientSecret: string;
  /** Base URL of this backend, used to build OAuth redirect URIs. */
  publicOrigin: string;
  /** Force mocked provider adapters (development + automated tests only). */
  mockProviders: boolean;
  seedWaitTimeoutSec: number;
  pollIntervalSec: number;
}

export const DUMMY = "__dummy__";

const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    port: parseInt(env.PORT ?? "3100", 10),
    dataDir: env.DATA_DIR ?? "./data",
    zohoSmtpHost: env.ZOHO_SMTP_HOST ?? "smtp.zoho.com",
    zohoSmtpPort: parseInt(env.ZOHO_SMTP_PORT ?? "465", 10),
    zohoSmtpUser: env.ZOHO_SMTP_USER ?? DUMMY,
    zohoSmtpPassword: env.ZOHO_SMTP_PASSWORD ?? DUMMY,
    mailFrom: env.MAIL_FROM ?? `Preflight Dev <${DUMMY}@example.invalid>`,
    testRecipientAllowlist: list(env.TEST_RECIPIENT_ALLOWLIST),
    appEncryptionKey: env.APP_ENCRYPTION_KEY ?? DUMMY,
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID ?? DUMMY,
    googleOAuthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? DUMMY,
    microsoftOAuthClientId: env.MICROSOFT_OAUTH_CLIENT_ID ?? DUMMY,
    microsoftOAuthClientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET ?? DUMMY,
    publicOrigin: env.PUBLIC_ORIGIN ?? "http://localhost:3100",
    mockProviders: env.MOCK_PROVIDERS === "1" || env.MOCK_PROVIDERS === "true",
    seedWaitTimeoutSec: parseInt(env.SEED_WAIT_TIMEOUT_SEC ?? "45", 10),
    pollIntervalSec: parseInt(env.POLL_INTERVAL_SEC ?? "3", 10),
  };
}

/** Variables that still hold dummy values — live mode is blocked until they are real. */
export function liveReadiness(cfg: ServerConfig): string[] {
  const missing: string[] = [];
  if (cfg.zohoSmtpUser === DUMMY) missing.push("ZOHO_SMTP_USER");
  if (cfg.zohoSmtpPassword === DUMMY) missing.push("ZOHO_SMTP_PASSWORD");
  if (cfg.mailFrom.includes(DUMMY)) missing.push("MAIL_FROM");
  if (cfg.testRecipientAllowlist.length === 0) missing.push("TEST_RECIPIENT_ALLOWLIST");
  if (cfg.appEncryptionKey === DUMMY || cfg.appEncryptionKey.length < 32)
    missing.push("APP_ENCRYPTION_KEY (≥32 chars)");
  if (cfg.googleOAuthClientId === DUMMY || cfg.googleOAuthClientSecret === DUMMY)
    missing.push("GOOGLE_OAUTH_CLIENT_ID/SECRET");
  if (cfg.microsoftOAuthClientId === DUMMY || cfg.microsoftOAuthClientSecret === DUMMY)
    missing.push("MICROSOFT_OAUTH_CLIENT_ID/SECRET");
  return missing;
}
