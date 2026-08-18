/**
 * Shared pure helpers — environment-agnostic (no DOM, no Node-only APIs).
 * Used by the frontend, the local backend, and the test suites.
 */

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const makeTestId = () =>
  `PFT-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.random()
    .toString(36)
    .toUpperCase()
    .slice(2, 6)}`;

/** Seed messages carry an unmistakable TEST prefix plus the unique identifier. */
export const seededSubject = (subject: string, testId: string) => `[TEST ${testId}] ${subject}`;

/** Custom header used to locate the exact seed message. */
export const TEST_ID_HEADER = "X-Preflight-Test-Id";

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export const isEmailAddress = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

export class AllowlistError extends Error {
  rejected: string[];
  constructor(rejected: string[]) {
    super(`Recipients rejected by allowlist: ${rejected.join(", ")}`);
    this.name = "AllowlistError";
    this.rejected = rejected;
  }
}

/**
 * Strict send gate. Every recipient must appear in the allowlist or the call
 * throws — nothing is silently filtered, so an accidental employer address can
 * never reach the SMTP transport. Enforced again inside the SMTP sender.
 */
export function enforceAllowlist(recipients: string[], allowlist: string[]): string[] {
  const allowed = new Set(allowlist.map(normalizeEmail));
  const rejected = recipients.filter((r) => !allowed.has(normalizeEmail(r)));
  if (rejected.length > 0) throw new AllowlistError(rejected);
  return recipients.map(normalizeEmail);
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Add N business days (skipping Sat/Sun) to an ISO date. */
export function addBusinessDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d.toISOString().slice(0, 10);
}

export function businessDaysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00`);
  const b = new Date(`${toIso}T12:00:00`);
  const sign = b >= a ? 1 : -1;
  const cur = new Date(a);
  let count = 0;
  while ((sign === 1 && cur < b) || (sign === -1 && cur > b)) {
    cur.setDate(cur.getDate() + sign);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count * sign;
}

export const shortSha = (sha: string) => `${sha.slice(0, 10)}…${sha.slice(-6)}`;
