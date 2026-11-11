"use client";

import { AnimatePresence } from "motion/react";
import { FileText } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CompressionLevel,
  getPdfStatus,
  JobStatus,
  PdfJob,
  pdfDownloadUrl,
  uploadPdfs,
} from "@/lib/api";
import { triggerDownload } from "@/lib/format";
import { CompressButton, ErrorBanner, OptionsCard, RadioCards } from "@/components/tool/controls";
import { DropZone } from "@/components/tool/drop-zone";
import { JobQueue } from "@/components/tool/job-queue";
import { ToolLayout } from "@/components/tool/tool-layout";
import { canDownload, GONE_MESSAGE, noteFor, type QueueItem } from "@/components/tool/types";
import { useJobPoller } from "@/components/tool/use-job-poller";

const TERMINAL: Set<JobStatus> = new Set(["ready", "downloaded", "failed", "expired"]);

const LEVELS: { value: CompressionLevel; title: string; description: string; isDefault?: boolean }[] = [
  { value: "screen", title: "Screen", description: "Smallest · 72 dpi. For on-screen reading and email." },
  { value: "ebook", title: "Ebook", description: "Balanced · 150 dpi. Good for most documents.", isDefault: true },
  { value: "printer", title: "Printer", description: "High quality · 300 dpi. For printing." },
  { value: "lossless", title: "Lossless", description: "No quality loss. Removes unused data only." },
];

const isPdf = (f: File) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

export default function PdfPage() {
  const [pending, setPending] = useState<File[]>([]);
  const [level, setLevel] = useState<CompressionLevel>("ebook");
  const [uploading, setUploading] = useState(false);
  const [jobs, setJobs] = useState<PdfJob[]>([]);
  const [error, setError] = useState<string | null>(null);


  const { start: startPolling, stale } = useJobPoller<PdfJob>({
    fetchStatus: getPdfStatus,
    onUpdate: (id, updated) => setJobs((prev) => prev.map((j) => (j.id === id ? updated : j))),
    isDone: (j) => TERMINAL.has(j.status),
    onGone: (id) =>
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id ? { ...j, status: "failed" as JobStatus, error_message: GONE_MESSAGE } : j
        )
      ),
  });

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
    triggerDownload(pdfDownloadUrl(jobId));
    setJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, status: "downloaded" as JobStatus } : j))
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
        // PDFs always compress on the server
        local: false,
        meta: LEVELS.find((l) => l.value === j.compression_level)?.title,
        note: noteFor(j, stale.has(j.id)),
        canDownload: canDownload(j),
      })),
    [jobs, stale]
  );

  return (
    <ToolLayout
      title="Compress PDFs"
      description="Shrink embedded images and strip unused data. Compressed on the server; files auto-delete after download."
      queue={
        <JobQueue
          items={items}
          onDownload={handleDownload}
          onDownloadAll={() => {
            // Spaced out: browsers drop rapid-fire programmatic downloads
            jobs
              .filter((j) => j.status === "ready")
              .forEach((j, i) => setTimeout(() => handleDownload(j.id), i * 400));
          }}
        />
      }
    >
      <AnimatePresence>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      </AnimatePresence>

      <DropZone
        accept="application/pdf,.pdf"
        files={pending}
        accepts={isPdf}
        noun="PDF"
        hint="PDF · up to 50 MB each, 20 per batch"
        icon={FileText}
        onAdd={(f) => setPending((p) => [...p, ...f])}
        onRemove={(i) => setPending((p) => p.filter((_, k) => k !== i))}
        onClear={() => setPending([])}
      />

      <OptionsCard className="sm:grid-cols-1">
        <RadioCards
          legend="Compression level"
          name="pdf-level"
          value={level}
          options={LEVELS}
          onChange={setLevel}
        />
      </OptionsCard>

      <CompressButton count={pending.length} loading={uploading} onClick={handleUpload} />
    </ToolLayout>
  );
}
