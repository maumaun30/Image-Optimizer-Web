const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

/**
 * Video uploads only. Cloudflare caps request bodies well below the app's own limit
 * (100 MB on Free/Pro), and a multi-gigabyte POST is cut off mid-body — the browser
 * reports ERR_CONNECTION_RESET. Point this at a hostname that bypasses the proxy and
 * reaches the origin directly. Everything else keeps going through API_BASE, so the
 * proxy still fronts the rest of the API.
 *
 * Falls back to API_BASE when unset, which is the right behaviour for local dev and
 * for any deployment without a proxy in front.
 */
const UPLOAD_BASE = (process.env.NEXT_PUBLIC_UPLOAD_URL || API_BASE).replace(/\/$/, "");

export type JobStatus = "pending" | "processing" | "ready" | "downloaded" | "failed" | "expired";
export type OutputFormat = "webp" | "avif" | "original";

export interface Job {
  id: string;
  original_filename: string;
  status: JobStatus;
  output_format: OutputFormat;
  resize_width: number | null;
  quality: number | null;
  original_size_bytes: number | null;
  processed_size_bytes: number | null;
  savings_percent: number | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  /** Set on rows produced by the in-browser pipeline; absent on API responses. */
  local?: boolean;
}

export interface UploadResponse {
  jobs: Job[];
  total: number;
}

export async function uploadImages(
  files: File[],
  format: OutputFormat,
  width: number | null,
  quality: number
): Promise<UploadResponse> {
  const params = new URLSearchParams({ format, quality: String(quality) });
  if (width) params.set("width", String(width));

  const body = new FormData();
  files.forEach((f) => body.append("files", f));

  const res = await fetch(`${API_BASE}/images/upload?${params}`, { method: "POST", body });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function getStatus(jobId: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/images/status/${jobId}`);
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

export function downloadUrl(jobId: string): string {
  return `${API_BASE}/images/download/${jobId}`;
}

// ---- PDF compression ----

export type CompressionLevel = "screen" | "ebook" | "printer" | "lossless";

export interface PdfJob {
  id: string;
  original_filename: string;
  status: JobStatus;
  compression_level: CompressionLevel;
  original_size_bytes: number | null;
  processed_size_bytes: number | null;
  savings_percent: number | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface PdfUploadResponse {
  jobs: PdfJob[];
  total: number;
}

export async function uploadPdfs(
  files: File[],
  level: CompressionLevel
): Promise<PdfUploadResponse> {
  const params = new URLSearchParams({ level });

  const body = new FormData();
  files.forEach((f) => body.append("files", f));

  const res = await fetch(`${API_BASE}/pdf/upload?${params}`, { method: "POST", body });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function getPdfStatus(jobId: string): Promise<PdfJob> {
  const res = await fetch(`${API_BASE}/pdf/status/${jobId}`);
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

export function pdfDownloadUrl(jobId: string): string {
  return `${API_BASE}/pdf/download/${jobId}`;
}

// ---- Video compression ----

export type VideoPreset = "low" | "balanced" | "high";
export type VideoCodec = "h264" | "vp9" | "av1";

export interface VideoJob {
  id: string;
  original_filename: string;
  status: JobStatus;
  preset: VideoPreset;
  codec: VideoCodec;
  target_width: number | null;
  mute: boolean;
  duration_seconds: number | null;
  progress_percent: number;
  original_size_bytes: number | null;
  processed_size_bytes: number | null;
  savings_percent: number | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
  /** Set on rows produced by the in-browser encoder; absent on API responses. */
  local?: boolean;
  /**
   * Why this file was sent to the server after the browser path declined it. Set
   * client-side only; absent on API responses and on files that were never tried
   * locally.
   */
  fallback_reason?: string;
}

export interface VideoUploadResponse {
  jobs: VideoJob[];
  total: number;
}

export interface VideoOptions {
  preset: VideoPreset;
  codec: VideoCodec;
  width: number | null;
  mute: boolean;
}

/**
 * Videos run to gigabytes, so the upload itself needs a progress bar. `fetch` exposes
 * no upload progress events — XHR is the only way to get them.
 */
export function uploadVideos(
  files: File[],
  opts: VideoOptions,
  onUploadProgress?: (percent: number) => void
): Promise<VideoUploadResponse> {
  const params = new URLSearchParams({
    preset: opts.preset,
    codec: opts.codec,
    mute: String(opts.mute),
  });
  if (opts.width) params.set("width", String(opts.width));

  const body = new FormData();
  files.forEach((f) => body.append("files", f));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${UPLOAD_BASE}/video/upload?${params}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onUploadProgress) {
        onUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as VideoUploadResponse);
      } else {
        const detail = (parsed as { detail?: string })?.detail;
        reject(new Error(detail ?? `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(body);
  });
}

export async function getVideoStatus(jobId: string): Promise<VideoJob> {
  const res = await fetch(`${API_BASE}/video/status/${jobId}`);
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

export function videoDownloadUrl(jobId: string): string {
  return `${API_BASE}/video/download/${jobId}`;
}
