"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import {
  getVideoStatus,
  JobStatus,
  uploadVideos,
  VideoCodec,
  videoDownloadUrl,
  VideoJob,
  VideoPreset,
} from "@/lib/api";
import { canEncodeLocally } from "@/lib/videoSupport";
import { encodeVideoLocally, LocalVideoResult } from "@/lib/clientVideo";

const STATUS_STYLE: Record<JobStatus, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processing: "bg-blue-100 text-blue-700",
  ready: "bg-green-100 text-green-700",
  downloaded: "bg-gray-100 text-gray-500",
  failed: "bg-red-100 text-red-700",
  expired: "bg-gray-100 text-gray-400",
};

const TERMINAL: Set<JobStatus> = new Set(["ready", "downloaded", "failed", "expired"]);

const PRESETS: { value: VideoPreset; label: string }[] = [
  { value: "low", label: "Low — smallest file" },
  { value: "balanced", label: "Balanced — recommended" },
  { value: "high", label: "High — near-source quality" },
];

const CODECS: { value: VideoCodec; label: string }[] = [
  { value: "h264", label: "H.264 — plays everywhere, fast" },
  { value: "vp9", label: "VP9 — smaller, slower" },
  { value: "av1", label: "AV1 — smallest, much slower" },
];

/**
 * Turns an encoder error into something short enough to sit on a job row. The full
 * message still goes to the console; this is the one-liner that explains why a file
 * the browser was supposed to handle went to the server instead.
 */
function fallbackReason(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  const undecodable = /cannot decode (\S+)/i.exec(message);
  if (undecodable) return `${undecodable[1].toUpperCase()} can't be decoded by the browser`;
  if (/cannot encode/i.test(message)) return "browser can't encode this size or codec";
  if (/no video (stream|track)/i.test(message)) return "no usable video track in the browser";
  return "browser encode failed";
}

