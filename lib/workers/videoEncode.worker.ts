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
  AUDIO_BITRATE,
  CONTAINER,
  MEDIABUNNY_CODEC,
  targetBitrate,
} from "../videoSupport";

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
 * Collects the output into a Blob without holding it on the JS heap: each chunk is
 * wrapped in its own Blob straight away, which lets the browser page it to disk.
 *
 * MP4 is written with `fastStart: false`, so writes are append-only. A non-sequential
 * write would mean that assumption broke — throwing routes the file to the server
 * rather than producing a corrupt output.
 */
function createBlobTarget() {
  const parts: Blob[] = [];
  let offset = 0;

  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      if (chunk.position !== offset) {
        throw new Error("Encoder produced a non-sequential write");
      }
      parts.push(new Blob([chunk.data]));
      offset += chunk.data.byteLength;
    },
  });

  return { writable, collect: (mimeType: string) => new Blob(parts, { type: mimeType }) };
}

function renameTo(originalName: string, extension: string): string {
  const dot = originalName.lastIndexOf(".");
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}${extension}`;
}

async function transcode(req: VideoEncodeRequest): Promise<VideoEncodeResponse> {
  const { file, codec, preset, width, mute } = req;
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

    const durationSeconds = await input.getDurationFromMetadata().catch(() => null);
    // Frame rate drives the bitrate target; packet stats are cheap next to the encode.
    const frameRate = await track
      .computePacketStats(100)
      .then((stats) => stats.averagePacketRate || 30)
      .catch(() => 30);

    const { writable, collect } = createBlobTarget();
    const output = new Output({
      format:
        codec === "vp9"
          ? new WebMOutputFormat()
          : new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(writable, { chunked: true }),
    });

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
            quality: new Quality({ bitrate: AUDIO_BITRATE[preset] }),
          },
      showWarnings: false,
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((t) => t.reason).join(", ");
      throw new Error(`Cannot convert this file${reasons ? `: ${reasons}` : ""}`);
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
      blob: collect(mimeType),
      filename: renameTo(file.name, extension),
      durationSeconds,
    };
  } finally {
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
