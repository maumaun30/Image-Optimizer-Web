const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type JobStatus = "pending" | "processing" | "ready" | "downloaded" | "failed" | "expired";
export type OutputFormat = "webp" | "avif" | "original";

export interface Job {
  id: string;
  original_filename: string;
  status: JobStatus;
  output_format: OutputFormat;
  resize_width: number | null;
  original_size_bytes: number | null;
  processed_size_bytes: number | null;
  savings_percent: number | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface UploadResponse {
  jobs: Job[];
  total: number;
}

export async function uploadImages(
  files: File[],
  format: OutputFormat,
  width: number | null
): Promise<UploadResponse> {
  const params = new URLSearchParams({ format });
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