function fmt(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function fmtEta(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))}s left`;
  const m = Math.round(seconds / 60);
  return `~${m}m left`;
}

function triggerDownload(href: string, filename?: string) {
  const a = document.createElement("a");
  a.href = href;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** Encode progress bar. Indeterminate while queued, striped while encoding. */
function ProgressBar({ job, eta }: { job: VideoJob; eta: number | null }) {
  if (job.status === "failed" || job.status === "expired") return null;

  const done = job.status === "ready" || job.status === "downloaded";
  const percent = done ? 100 : job.progress_percent;
  const queued = job.status === "pending";

  return (
    <div className="mt-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        {queued ? (
          <div className="progress-indeterminate h-full rounded-full bg-blue-400" />
        ) : (
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Compressing ${job.original_filename}`}
            style={{ width: `${percent}%` }}
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${
              done ? "bg-green-500" : "progress-stripes bg-blue-500"
            }`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-400">
        <span>
          {queued
            ? "Queued — waiting for a worker"
            : done
              ? "Complete"
              : `Compressing… ${percent}%`}
        </span>
        {!done && !queued && eta != null && <span>{fmtEta(eta)}</span>}
      </div>
    </div>
  );
}

export default function VideoPage() {
  const [pending, setPending] = useState<File[]>([]);
  const [preset, setPreset] = useState<VideoPreset>("balanced");
  const [codec, setCodec] = useState<VideoCodec>("h264");
  const [width, setWidth] = useState("");
  const [mute, setMute] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  // How many files of the current batch are going to the server; the upload bar is
  // meaningless for a batch encoded entirely in the browser.
  const [remoteCount, setRemoteCount] = useState(0);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [etas, setEtas] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const pollers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // First moment a job reported real progress, used to extrapolate a finish time
  const encodeStart = useRef<Map<string, number>>(new Map());
  /** Output of locally-encoded jobs, held until the user downloads it. */
  const blobs = useRef<Map<string, LocalVideoResult>>(new Map());

  const addFiles = (list: FileList | File[]) => {
    const videos = Array.from(list).filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|mpe?g|3gp|ts)$/i.test(f.name)
    );
    setPending((p) => [...p, ...videos]);
  };

  const startPolling = useCallback((jobId: string) => {
    const timer = setInterval(async () => {
      try {
        const updated = await getVideoStatus(jobId);
        setJobs((prev) => prev.map((j) => (j.id === jobId ? updated : j)));

        // Linear extrapolation from how long the encode has taken to reach this point
        if (updated.status === "processing" && updated.progress_percent > 0) {
          const started = encodeStart.current.get(jobId);
          if (started == null) {
            encodeStart.current.set(jobId, Date.now());
          } else {
            const elapsed = (Date.now() - started) / 1000;
            const remaining = (elapsed / updated.progress_percent) * (100 - updated.progress_percent);
            setEtas((p) => ({ ...p, [jobId]: remaining }));
          }
        }

        if (TERMINAL.has(updated.status)) {
          clearInterval(timer);
          pollers.current.delete(jobId);
          encodeStart.current.delete(jobId);
        }
      } catch {
        clearInterval(timer);
        pollers.current.delete(jobId);
      }
    }, 2000);
    pollers.current.set(jobId, timer);
  }, []);

  const sendToServer = useCallback(
    async (files: File[], w: number | null) => {
      const res = await uploadVideos(
        files,
        { preset, codec, width: w, mute },
        setUploadPercent
      );
      setJobs((prev) => [...res.jobs, ...prev]);
      res.jobs.forEach((j) => startPolling(j.id));
    },
    [codec, mute, preset, startPolling]
  );

  /**
   * A local encode that fails gets one retry against the API. The placeholder row is
   * swapped for the real server job so the user sees one entry, not two.
   */
  const fallbackToServer = useCallback(
    async (localId: string, file: File, w: number | null, reason: string) => {
      try {
        const res = await uploadVideos([file], { preset, codec, width: w, mute });
        const job = res.jobs[0];
        if (!job) throw new Error("Server returned no job");
        setJobs((prev) =>
          prev.map((j) => (j.id === localId ? { ...job, fallback_reason: reason } : j))
        );
        startPolling(job.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Encoding failed";
        setJobs((prev) =>
          prev.map((j) =>
            j.id === localId
              ? { ...j, status: "failed" as JobStatus, error_message: message }
              : j
          )
        );
      }
    },
    [codec, mute, preset, startPolling]
  );

  const runLocal = useCallback(
    async (file: File, w: number | null) => {
      const id = crypto.randomUUID();
      const row: VideoJob = {
        id,
        original_filename: file.name,
        status: "processing",
        preset,
        codec,
        target_width: w,
        mute,
        duration_seconds: null,
        progress_percent: 0,
        original_size_bytes: file.size,
        processed_size_bytes: null,
        savings_percent: null,
        error_message: null,
        created_at: new Date().toISOString(),
        processed_at: null,
        local: true,
      };
      setJobs((prev) => [row, ...prev]);

      const onProgress = (percent: number) => {
        setJobs((prev) =>
          prev.map((j) => (j.id === id ? { ...j, progress_percent: percent } : j))
        );
        // Same linear extrapolation the server-polling path uses.
        const started = encodeStart.current.get(id);
        if (started == null) {
          encodeStart.current.set(id, Date.now());
        } else if (percent > 0) {
          const elapsed = (Date.now() - started) / 1000;
          setEtas((p) => ({ ...p, [id]: (elapsed / percent) * (100 - percent) }));
        }
      };

      try {
        const result = await encodeVideoLocally(file, { codec, preset, width: w, mute }, onProgress);
        blobs.current.set(id, result);
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id
              ? {
                  ...j,
                  status: "ready" as JobStatus,
                  progress_percent: 100,
                  processed_size_bytes: result.blob.size,
                  savings_percent: file.size
                    ? Math.round((1 - result.blob.size / file.size) * 100)
                    : 0,
                  // The API stores whole seconds; round so both paths render alike.
                  duration_seconds:
                    result.durationSeconds == null ? null : Math.round(result.durationSeconds),
                  processed_at: new Date().toISOString(),
                }
              : j
          )
        );
      } catch (e) {
        // Why a file fell back is invisible in the UI by design, but it is the first
        // thing worth knowing when the browser path underperforms.
        console.warn(`[video] browser encode failed for ${file.name}, using API:`, e);
        await fallbackToServer(id, file, w, fallbackReason(e));
      } finally {
        encodeStart.current.delete(id);
      }
    },
    [codec, fallbackToServer, mute, preset]
  );

  const handleUpload = async () => {
    if (!pending.length) return;
    setError(null);
    setUploadPercent(0);

    const files = pending;
    const w = width ? parseInt(width, 10) : null;
    setPending([]);
    setWidth("");

    // Files this browser can encode never leave the device; the rest go to the API.
    const local = files.filter((f) => canEncodeLocally(f, codec));
    const remote = files.filter((f) => !canEncodeLocally(f, codec));

    setRemoteCount(remote.length);
    setUploading(true);
    try {
      await Promise.all([
        ...(remote.length ? [sendToServer(remote, w)] : []),
        ...local.map((f) => runLocal(f, w)),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadPercent(0);
      setRemoteCount(0);
    }
  };

  const handleDownload = (job: VideoJob) => {
    if (job.local) {
      const result = blobs.current.get(job.id);
      if (!result) return;
      const url = URL.createObjectURL(result.blob);
      triggerDownload(url, result.filename);
      // Mirrors the server's one-time download: the output is released afterwards.
      blobs.current.delete(job.id);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      triggerDownload(videoDownloadUrl(job.id));
    }
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: "downloaded" as JobStatus } : j))
    );
  };

  const totalPendingBytes = pending.reduce((sum, f) => sum + f.size, 0);

  return (
    <main className="min-h-screen bg-gray-50 font-sans">
      <div className="max-w-2xl mx-auto px-4 py-14">
        {/* Nav */}
        <nav className="mb-6 flex gap-4 text-sm">
          <Link href="/" className="text-gray-500 hover:text-gray-900">
            Images
          </Link>
          <Link href="/pdf" className="text-gray-500 hover:text-gray-900">
            PDF
          </Link>
          <span className="font-semibold text-gray-900">Video</span>
        </nav>

        {/* Header */}
        <h1 className="text-3xl font-bold text-gray-900">Video Compressor</h1>
        <p className="mt-1 text-gray-500 text-sm">
          Re-encode video to a smaller file. Up to 2 GB each. Encoded on your device where
          your browser supports it — nothing to upload — otherwise on the server, where
          files auto-delete after download.
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
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <p className="text-gray-500 text-sm">
            {pending.length
              ? `${pending.length} video${pending.length !== 1 ? "s" : ""} ready · ${fmt(totalPendingBytes)}`
              : "Drop videos here or click to select"}
          </p>
          {pending.length > 0 && (
            <p className="mt-1 text-xs text-gray-400 truncate">
              {pending.map((f) => f.name).join(", ")}
            </p>
          )}
        </div>

        <p className="mt-2 text-xs text-gray-400">
          H.264, HEVC, VP9 and AV1 sources compress in your browser. Camera and edit
          formats the browser cannot decode — ProRes, DNxHD, uncompressed — and files
          over 2 GB are uploaded to the server instead, which is slower.
        </p>

        {/* Options */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quality</label>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as VideoPreset)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Codec</label>
            <select
              value={codec}
              onChange={(e) => setCodec(e.target.value as VideoCodec)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CODECS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Width <span className="font-normal text-gray-400">(px, optional)</span>
            </label>
            <input
              type="number"
              min={1}
              max={7680}
              placeholder="e.g. 1280"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 pb-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={mute}
              onChange={(e) => setMute(e.target.checked)}
              className="accent-blue-600 h-4 w-4 cursor-pointer"
            />
            Remove audio
          </label>

          <button
            onClick={handleUpload}
            disabled={!pending.length || uploading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {uploading ? "Working…" : "Compress"}
          </button>
        </div>

        {/* Upload progress — separate from encode progress; gigabyte uploads take a while */}
        {uploading && remoteCount > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-gray-600">
                Uploading {remoteCount} file{remoteCount !== 1 ? "s" : ""}
              </span>
              <span className="text-xs font-semibold text-gray-700">{uploadPercent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                role="progressbar"
                aria-valuenow={uploadPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Upload progress"
                style={{ width: `${uploadPercent}%` }}
                className="h-full rounded-full bg-blue-600 transition-[width] duration-200 ease-out"
              />
            </div>
            {uploadPercent === 100 && (
              <p className="mt-1 text-[11px] text-gray-400">
                Upload complete — server is saving the file…
              </p>
            )}
          </div>
        )}

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
                  className="bg-white rounded-xl border border-gray-200 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
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
                        <span>· {job.codec}</span>
                        <span>· {job.preset}</span>
                        {job.target_width && <span>· {job.target_width}px wide</span>}
                        {job.mute && <span>· muted</span>}
                        {job.duration_seconds != null && (
                          <span>· {fmtDuration(job.duration_seconds)}</span>
                        )}
                        {job.local && (
                          <span className="text-blue-600 font-medium">· in your browser</span>
                        )}
                        {job.fallback_reason && (
                          <span className="text-amber-600 font-medium">
                            · on server — {job.fallback_reason}
                          </span>
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
                          onClick={() => handleDownload(job)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-semibold underline"
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>

                  <ProgressBar job={job} eta={etas[job.id] ?? null} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
