/**
 * Client-side compression entry point.
 *
 * `page.tsx` talks to this module only — it never imports a codec or touches the
 * worker directly. Callers get back a finished Blob or an Error; on an Error the
 * caller is expected to retry that file against the server API.
 */

import type { CompressRequest, CompressResponse, WorkerFormat } from "./workers/compress.worker";

export interface LocalResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

export interface LocalOptions {
  format: WorkerFormat;
  width: number | null;
  quality: number;
}

interface Task {
  req: CompressRequest;
  originalName: string;
  resolve: (r: LocalResult) => void;
  reject: (e: Error) => void;
}

/**
 * AVIF in particular pegs a core for seconds, so cap concurrency well below the
 * core count and leave the main thread room to keep rendering.
 */
function poolSize(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined;
  return Math.min(4, Math.max(1, (cores ?? 2) - 1));
}

class WorkerPool {
  private readonly size = poolSize();
  private idle: Worker[] = [];
  private busy = new Map<Worker, Task>();
  private queue: Task[] = [];
  private spawned = 0;

  private spawn(): Worker {
    const worker = new Worker(new URL("./workers/compress.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<CompressResponse>) => this.settle(worker, e.data);
    // A dead worker can't report which task it killed, so the pool reads it off `busy`.
    worker.onerror = () => this.crash(worker, "Compression worker failed to start");
    worker.onmessageerror = () => this.crash(worker, "Compression worker sent an unreadable message");
    this.spawned += 1;
    return worker;
  }

  private acquire(): Worker | null {
    const free = this.idle.pop();
    if (free) return free;
    if (this.spawned < this.size) return this.spawn();
    return null;
  }

  private dispatch(worker: Worker, task: Task): void {
    this.busy.set(worker, task);
    worker.postMessage(task.req);
  }

  private pump(): void {
    while (this.queue.length) {
      const worker = this.acquire();
      if (!worker) return;
      this.dispatch(worker, this.queue.shift()!);
    }
  }

  private settle(worker: Worker, res: CompressResponse): void {
    const task = this.busy.get(worker);
    this.busy.delete(worker);
    this.idle.push(worker);

    if (task) {
      if (res.ok) {
        task.resolve({
          blob: new Blob([res.buffer], { type: res.mimeType }),
          filename: renameTo(task.originalName, res.extension),
          width: res.width,
          height: res.height,
        });
      } else {
        task.reject(new Error(res.error));
      }
    }
    this.pump();
  }

  private crash(worker: Worker, message: string): void {
    const task = this.busy.get(worker);
    this.busy.delete(worker);
    this.idle = this.idle.filter((w) => w !== worker);
    worker.terminate();
    this.spawned -= 1;
    task?.reject(new Error(message));
    this.pump();
  }

  run(file: File, opts: LocalOptions): Promise<LocalResult> {
    return new Promise<LocalResult>((resolve, reject) => {
      const task: Task = {
        req: {
          id: crypto.randomUUID(),
          file,
          format: opts.format,
          width: opts.width,
          quality: opts.quality,
        },
        originalName: file.name,
        resolve,
        reject,
      };
      const worker = this.acquire();
      if (worker) this.dispatch(worker, task);
      else this.queue.push(task);
    });
  }
}

/** Mirrors the server's `{stem}{ext}` output naming. */
function renameTo(originalName: string, extension: string): string {
  const dot = originalName.lastIndexOf(".");
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}${extension}`;
}

let pool: WorkerPool | null = null;

/**
 * Compress one file in the browser. Rejects if the browser, the codec, or the
 * file itself won't cooperate — callers fall back to the server on rejection.
 */
export function compressLocally(file: File, opts: LocalOptions): Promise<LocalResult> {
  if (!pool) pool = new WorkerPool();
  return pool.run(file, opts);
}
