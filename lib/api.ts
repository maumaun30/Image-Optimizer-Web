export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

// ---- Auth ----
//
// The API keeps the Google sign-in session in an httpOnly cookie on the shared parent
// domain, so every call just has to send credentials; no token is handled here.

export interface User {
  email: string;
  name: string;
  is_admin: boolean;
}

/** Fired when the API answers 401 mid-session, so the auth gate can ask for sign-in. */
export const AUTH_EXPIRED_EVENT = "imageopt:auth-expired";

export function noteAuthFailure(status: number) {
  if (status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

/** A non-2xx API response; `status` lets callers tell auth, gone and transient apart. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** `fetch` against the API with the session cookie attached. */
async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, credentials: "include" });
  noteAuthFailure(res.status);
  return res;
}

/** The signed-in user, or null when there is no valid session. */
export async function getMe(): Promise<User | null> {
  const res = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Couldn't check sign-in (${res.status})`);
  return res.json();
}

/** Full-page redirect target that starts Google sign-in and returns to `nextPath`. */
export function loginUrl(nextPath: string): string {
  return `${API_BASE}/auth/login?${new URLSearchParams({ next: nextPath })}`;
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
}

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

  const res = await apiFetch(`${API_BASE}/images/upload?${params}`, { method: "POST", body });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function getStatus(jobId: string): Promise<Job> {
  const res = await apiFetch(`${API_BASE}/images/status/${jobId}`);
  if (!res.ok) throw new ApiError(`Status check failed (${res.status})`, res.status);
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

  const res = await apiFetch(`${API_BASE}/pdf/upload?${params}`, { method: "POST", body });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function getPdfStatus(jobId: string): Promise<PdfJob> {
  const res = await apiFetch(`${API_BASE}/pdf/status/${jobId}`);
  if (!res.ok) throw new ApiError(`Status check failed (${res.status})`, res.status);
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

export async function getVideoStatus(jobId: string): Promise<VideoJob> {
  const res = await apiFetch(`${API_BASE}/video/status/${jobId}`);
  if (!res.ok) throw new ApiError(`Status check failed (${res.status})`, res.status);
  return res.json();
}

export function videoDownloadUrl(jobId: string): string {
  return `${API_BASE}/video/download/${jobId}`;
}
