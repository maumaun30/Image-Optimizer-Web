"use client";

import { AnimatePresence } from "motion/react";
import { ImageIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { downloadUrl, getStatus, Job, JobStatus, OutputFormat, uploadImages } from "@/lib/api";
import { canCompressLocally } from "@/lib/codecSupport";
import { compressLocally, LocalResult } from "@/lib/clientCompress";
import { triggerDownload } from "@/lib/format";
import { CompressButton, ErrorBanner, OptionsCard, QualitySlider, Segmented, UnitInput } from "@/components/tool/controls";
import { DropZone } from "@/components/tool/drop-zone";
import { JobQueue } from "@/components/tool/job-queue";
import { ToolLayout } from "@/components/tool/tool-layout";
import { canDownload, GONE_MESSAGE, noteFor, type QueueItem } from "@/components/tool/types";
import { useEncodingFlag } from "@/components/tool/use-encoding-flag";
import { useJobPoller } from "@/components/tool/use-job-poller";

const TERMINAL: Set<JobStatus> = new Set(["ready", "downloaded", "failed", "expired"]);

const FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
  { value: "original", label: "Original" },
];

const isImage = (f: File) => f.type.startsWith("image/");

export default function Home() {
  const [pending, setPending] = useState<File[]>([]);
  const [format, setFormat] = useState<OutputFormat>("webp");
  const [width, setWidth] = useState("");
  const [quality, setQuality] = useState(85);
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Output of locally-compressed jobs, held until the user downloads it. */
  const blobs = useRef<Map<string, LocalResult>>(new Map());

  useEncodingFlag(jobs.some((j) => j.local && j.status === "processing"));

  const { start: startPolling, stale } = useJobPoller<Job>({
    fetchStatus: getStatus,
    onUpdate: (id, updated) => setJobs((prev) => prev.map((j) => (j.id === id ? updated : j))),
    isDone: (j) => TERMINAL.has(j.status),
    onGone: (id) =>
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id ? { ...j, status: "failed" as JobStatus, error_message: GONE_MESSAGE } : j
        )
      ),
  });

  const sendToServer = useCallback(
    async (files: File[], w: number | null) => {
      const res = await uploadImages(files, format, w, quality);
      setJobs((prev) => [...res.jobs, ...prev]);
      res.jobs.forEach((j) => startPolling(j.id));
    },
    [format, quality, startPolling]
  );

  /**
   * A local job that fails gets one retry against the API. The placeholder row is
   * swapped for the real server job so the user sees one entry, not two.
   */
  const fallbackToServer = useCallback(
    async (localId: string, file: File, w: number | null) => {
      try {
        const res = await uploadImages([file], format, w, quality);
        const job = res.jobs[0];
        if (!job) throw new Error("Server returned no job");
        setJobs((prev) => prev.map((j) => (j.id === localId ? job : j)));
        startPolling(job.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Compression failed";
        setJobs((prev) =>
          prev.map((j) =>
            j.id === localId ? { ...j, status: "failed" as JobStatus, error_message: message } : j
          )
        );
      }
    },
    [format, quality, startPolling]
  );

  const runLocal = useCallback(
    async (file: File, w: number | null) => {
      const id = crypto.randomUUID();
      const row: Job = {
        id,
        original_filename: file.name,
        status: "processing",
        output_format: format,
        resize_width: w,
        quality,
        original_size_bytes: file.size,
        processed_size_bytes: null,
        savings_percent: null,
        error_message: null,
        created_at: new Date().toISOString(),
        processed_at: null,
        local: true,
      };
      setJobs((prev) => [row, ...prev]);

      try {
        const result = await compressLocally(file, { format, width: w, quality });
        blobs.current.set(id, result);
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id
              ? {
                  ...j,
                  status: "ready" as JobStatus,
                  processed_size_bytes: result.blob.size,
                  savings_percent: file.size ? Math.round((1 - result.blob.size / file.size) * 100) : 0,
                  processed_at: new Date().toISOString(),
                }
              : j
          )
        );
      } catch {
        await fallbackToServer(id, file, w);
      }
    },
    [fallbackToServer, format, quality]
  );

  const handleUpload = async () => {
    if (!pending.length) return;
    setError(null);
    setUploading(true);

    const files = pending;
    const w = width ? parseInt(width, 10) : null;
    setPending([]);
    setWidth("");

    // Files the browser can handle never leave the device; the rest go to the API.
    const local = files.filter((f) => canCompressLocally(f, format));
    const remote = files.filter((f) => !canCompressLocally(f, format));

    try {
      await Promise.all([
        ...(remote.length ? [sendToServer(remote, w)] : []),
        ...local.map((f) => runLocal(f, w)),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = (job: Job) => {
    if (job.local) {
      const result = blobs.current.get(job.id);
      if (!result) return;
      const url = URL.createObjectURL(result.blob);
      triggerDownload(url, result.filename);
      // Mirrors the server's one-time download: the output is released afterwards.
      blobs.current.delete(job.id);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } else {
      triggerDownload(downloadUrl(job.id));
    }
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: "downloaded" as JobStatus } : j))
    );
  };

  const items = useMemo<QueueItem[]>(
    () =>
      jobs.map((j) => ({
        id: j.id,
        name: j.original_filename,
        status: j.status,
        originalBytes: j.original_size_bytes,
        processedBytes: j.processed_size_bytes,
        savingsPercent: j.savings_percent,
        local: j.local,
        note: noteFor(j, stale.has(j.id)),
        canDownload: canDownload(j),
      })),
    [jobs, stale]
  );

  const byId = (id: string) => jobs.find((j) => j.id === id);

  return (
    <ToolLayout
      title="Compress images"
      description="Convert to WebP or AVIF, resize, and choose a quality. Originals are never changed."
      queue={
        <JobQueue
          items={items}
          onDownload={(id) => {
            const job = byId(id);
            if (job) handleDownload(job);
          }}
          onDownloadAll={() => {
            // Spaced out: browsers drop rapid-fire programmatic downloads
            jobs
              .filter((j) => j.status === "ready")
              .forEach((j, i) => setTimeout(() => handleDownload(j), i * 400));
          }}
        />
      }
    >
      <AnimatePresence>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      </AnimatePresence>

      <DropZone
        accept="image/*"
        files={pending}
        accepts={isImage}
        noun="image"
        hint="JPG, PNG, WebP, AVIF, GIF · up to 50 MB each"
        icon={ImageIcon}
        onAdd={(f) => setPending((p) => [...p, ...f])}
        onRemove={(i) => setPending((p) => p.filter((_, k) => k !== i))}
        onClear={() => setPending([])}
      />

      <OptionsCard>
        <Segmented label="Format" value={format} options={FORMATS} onChange={setFormat} />
        <UnitInput
          label="Resize width"
          optional
          value={width}
          onChange={setWidth}
          unit="px"
          placeholder="Keep original"
          max={10000}
        />
        <QualitySlider value={quality} onChange={setQuality} />
      </OptionsCard>

      <CompressButton count={pending.length} loading={uploading} onClick={handleUpload} />
    </ToolLayout>
  );
}
