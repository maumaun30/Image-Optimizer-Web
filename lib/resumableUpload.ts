import * as tus from "tus-js-client";
import { API_BASE, noteAuthFailure, type VideoJob, type VideoOptions } from "./api";

/**
 * Chunk size for video uploads. Must stay under the server's TUS_MAX_CHUNK_MB (40)
 * and Cloudflare's 100 MB request cap; small enough that a dropped connection only
 * costs the current chunk.
 */
export const CHUNK_BYTES = 32 * 1024 * 1024;

/** Thrown when the user cancels; callers treat it as a non-error. */
export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelled";
  }
}

export interface ResumableUpload {
  /** Resolves with the queued encode once the last byte is on the server. */
  done: Promise<VideoJob>;
  /** Stop and delete the partial upload on the server. */
  cancel: () => Promise<void>;
}

/** 4xx responses that retrying can't fix. 409/423 mean "out of step", which a retry
 *  (after tus re-reads the offset) does fix; 429 is a rate limit. */
function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && ![409, 423, 429].includes(status);
}

/** The server's `{"detail": ...}` message, when the failure came with one. */
function serverMessage(err: unknown): string | null {
  const res = (err as tus.DetailedError)?.originalResponse;
  if (!res) return null;
  try {
    return (JSON.parse(res.getBody()) as { detail?: string }).detail ?? null;
  } catch {
    return null;
  }
}

/**
 * Upload one video with the tus protocol, in CHUNK_BYTES pieces through the normal
 * API host. Network drops are retried with backoff, and because tus-js-client keeps
 * the upload URL in localStorage, picking the same file again after a page reload
 * (same name, size, date and options) resumes where the server left off.
 *
 * `onProgress(sent, total)` reports bytes on the server; `onResume(bytes)` fires
 * once if this continues an earlier upload.
 */
export function uploadVideoResumable(
  file: File,
  opts: VideoOptions,
  onProgress?: (sent: number, total: number) => void,
  onResume?: (alreadyUploaded: number) => void
): ResumableUpload {
  let upload: tus.Upload;
  let cancelled = false;
  let rejectDone: (e: Error) => void = () => {};

  const done = new Promise<VideoJob>((resolve, reject) => {
    rejectDone = reject;
    upload = new tus.Upload(file, {
      endpoint: `${API_BASE}/video/tus/`,
      chunkSize: CHUNK_BYTES,
      // Network blips, deploy restarts, 5xx: keep going (≈ 70s of patience in total)
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000],
      metadata: {
        filename: file.name,
        filetype: file.type || "application/octet-stream",
        preset: opts.preset,
        codec: opts.codec,
        mute: String(opts.mute),
        ...(opts.width ? { width: String(opts.width) } : {}),
      },
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      // Options are fixed when the upload starts on the server, so they're part of
      // the identity: re-picking the file with another codec starts a fresh upload.
      fingerprint: async (f) =>
        [
          "imageopt-video",
          f.name,
          f.type,
          f.size,
          f.lastModified,
          opts.preset,
          opts.codec,
          opts.width ?? "",
          opts.mute,
          API_BASE,
        ].join("|"),
      onBeforeRequest(req) {
        // The session cookie lives on the API's parent domain
        const xhr = req.getUnderlyingObject();
        if (xhr instanceof XMLHttpRequest) xhr.withCredentials = true;
      },
      onShouldRetry(err) {
        const status = (err as tus.DetailedError).originalResponse?.getStatus() ?? 0;
        if (status === 401) {
          noteAuthFailure(401);
          return false;
        }
        return !isPermanent(status);
      },
      onProgress: (sent, total) => onProgress?.(sent, total),
      onError(err) {
        if (cancelled) return reject(new UploadCancelled());
        reject(new Error(serverMessage(err) ?? "Upload failed. Check your connection and try again."));
      },
      async onSuccess() {
        try {
          // tus-js-client resolves the upload URL against the endpoint
          const res = await fetch(upload.url!, { credentials: "include" });
          noteAuthFailure(res.status);
          if (!res.ok) throw new Error(`Upload finished but the job lookup failed (${res.status})`);
          const body = (await res.json()) as { job: VideoJob | null };
          if (!body.job) throw new Error("Upload finished but no job was created");
          resolve(body.job);
        } catch (e) {
          reject(e);
        }
      },
    });

    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length) {
          upload.resumeFromPreviousUpload(previous[0]);
          // The real resume point comes from the server's HEAD; report what the
          // first progress event says was already there
          let first = true;
          const report = onProgress;
          onProgress = (sent, total) => {
            if (first) {
              first = false;
              if (sent > 0) onResume?.(sent);
            }
            report?.(sent, total);
          };
        }
        if (!cancelled) upload.start();
      })
      .catch(reject);
  });

  return {
    done,
    cancel: async () => {
      cancelled = true;
      // abort() doesn't fire onError, so settle `done` here
      rejectDone(new UploadCancelled());
      // `true` also sends DELETE so the server frees the partial file
      await upload?.abort(true).catch(() => {});
    },
  };
}
