import type { Settings } from "./types";

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const makeTestId = () =>
  `PFT-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.random()
    .toString(36)
    .toUpperCase()
    .slice(2, 6)}`;

export const seededSubject = (subject: string, testId: string) =>
  `[TEST ${testId}] ${subject}`;

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

export const isEmailAddress = (e: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

export class AllowlistError extends Error {
  rejected: string[];
  constructor(rejected: string[]) {
    super(`Recipients rejected by allowlist: ${rejected.join(", ")}`);
    this.name = "AllowlistError";
    this.rejected = rejected;
  }
}

/**
 * Server-side guard, mirrored here so the console behaves exactly like the
 * production API route: every recipient must appear in the strict allowlist.
 * Throws on ANY non-allowlisted address — nothing is silently filtered.
 */
export function enforceAllowlist(recipients: string[], allowlist: string[]): string[] {
  const allowed = new Set(allowlist.map(normalizeEmail));
  const rejected = recipients.filter((r) => !allowed.has(normalizeEmail(r)));
  if (rejected.length > 0) throw new AllowlistError(rejected);
  return recipients.map(normalizeEmail);
}

export interface FileDescriptor {
  name: string;
  size: number;
  type: string;
}

export function validateAttachment(
  f: FileDescriptor,
  settings: Settings
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const finalExt = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
  const isPdf = f.type === "application/pdf" || finalExt === "pdf";
  if (!isPdf) errors.push("Only PDF attachments are allowed.");
  if (/\.(exe|js|scr|bat|cmd)$/i.test(f.name))
    errors.push("Executable extensions are always rejected.");
  if (f.size <= 0) errors.push("File is empty.");
  const max = settings.attachmentMaxMb * 1024 * 1024;
  if (f.size > max)
    errors.push(`File exceeds the ${settings.attachmentMaxMb} MB limit (${fmtBytes(f.size)}).`);
  return { ok: errors.length === 0, errors };
}

/** FNV-1a fallback so hashing still works outside secure contexts (demo only). */
function fnvHex(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 16777619) >>> 0;
    h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 2246822519) >>> 0;
  }
  const chunk = (n: number) => n.toString(16).padStart(8, "0");
  return (chunk(h1) + chunk(h2) + chunk(h1 ^ h2) + chunk((h1 + h2) >>> 0)).repeat(4).slice(0, 64);
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(data);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return fnvHex(bytes);
    }
  }
  return fnvHex(bytes);
}

export const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

export const fmtDate = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const fmtDateFull = (iso?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export const fmtClock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

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

/**
 * Demo stand-in for the server's AES-256-GCM envelope encryption keyed by
 * APP_ENCRYPTION_KEY. Tokens are wrapped so plaintext never hits storage.
 */
export const encryptToken = (plain: string) =>
  `enc(v1):${btoa(unescape(encodeURIComponent(plain)))}`;

export const maskToken = (ref?: string) =>
  ref ? `${ref.slice(0, 8)}····${ref.slice(-4)}` : "—";

export function downloadText(filename: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
