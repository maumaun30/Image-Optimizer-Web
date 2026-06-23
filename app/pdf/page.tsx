"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import {
  CompressionLevel,
  getPdfStatus,
  JobStatus,
  PdfJob,
  pdfDownloadUrl,
  uploadPdfs,
} from "@/lib/api";

const STATUS_STYLE: Record<JobStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processing: "bg-blue-100 text-blue-700",
  ready: "bg-green-100 text-green-700",
  downloaded: "bg-gray-100 text-gray-500",
  failed: "bg-red-100 text-red-700",
  expired: "bg-gray-100 text-gray-400",
};

const TERMINAL: Set<JobStatus> = new Set(["ready", "downloaded", "failed", "expired"]);

const LEVELS: { value: CompressionLevel; label: string }[] = [
  { value: "screen", label: "Screen — smallest (72 dpi)" },
  { value: "ebook", label: "eBook — balanced (150 dpi)" },
  { value: "printer", label: "Printer — high quality (300 dpi)" },
  { value: "lossless", label: "Lossless — no image downsampling" },
];

function fmt(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

export default function PdfPage() {
  const [pending, setPending] = useState<File[]>([]);
  const [level, setLevel] = useState<CompressionLevel>("ebook");
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<PdfJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const addFiles = (list: FileList | File[]) => {
    const pdfs = Array.from(list).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    setPending((p) => [...p, ...pdfs]);
  };

  const startPolling = useCallback((jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const updated = await getPdfStatus(jobId);
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));
        if (TERMINAL.has(updated.status)) {
          clearInterval(timer);
          pollers.current.delete(jobId);
        }
      } catch {
        clearInterval(timer);
        pollers.current.delete(jobId);
      }
    }, 2000);
    pollers.current.set(jobId, timer);
  }, []);

  const handleUpload = async () => {
    if (!pending.length) return;
    setError(null);
    setUploading(true);
    try {
      const res = await uploadPdfs(pending, level);
      setJobs((prev) => [...res.jobs, ...prev]);
      res.jobs.forEach((j) => startPolling(j.id));
      setPending([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = (jobId: string) => {
    const a = document.createElement("a");
    a.href = pdfDownloadUrl(jobId);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: "downloaded" as JobStatus } : j))
    );
  };

  return (
    <main className="min-h-screen bg-gray-50 font-sans">
      <div className="max-w-2xl mx-auto px-4 py-14">
        {/* Nav */}
        <nav className="mb-6 flex gap-4 text-sm">
          <Link href="/" className="text-gray-500 hover:text-gray-900">
            Images
          </Link>
          <span className="font-semibold text-gray-900">PDF</span>
        </nav>

        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-900">PDF Compressor</h1>
        <p className="mt-1 text-gray-500 text-sm">
          Shrink PDF file size with selectable quality. Files auto-delete after download.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`mt-6 rounded-xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors select-none ${
            dragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white hover:border-gray-400"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <p className="text-gray-500 text-sm">
            {pending.length
              ? `${pending.length} PDF${pending.length !== 1 ? "s" : ""} ready`
              : "Drop PDFs here or click to select"}
          </p>
          {pending.length > 0 && (
            <p className="mt-1 text-xs text-gray-400 truncate">
              {pending.map((f) => f.name).join(", ")}
            </p>
          )}
        </div>

        {/* Options */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Compression</label>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as CompressionLevel)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleUpload}
            disabled={!pending.length || uploading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {uploading ? "Uploading…" : "Compress"}
          </button>
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        {/* Job list */}
        {jobs.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
              Jobs
            </h2>
            <div className="space-y-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {job.original_filename}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-gray-400">
                      <span>{fmt(job.original_size_bytes)}</span>
                      {job.processed_size_bytes != null && (
                        <>
                          <span>→</span>
                          <span>{fmt(job.processed_size_bytes)}</span>
                          {(job.savings_percent ?? 0) > 0 && (
                            <span className="text-green-600 font-semibold">
                              -{job.savings_percent}%
                            </span>
                          )}
                        </>
                      )}
                      <span>· {job.compression_level}</span>
                    </div>
                    {job.error_message && (
                      <p className="text-xs text-red-500 mt-1">{job.error_message}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[job.status]}`}
                    >
                      {job.status}
                    </span>
                    {job.status === "ready" && (
                      <button
                        onClick={() => handleDownload(job.id)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline"
                      >
                        Download
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
