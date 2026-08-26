/**
 * Routing and encoder-parameter tables for the in-browser video path.
 *
 * Rate control differs from the server and cannot be made identical. ffmpeg encodes
 * with CRF, which varies the bitrate with scene complexity. WebCodecs offers only a
 * fixed quantizer or a target bitrate — a fixed quantizer at the server's CRF numbers
 * measured ~2.3x larger on high-detail content, so this path uses bitrate instead.
 *
 * The bitrates below are calibrated so a browser encode lands near the server's output
 * for the same preset, but the two will not match exactly, and simple footage will come
 * out larger here than CRF would have made it.
 */

import type { VideoCodec, VideoPreset } from "./api";

/** Same ceiling as the server's MAX_VIDEO_SIZE_MB default. */
export const LOCAL_MAX_VIDEO_BYTES = 2 * 1024 ** 3;

/** Our API's codec names mapped to mediabunny's. */
export const MEDIABUNNY_CODEC = { h264: "avc", vp9: "vp9", av1: "av1" } as const;
export type MediabunnyCodec = (typeof MEDIABUNNY_CODEC)[VideoCodec];

export const CONTAINER: Record<VideoCodec, { extension: string; mimeType: string }> = {
  h264: { extension: ".mp4", mimeType: "video/mp4" },
  vp9: { extension: ".webm", mimeType: "video/webm" },
  av1: { extension: ".mp4", mimeType: "video/mp4" },
};

/** Matches the server's `_AUDIO_BITRATE` table in `app/services/video_processor.py`. */
export const AUDIO_BITRATE: Record<VideoPreset, number> = {
  low: 64_000,
  balanced: 96_000,
  high: 128_000,
};

/**
 * Chrome's AAC encoder rejects the `low` preset's 64 kbps outright — the whole encode
 * fails with "Encoding error." — where ffmpeg's aac encoder accepts it happily. 96 kbps
 * is the lowest value observed to configure, so AAC is floored there. Opus has no such
 * problem and keeps server parity at every preset.
 */
const AAC_MIN_BITRATE = 96_000;

export function audioBitrate(codec: VideoCodec, preset: VideoPreset): number {
  const bitrate = AUDIO_BITRATE[preset];
  return codec === "vp9" ? bitrate : Math.max(bitrate, AAC_MIN_BITRATE);
}

/**
 * Bits per pixel per frame. Calibrated against server output at 1080p30: the server's
 * balanced H.264 preset produced ~2.9 Mbps on a high-detail clip, which is 0.045 bpp.
 */
const BITS_PER_PIXEL: Record<VideoCodec, Record<VideoPreset, number>> = {
  h264: { low: 0.025, balanced: 0.045, high: 0.08 },
  vp9: { low: 0.018, balanced: 0.032, high: 0.058 },
  av1: { low: 0.014, balanced: 0.026, high: 0.046 },
};

export function targetBitrate(
  codec: VideoCodec,
  preset: VideoPreset,
  width: number,
  height: number,
  frameRate: number
): number {
  const bitrate = width * height * frameRate * BITS_PER_PIXEL[codec][preset];
  return Math.round(Math.min(Math.max(bitrate, 150_000), 40_000_000));
}

function hasWebCodecs(): boolean {
  const g = globalThis as { VideoEncoder?: unknown; VideoDecoder?: unknown };
  return typeof g.VideoEncoder !== "undefined" && typeof g.VideoDecoder !== "undefined";
}

let cached: boolean | null = null;

export function browserSupportsLocalVideo(): boolean {
  if (cached !== null) return cached;
  cached = typeof Worker !== "undefined" && hasWebCodecs();
  return cached;
}

/**
 * AV1 is deliberately excluded: no browser ships a hardware AV1 encoder, so it would
 * run on libaom in software and lose badly to the server's libsvtav1.
 */
const LOCAL_CODECS = new Set<VideoCodec>(["h264", "vp9"]);

export function canEncodeLocally(file: File, codec: VideoCodec): boolean {
  if (!browserSupportsLocalVideo()) return false;
  if (file.size > LOCAL_MAX_VIDEO_BYTES) return false;
  return LOCAL_CODECS.has(codec);
}
