/**
 * Local backend client.
 *
 * The console probes GET /api/health on boot:
 *   - reachable + mode "live"     → real preflight runs through Zoho SMTP
 *   - reachable + mode "mock-dev" → real pipeline, simulated providers (labelled)
 *   - reachable + mode "demo"     → backend refuses runs; console uses demo engine
 *   - unreachable                 → pure demo mode, "no real email was sent"
 *
 * Mocked or demo results are never presented as live deliverability results —
 * the mode banner states what happened on every run.
 */
import type { BackendHealth, PreflightInput, PreflightRun } from "./types";

export async function probeBackend(): Promise<BackendHealth | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 900);
    const res = await fetch("/api/health", { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return (await res.json()) as BackendHealth;
  } catch {
    return null;
  }
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export class LiveRunError extends Error {}

/** Starts a live run and polls until the backend finishes it. */
export async function liveRunPreflight(
  input: PreflightInput,
  payloads: Record<string, string>,
  onProgress: (run: PreflightRun) => void
): Promise<PreflightRun> {
  const start = await fetch("/api/preflight/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, payloads }),
  });
  if (!start.ok) {
    const j = (await start.json().catch(() => null)) as { error?: string; missing?: string[] } | null;
    throw new LiveRunError(j?.error ?? `Backend refused the run (${start.status}).`);
  }
  const { id } = (await start.json()) as { id: string };

  for (;;) {
    await new Promise((r) => setTimeout(r, 1200));
    const res = await fetch(`/api/preflight/runs/${id}`);
    if (!res.ok) throw new LiveRunError(`Lost contact with the backend (${res.status}).`);
    const run = (await res.json()) as PreflightRun;
    onProgress(run);
    if (run.status !== "running") return run;
  }
}
