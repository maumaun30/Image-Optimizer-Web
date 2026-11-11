"use client";

import { AnimatePresence } from "motion/react";
import { Video } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  getVideoStatus,
  JobStatus,
  VideoCodec,
  videoDownloadUrl,
  VideoJob,
  VideoPreset,
} from "@/lib/api";
import { canEncodeLocally } from "@/lib/videoSupport";
import { UploadCancelled, uploadVideoResumable, type ResumableUpload } from "@/lib/resumableUpload";
import { encodeVideoLocally, LocalVideoResult } from "@/lib/clientVideo";
import { fmtDuration, triggerDownload } from "@/lib/format";
import {
  CompressButton,
  ErrorBanner,
  OptionsCard,
  RadioCards,
  Segmented,
  SwitchField,
  UnitInput,
  UploadProgress,
} from "@/components/tool/controls";
import { DropZone } from "@/components/tool/drop-zone";
import { JobQueue } from "@/components/tool/job-queue";
import { ToolLayout } from "@/components/tool/tool-layout";
import { canDownload, GONE_MESSAGE, noteFor, type QueueItem } from "@/components/tool/types";
import { useJobPoller } from "@/components/tool/use-job-poller";
import { useEncodingFlag } from "@/components/tool/use-encoding-flag";

const TERMINAL: Set<JobStatus> = new Set(["ready", "downloaded", "failed", "expired"]);

const PRESETS: { value: VideoPreset; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "balanced", label: "Balanced" },
  { value: "high", label: "High" },
];

const CODECS: { value: VideoCodec; title: string; description: string }[] = [
  { value: "h264", title: "H.264", description: "Universal, fast" },
  { value: "vp9", title: "VP9", description: "Smaller files" },
  { value: "av1", title: "AV1", description: "Smallest, slowest" },
];

const CODEC_LABEL: Record<VideoCodec, string> = { h264: "H.264", vp9: "VP9", av1: "AV1" };
const PRESET_LABEL: Record<VideoPreset, string> = { low: "Low", balanced: "Balanced", high: "High" };

interface RemoteBatch {
  count: number;
  /** Position of the file uploading now, 0-based. */
  index: number;
  name: string;
  /** Bytes on the server across the batch, and the batch's total. */
  sent: number;
  total: number;
  /** Bytes that were already on the server from an earlier, interrupted attempt. */
  resumed: number | null;
}

const NO_REMOTE: RemoteBatch = { count: 0, index: 0, name: "", sent: 0, total: 0, resumed: null };

const isVideo = (f: File) =>
  f.type.startsWith("video/") || /\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|mpe?g|3gp|ts)$/i.test(f.name);

/**
 * Turns an encoder error into something short enough to sit on a job row. The full
 * message still goes to the console; this is the one-liner that explains why a file
 * the browser was supposed to handle went to the server instead.
 */
function fallbackReason(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  const undecodable = /cannot decode (\S+)/i.exec(message);
  if (undecodable) return `your browser can’t decode ${undecodable[1].toUpperCase()}`;
  if (/cannot encode/i.test(message)) return "your browser can’t encode this size or codec";
  if (/no video (stream|track)/i.test(message)) return "no video track your browser can use";
  return "the browser encode failed";
}

