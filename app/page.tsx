"use client";

import { useCallback, useRef, useState } from "react";
import { downloadUrl, getStatus, Job, JobStatus, OutputFormat, uploadImages } from "@/lib/api";

const STATUS_STYLE: Record<JobStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processing: "bg-blue-100 text-blue-700",
  ready: "bg-green-100 text-green-700",
  downloaded: "bg-gray-100 text-gray-500",
  failed: "bg-red-100 text-red-700",
  expired: "bg-gray-100 text-gray-400",
};

const TERMINAL: Set<JobStatus> = new Set(["ready", "downloaded", "failed", "expired"]);

function fmt(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

export default function Home() {
  const [pending, setPending] = useState<File[]>([]);
  const [format, setFormat] = useState<OutputFormat>("webp");
  const [width, setWidth] = useState("");
  const [quality, setQuality] = useState(85);
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const addFiles = (list: FileList | File[]) => {
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    setPending((p) => [...p, ...imgs]);
  };

  const startPolling = useCallback((jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const updated = await getStatus(jobId);
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
      const w = width ? parseInt(width, 10) : null;
      const res = await uploadImages(pending, format, w, quality);
      setJobs((prev) => [...res.jobs, ...prev]);
      res.jobs.forEach((j) => startPolling(j.id));
      setPending([]);
      setWidth("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = (jobId: string) => {
    const a = document.createElement("a");
    a.href = downloadUrl(jobId);
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
        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-900">Image Optimizer</h1>
        <p className="mt-1 text-gray-500 text-sm">
          Convert to WebP / AVIF, resize, and compress. Files auto-delete after download.
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
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <p className="text-gray-500 text-sm">
            {pending.length
              ? `${pending.length} image${pending.length !== 1 ? "s" : ""} ready`
              : "Drop images here or click to select"}
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as OutputFormat)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="webp">WebP</option>
              <option value="avif">AVIF</option>
              <option value="original">Original (optimize only)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Width <span className="font-normal text-gray-400">(px, optional)</span>
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              placeholder="e.g. 1280"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={handleUpload}
            disabled={!pending.length || uploading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {uploading ? "Uploading…" : "Optimize"}
          </button>
        </div>

        {/* Quality slider */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="quality" className="text-xs font-medium text-gray-600">
              Quality
            </label>
            <span className="text-xs font-semibold text-gray-700">
              {quality === 100 ? "Lossless" : `${quality}%`}
            </span>
          </div>
          <input
            id="quality"
            type="range"
            min={50}
            max={100}
            step={1}
            value={quality}
            onChange={(e) => setQuality(parseInt(e.target.value, 10))}
            className="w-full accent-blue-600 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
            <span>Smaller file (50%)</span>
            <span>Lossless</span>
          </div>
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
                      {job.resize_width && <span>· {job.resize_width}px wide</span>}
                      {job.quality != null && (
                        <span>· {job.quality === 100 ? "lossless" : `q${job.quality}`}</span>
                      )}
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
