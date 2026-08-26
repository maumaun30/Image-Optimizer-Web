/**
 * In-browser video transcoding, off the main thread.
 *
 * mediabunny drives WebCodecs: hardware decode and encode where the device offers it.
 * The source is never read into memory — `BlobSource` reads ranges off the `File` on
 * demand — and output chunks are handed to the Blob store as they are produced, so a
 * multi-gigabyte input never materialises on the JS heap.
 *
 * Encoder parameters mirror `app/services/video_processor.py`; see `lib/videoSupport.ts`.
 */

import {
  ALL_FORMATS,
  BlobSource,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WebMOutputFormat,
  canEncodeVideo,
  type StreamTargetChunk,
} from "mediabunny";

import type { VideoCodec, VideoPreset } from "../api";
import {
  CONTAINER,
  MEDIABUNNY_CODEC,
  audioBitrate,
  targetBitrate,
} from "../videoSupport";

// TypeScript's DOM lib predates OPFS directory iteration and sync access handles.
declare global {
  interface FileSystemDirectoryHandle {
    keys(): AsyncIterableIterator<string>;
  }
  interface FileSystemFileHandle {
    createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
  }
  interface FileSystemSyncAccessHandle {
    write(buffer: BufferSource, options?: { at?: number }): number;
    truncate(size: number): void;
    flush(): void;
    close(): void;
  }
}

export interface VideoEncodeRequest {
  id: string;
  file: File;
  codec: VideoCodec;
  preset: VideoPreset;
  width: number | null;
  mute: boolean;
}

export type VideoEncodeResponse =
  | { id: string; type: "progress"; percent: number }
  | {
      id: string;
      type: "done";
      blob: Blob;
      filename: string;
      durationSeconds: number | null;
    }
  | { id: string; type: "error"; error: string };

const ctx = self as unknown as {
  postMessage(message: VideoEncodeResponse): void;
  addEventListener(type: "message", handler: (e: MessageEvent<VideoEncodeRequest>) => void): void;
};

/**
 * Collects the output into a Blob without holding it on the JS heap.
 *
 * Writes are NOT append-only: with `fastStart: false` the MP4 muxer seeks back to
 * patch the `mdat` box header once its final size is known, and mediabunny only
 * guarantees monotonic writes for `'in-memory'` and `'fragmented'`. So the sink has to
 * support positioned writes — it backs onto an OPFS scratch file via a sync access
 * handle, which gives random access on disk rather than in memory.
 *
 * The file is copied into a Blob and deleted once the encode finishes; leftovers from
 * a crashed encode are swept on the next run.
 */
async function createSeekableTarget(id: string) {
  const root = await navigator.storage.getDirectory();
  const name = `encode-${id}.tmp`;

  for await (const entry of root.keys()) {
    if (entry.startsWith("encode-") && entry !== name) {
      await root.removeEntry(entry).catch(() => {});
    }
  }

  const handle = await root.getFileHandle(name, { create: true });
  const access = await handle.createSyncAccessHandle();
  access.truncate(0);

  let closed = false;
  const release = () => {
    if (!closed) {
      closed = true;
      access.close();
    }
  };

  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      access.write(chunk.data, { at: chunk.position });
    },
    close() {
      access.flush();
      release();
    },
    abort: release,
  });

  return {
    writable,
    async collect(mimeType: string): Promise<Blob> {
      release();
      const file = await handle.getFile();
      // Copied in slices so the whole output never sits in one ArrayBuffer; the parts
      // are browser-managed Blobs, which lets the scratch file be deleted right after.
      const SLICE_BYTES = 8 * 1024 * 1024;
      const parts: Blob[] = [];
      for (let offset = 0; offset < file.size; offset += SLICE_BYTES) {
        parts.push(new Blob([await file.slice(offset, offset + SLICE_BYTES).arrayBuffer()]));
      }
      await root.removeEntry(name).catch(() => {});
      return new Blob(parts, { type: mimeType });
    },
    discard: () => {
      release();
      void root.removeEntry(name).catch(() => {});
    },
  };
}