export default function VideoPage() {
  const [pending, setPending] = useState<File[]>([]);
  const [preset, setPreset] = useState<VideoPreset>("balanced");
  const [codec, setCodec] = useState<VideoCodec>("h264");
  const [width, setWidth] = useState("");
  const [mute, setMute] = useState(false);
  const [uploading, setUploading] = useState(false);
  // The part of the current batch going to the server; the upload card is
  // meaningless for a batch encoded entirely in the browser.
  const [remote, setRemote] = useState<RemoteBatch>(NO_REMOTE);
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [etas, setEtas] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  // First moment a job reported real progress, used to extrapolate a finish time
  const encodeStart = useRef<Map<string, number>>(new Map());
  /** Output of locally-encoded jobs, held until the user downloads it. */
  const blobs = useRef<Map<string, LocalVideoResult>>(new Map());
  /** The batch upload in flight, so Cancel can stop it. */
  const activeUpload = useRef<ResumableUpload | null>(null);
  const cancelledBatch = useRef(false);

  useEncodingFlag(jobs.some((j) => j.local && j.status === "processing"));

  const { start: startPolling, stale } = useJobPoller<VideoJob>({
    fetchStatus: getVideoStatus,
    onUpdate: (jobId, updated) => {
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
      if (TERMINAL.has(updated.status)) encodeStart.current.delete(jobId);
    },
    isDone: (j) => TERMINAL.has(j.status),
    onGone: (jobId) =>
      setJobs((prev) =>
        prev.map((j) =>
          j.id === jobId ? { ...j, status: "failed" as JobStatus, error_message: GONE_MESSAGE } : j
        )
      ),
  });

  /**
   * Upload the batch's server-bound files one at a time (resumable, in chunks), so
   * each job appears and starts encoding as soon as its own upload finishes.
   */
  const sendToServer = useCallback(
    async (files: File[], w: number | null) => {
      const total = files.reduce((s, f) => s + f.size, 0);
      let before = 0; // bytes of files already finished in this batch
      for (const [i, file] of files.entries()) {
        if (cancelledBatch.current) return;
        setRemote((r) => ({ ...r, name: file.name, index: i }));
        const upload = uploadVideoResumable(
          file,
          { preset, codec, width: w, mute },
          (sent) => setRemote((r) => ({ ...r, sent: before + sent, total })),
          (already) => setRemote((r) => ({ ...r, resumed: (r.resumed ?? 0) + already }))
        );
        activeUpload.current = upload;
        try {
          const job = await upload.done;
          setJobs((prev) => [job, ...prev]);
          startPolling(job.id);
        } catch (e) {
          if (e instanceof UploadCancelled) return;
          throw e;
        } finally {
          activeUpload.current = null;
        }
        before += file.size;
      }
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
        const job = await uploadVideoResumable(file, { preset, codec, width: w, mute }).done;
        setJobs((prev) => prev.map((j) => (j.id === localId ? { ...job, fallback_reason: reason } : j)));
        startPolling(job.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Encoding failed";
        setJobs((prev) =>
          prev.map((j) =>
            j.id === localId ? { ...j, status: "failed" as JobStatus, error_message: message } : j
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
        setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, progress_percent: percent } : j)));
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
                  savings_percent: file.size ? Math.round((1 - result.blob.size / file.size) * 100) : 0,
                  // The API stores whole seconds; round so both paths render alike.
                  duration_seconds:
                    result.durationSeconds == null ? null : Math.round(result.durationSeconds),
                  processed_at: new Date().toISOString(),
                }
              : j
          )
        );
      } catch (e) {
        // The row shows a short reason; the full error is the first thing worth
        // knowing when the browser path underperforms.
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
    cancelledBatch.current = false;

    const files = pending;
    const w = width ? parseInt(width, 10) : null;
    setPending([]);
    setWidth("");

    // Files this browser can encode never leave the device; the rest go to the API.
    const local = files.filter((f) => canEncodeLocally(f, codec));
    const toServer = files.filter((f) => !canEncodeLocally(f, codec));

    setRemote({
      ...NO_REMOTE,
      count: toServer.length,
      total: toServer.reduce((s, f) => s + f.size, 0),
      name: toServer[0]?.name ?? "",
    });
    setUploading(true);
    try {
      await Promise.all([
        ...(toServer.length ? [sendToServer(toServer, w)] : []),
        ...local.map((f) => runLocal(f, w)),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      setRemote(NO_REMOTE);
    }
  };

  const cancelUpload = () => {
    cancelledBatch.current = true;
    void activeUpload.current?.cancel();
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

  const items = useMemo<QueueItem[]>(
    () =>
      jobs.map((j) => {
        const meta = [
          CODEC_LABEL[j.codec],
          PRESET_LABEL[j.preset],
          j.target_width ? `${j.target_width}px` : null,
          j.mute ? "No audio" : null,
          fmtDuration(j.duration_seconds),
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          id: j.id,
          name: j.original_filename,
          status: j.status,
          originalBytes: j.original_size_bytes,
          processedBytes: j.processed_size_bytes,
          savingsPercent: j.savings_percent,
          local: j.local,
          meta,
          note: noteFor(j, stale.has(j.id)),
          progress: { percent: j.progress_percent, eta: etas[j.id] ?? null },
          canDownload: canDownload(j),
        };
      }),
    [jobs, etas, stale]
  );

  const uploadingRemote = uploading && remote.count > 0;

  return (
    <ToolLayout
      title="Compress video"
      description="Re-encode with H.264, VP9 or AV1. H.264, HEVC, VP9 and AV1 sources encode in your browser; camera formats like ProRes go to the server."
      queue={
        <JobQueue
          items={items}
          onDownload={(id) => {
            const job = jobs.find((j) => j.id === id);
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
        accept="video/*"
        files={pending}
        accepts={isVideo}
        noun="video"
        hint="MP4, MOV, WebM, MKV · up to 2 GB each, 5 per batch"
        icon={Video}
        onAdd={(f) => setPending((p) => [...p, ...f])}
        onRemove={(i) => setPending((p) => p.filter((_, k) => k !== i))}
        onClear={() => setPending([])}
      />

      <OptionsCard>
        <Segmented
          label="Preset"
          value={preset}
          options={PRESETS}
          onChange={setPreset}
          className="sm:col-span-2"
        />
        <RadioCards
          legend="Codec"
          name="codec"
          value={codec}
          options={CODECS}
          onChange={setCodec}
          columns={3}
          className="sm:col-span-2"
        />
        <UnitInput
          label="Resize width"
          optional
          value={width}
          onChange={setWidth}
          unit="px"
          placeholder="Keep original"
          max={7680}
        />
        <div className="flex flex-col justify-end">
          <SwitchField label="Remove audio" checked={mute} onChange={setMute} />
        </div>
      </OptionsCard>

      <CompressButton
        count={pending.length}
        loading={uploading}
        loadingLabel={uploadingRemote ? "Uploading…" : "Encoding…"}
        onClick={handleUpload}
      />

      {uploadingRemote && (
        <UploadProgress
          label={
            remote.count > 1
              ? `Uploading ${remote.name} (${remote.index + 1} of ${remote.count})`
              : `Uploading ${remote.name}`
          }
          sentBytes={remote.sent}
          totalBytes={remote.total}
          resumedBytes={remote.resumed}
          onCancel={cancelUpload}
        />
      )}
    </ToolLayout>
  );
}
