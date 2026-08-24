/**
 * Off-main-thread image compression.
 *
 * Decoding and resizing use the browser's own image pipeline (`createImageBitmap`
 * + `OffscreenCanvas`), so no decoder WASM is shipped. Only the *encoders* are
 * WASM, and each is dynamically imported the first time its format is requested.
 *
 * Encoder settings mirror `app/services/image_processor.py` so a file compressed
 * here and the same file compressed on the server land in the same ballpark.
 */

export type WorkerFormat = "webp" | "avif" | "original";

export interface CompressRequest {
  id: string;
  file: File;
  format: WorkerFormat;
  width: number | null;
  quality: number;
}

export type CompressResponse =
  | {
      id: string;
      ok: true;
      buffer: ArrayBuffer;
      mimeType: string;
      extension: string;
      width: number;
      height: number;
    }
  | { id: string; ok: false; error: string };

const ctx = self as unknown as {
  postMessage(message: CompressResponse, transfer?: Transferable[]): void;
  addEventListener(type: "message", handler: (e: MessageEvent<CompressRequest>) => void): void;
};

const JPEG_TYPES = new Set(["image/jpeg", "image/jpg"]);

/** Draw a source into a fresh canvas at the given size. */
function drawTo(src: CanvasImageSource, w: number, h: number, whiteBackground: boolean): OffscreenCanvas {
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D context unavailable in worker");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  // JPEG has no alpha channel; matching the server, transparency flattens onto white.
  if (whiteBackground) {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
  }
  g.drawImage(src, 0, 0, w, h);
  return canvas;
}

/**
 * Decode, optionally resize, and hand back raw pixels.
 *
 * Canvas downscaling is bilinear, which smears detail when shrinking a lot in one
 * step. Halving repeatedly until the last step is under 2x keeps the result close
 * to the server's LANCZOS output.
 */
async function toImageData(
  file: File,
  targetWidth: number | null,
  whiteBackground: boolean
): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let outW = bitmap.width;
    let outH = bitmap.height;
    if (targetWidth && targetWidth !== bitmap.width) {
      outW = targetWidth;
      outH = Math.max(1, Math.round(bitmap.height * (targetWidth / bitmap.width)));
    }

    let src: CanvasImageSource = bitmap;
    let curW = bitmap.width;
    let curH = bitmap.height;
    while (curW / 2 > outW) {
      curW = Math.max(outW, Math.round(curW / 2));
      curH = Math.max(outH, Math.round(curH / 2));
      src = drawTo(src, curW, curH, false);
    }

    const canvas = drawTo(src, outW, outH, whiteBackground);
    const g = canvas.getContext("2d");
    if (!g) throw new Error("2D context unavailable in worker");
    return g.getImageData(0, 0, outW, outH);
  } finally {
    bitmap.close();
  }
}

async function encodeWebp(data: ImageData, quality: number): Promise<ArrayBuffer> {
  const { default: encode } = await import("@jsquash/webp/encode");
  return encode(data, {
    quality,
    method: 6, // matches Pillow's method=6
    lossless: quality >= 100 ? 1 : 0,
  });
}

async function encodeAvif(data: ImageData, quality: number): Promise<ArrayBuffer> {
  const { default: encode } = await import("@jsquash/avif/encode");
  return encode(data, { quality, lossless: quality >= 100 });
}

async function encodeJpeg(data: ImageData, quality: number): Promise<ArrayBuffer> {
  const { default: encode } = await import("@jsquash/jpeg/encode");
  // mozjpeg's auto_subsample picks 4:4:4 at high quality, which Pillow does not —
  // pinning 4:2:0 keeps output size in line with the server path.
  return encode(data, {
    quality,
    progressive: true,
    optimize_coding: true,
    auto_subsample: false,
    chroma_subsample: 2,
  });
}

async function encodePng(data: ImageData): Promise<ArrayBuffer> {
  const { default: optimise } = await import("@jsquash/oxipng/optimise");
  return optimise(data, { level: 2, interlace: false, optimiseAlpha: false });
}

function extensionFor(name: string, fallback: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : fallback;
}

async function compress(req: CompressRequest): Promise<CompressResponse> {
  const { file, format, width, quality } = req;
  const targetsJpeg = format === "original" && JPEG_TYPES.has(file.type);

  const data = await toImageData(file, width, targetsJpeg);

  let buffer: ArrayBuffer;
  let mimeType: string;
  let extension: string;

  if (format === "webp") {
    buffer = await encodeWebp(data, quality);
    mimeType = "image/webp";
    extension = ".webp";
  } else if (format === "avif") {
    buffer = await encodeAvif(data, quality);
    mimeType = "image/avif";
    extension = ".avif";
  } else if (targetsJpeg) {
    buffer = await encodeJpeg(data, Math.min(quality, 100));
    mimeType = "image/jpeg";
    extension = extensionFor(file.name, ".jpg");
  } else if (file.type === "image/png") {
    buffer = await encodePng(data);
    mimeType = "image/png";
    extension = ".png";
  } else if (file.type === "image/webp") {
    buffer = await encodeWebp(data, quality);
    mimeType = "image/webp";
    extension = ".webp";
  } else {
    throw new Error(`Cannot re-encode ${file.type} locally`);
  }

  return {
    id: req.id,
    ok: true,
    buffer,
    mimeType,
    extension,
    width: data.width,
    height: data.height,
  };
}

ctx.addEventListener("message", (e: MessageEvent<CompressRequest>) => {
  compress(e.data).then(
    (res) => ctx.postMessage(res, res.ok ? [res.buffer] : []),
    (err: unknown) =>
      ctx.postMessage({
        id: e.data.id,
        ok: false,
        error: err instanceof Error ? err.message : "Compression failed",
      })
  );
});