function renameTo(originalName: string, extension: string): string {
  const dot = originalName.lastIndexOf(".");
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}${extension}`;
}

async function transcode(req: VideoEncodeRequest): Promise<VideoEncodeResponse> {
  const { file, codec, preset, width, mute } = req;
  let target: Awaited<ReturnType<typeof createSeekableTarget>> | null = null;
  let collected = false;
  const mbCodec = MEDIABUNNY_CODEC[codec];
  const { extension, mimeType } = CONTAINER[codec];

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("File contains no video stream");

    const sourceWidth = await track.getDisplayWidth();
    const sourceHeight = await track.getDisplayHeight();

    // Never upscale, and keep dimensions even — the server's scale filter uses -2 for
    // the same reason: yuv420p encoders require it.
    let targetWidth: number | undefined;
    if (width) {
      const clamped = Math.min(width, sourceWidth);
      targetWidth = clamped - (clamped % 2);
    }

    const outputWidth = targetWidth ?? sourceWidth;
    const outputHeight = targetWidth
      ? Math.round((sourceHeight * targetWidth) / sourceWidth)
      : sourceHeight;

    if (!(await canEncodeVideo(mbCodec, { width: outputWidth, height: outputHeight }))) {
      throw new Error(`This browser cannot encode ${codec} at ${outputWidth}x${outputHeight}`);
    }

    // Encodability is only half of it: the source has to be decodable too. WebCodecs
    // decoder coverage varies by platform (HEVC especially), and a track mediabunny
    // cannot decode is dropped rather than failing the conversion — see the
    // discardedTracks guard below.
    if (!(await track.canDecode())) {
      throw new Error(`This browser cannot decode ${track.codec ?? "this video codec"}`);
    }

    const durationSeconds = await input.getDurationFromMetadata().catch(() => null);
    // Frame rate drives the bitrate target; packet stats are cheap next to the encode.
    const frameRate = await track
      .computePacketStats(100)
      .then((stats) => stats.averagePacketRate || 30)
      .catch(() => 30);

    target = await createSeekableTarget(req.id);
    const output = new Output({
      format:
        codec === "vp9"
          ? new WebMOutputFormat()
          : new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(target.writable, { chunked: true }),
    });

    const collectOutput = async () => {
      const blob = await target!.collect(mimeType);
      collected = true;

      // Last line of defence: parse the finished file back and confirm the video
      // survived. The guards above cover the failures mediabunny reports, but an
      // encoder that yields no packets produces a silently audio-only file, which is
      // worse than falling back to the server. Metadata-only, so it is cheap.
      const check = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
      try {
        if (!(await check.getPrimaryVideoTrack())) {
          throw new Error("Browser encode produced a file with no video track");
        }
      } finally {
        check.dispose();
      }

      return blob;
    };

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: mbCodec,
        width: targetWidth,
        // Bitrate, not quantizer: WebCodecs' quantizer is a fixed QP rather than
        // ffmpeg's adaptive CRF, and reusing the server's CRF numbers made files
        // roughly 2.3x larger. See lib/videoSupport.ts.
        quality: new Quality({
          bitrate: targetBitrate(codec, preset, outputWidth, outputHeight, frameRate),
          bitrateMode: "variable",
        }),
      },
      audio: mute
        ? { discard: true }
        : {
            codec: codec === "vp9" ? "opus" : "aac",
            quality: new Quality({ bitrate: audioBitrate(codec, preset) }),
          },
      showWarnings: false,
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((t) => t.reason).join(", ");
      throw new Error(`Cannot convert this file${reasons ? `: ${reasons}` : ""}`);
    }

    // `isValid` only means the output has at least one track — a conversion that
    // dropped the video and kept the audio counts as valid and would silently write
    // an audio-only file. Anything short of the video track surviving is a failure
    // here, so the caller falls back to the server.
    const droppedVideo = conversion.discardedTracks.find((t) => t.track.type === "video");
    if (droppedVideo) {
      throw new Error(`Video track dropped by the browser encoder: ${droppedVideo.reason}`);
    }
    if (!conversion.utilizedTracks.some((t) => t.type === "video")) {
      throw new Error("Browser encoder produced no video track");
    }

    let lastReported = 0;
    conversion.onProgress = (progress) => {
      const percent = Math.min(99, Math.round(progress * 100));
      if (percent > lastReported) {
        lastReported = percent;
        ctx.postMessage({ id: req.id, type: "progress", percent });
      }
    };

    await conversion.execute();

    return {
      id: req.id,
      type: "done",
      blob: await collectOutput(),
      filename: renameTo(file.name, extension),
      durationSeconds,
    };
  } finally {
    // A failed encode leaves a scratch file behind; drop it rather than waiting for
    // the next run's sweep.
    if (target && !collected) target.discard();
    input.dispose();
  }
}

ctx.addEventListener("message", (e: MessageEvent<VideoEncodeRequest>) => {
  transcode(e.data).then(
    (res) => ctx.postMessage(res),
    (err: unknown) =>
      ctx.postMessage({
        id: e.data.id,
        type: "error",
        error: err instanceof Error ? err.message : "Encoding failed",
      })
  );
});
