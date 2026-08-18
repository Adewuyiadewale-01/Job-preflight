/**
 * Frontend utilities. Pure domain helpers (allowlist gate, test-id subject,
 * business days, …) live in shared/strings.ts and are shared with the live
 * backend so demo and live behave identically.
 */
import type { Settings } from "./types";

export * from "../../shared/strings";

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

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

/**
 * Demo stand-in for the server's AES-256-GCM envelope encryption keyed by
 * APP_ENCRYPTION_KEY (see server/src/crypto.ts). Tokens are wrapped so
 * plaintext never hits storage — even in the browser-only demo.
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
