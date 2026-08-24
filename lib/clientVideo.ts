/**
 * Client-side video encoding entry point.
 *
 * `app/video/page.tsx` talks to this module only. On rejection the caller falls back
 * to the server API, exactly as the image path does.
 *
 * One encode runs at a time, mirroring the server's dedicated video worker running at
 * `--concurrency=1`: parallel transcodes would contend for the same encoder hardware
 * and just make every file slower.
 */

import type { VideoCodec, VideoPreset } from "./api";
import type { VideoEncodeRequest, VideoEncodeResponse } from "./workers/videoEncode.worker";

export interface LocalVideoResult {
  blob: Blob;
  filename: string;
  durationSeconds: number | null;
}

export interface LocalVideoOptions {
  codec: VideoCodec;
  preset: VideoPreset;
  width: number | null;
  mute: boolean;
}

interface Task {
  req: VideoEncodeRequest;
  onProgress: (percent: number) => void;
  resolve: (r: LocalVideoResult) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let current: Task | null = null;
const queue: Task[] = [];

function spawn(): Worker {
  const w = new Worker(new URL("./workers/videoEncode.worker.ts", import.meta.url), {
    type: "module",
  });
  w.onmessage = (e: MessageEvent<VideoEncodeResponse>) => handle(e.data);
  w.onerror = () => crash("Video encoder failed to start");
  w.onmessageerror = () => crash("Video encoder sent an unreadable message");
  return w;
}

function handle(res: VideoEncodeResponse): void {
  const task = current;
  if (!task || task.req.id !== res.id) return;

  if (res.type === "progress") {
    task.onProgress(res.percent);
    return;
  }

  current = null;
  if (res.type === "done") {
    task.resolve({
      blob: res.blob,
      filename: res.filename,
      durationSeconds: res.durationSeconds,
    });
  } else {
    task.reject(new Error(res.error));
  }
  pump();
}

function crash(message: string): void {
  const task = current;
  current = null;
  worker?.terminate();
  worker = null;
  task?.reject(new Error(message));
  pump();
}

function pump(): void {
  if (current || !queue.length) return;
  current = queue.shift()!;
  if (!worker) worker = spawn();
  worker.postMessage(current.req);
}

/** Encode one video in the browser. Rejects so the caller can retry against the API. */
export function encodeVideoLocally(
  file: File,
  opts: LocalVideoOptions,
  onProgress: (percent: number) => void
): Promise<LocalVideoResult> {
  return new Promise<LocalVideoResult>((resolve, reject) => {
    queue.push({
      req: {
        id: crypto.randomUUID(),
        file,
        codec: opts.codec,
        preset: opts.preset,
        width: opts.width,
        mute: opts.mute,
      },
      onProgress,
      resolve,
      reject,
    });
    pump();
  });
}
