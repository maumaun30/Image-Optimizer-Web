import type { JobStatus } from "@/lib/api";

export type NoteKind = "info" | "warning" | "error";

/**
 * What a job queue row renders. Each tool page maps its own job type (image, PDF,
 * video) onto this, so the queue knows nothing about the API shapes.
 */
export interface QueueItem {
  id: string;
  name: string;
  status: JobStatus;
  originalBytes: number | null;
  processedBytes: number | null;
  savingsPercent: number | null;
  /** Ran in the browser rather than on the server. */
  local?: boolean;
  /** Short secondary facts, e.g. "H.264 · Balanced · 1m 20s". */
  meta?: string;
  note?: { kind: NoteKind; text: string; detail?: string };
  /** Video encodes only. */
  progress?: { percent: number; eta: number | null };
  canDownload: boolean;
}

/** Note for a row from the fields every job type shares. */
export function noteFor(job: {
  status: JobStatus;
  error_message: string | null;
  local?: boolean;
  fallback_reason?: string;
}): QueueItem["note"] {
  if (job.status === "failed" && job.error_message) {
    return { kind: "error", text: job.error_message };
  }
  if (job.status === "expired") {
    return { kind: "warning", text: "Server copy was deleted. Compress again to download." };
  }
  if (job.fallback_reason) {
    return {
      kind: "info",
      text: `Sent to server: ${job.fallback_reason}`,
      detail: "Processing runs on the server instead. The file is deleted soon after you download it.",
    };
  }
  return undefined;
}

/**
 * Server files stay downloadable for a short grace window after the first download;
 * an in-browser result is released once it has been saved.
 */
export function canDownload(job: { status: JobStatus; local?: boolean }): boolean {
  return job.status === "ready" || (job.status === "downloaded" && !job.local);
}
