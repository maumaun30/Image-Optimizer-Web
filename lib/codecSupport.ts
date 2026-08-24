/**
 * Feature probe for the in-browser compression path.
 *
 * Everything here is cheap and synchronous — the expensive WASM codecs are only
 * fetched once a file actually needs encoding (see `lib/workers/compress.worker.ts`).
 */

/** Above this, encoding in a tab risks an out-of-memory crash — send it to the server instead. */
export const LOCAL_MAX_BYTES = 32 * 1024 * 1024;

/** Source types `createImageBitmap` can decode everywhere we care about. */
const DECODABLE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/bmp"]);

/** Source types we can re-encode in their own format for `format=original`. */
const REENCODABLE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

let cached: boolean | null = null;

/** True when this browser can run the local pipeline at all. Result is memoised. */
export function browserSupportsLocal(): boolean {
  if (cached !== null) return cached;
  cached =
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap === "function";
  return cached;
}

/**
 * Whether one file should be compressed locally. Anything returning false goes
 * down the existing server path — this is a routing decision, not an error.
 */
export function canCompressLocally(file: File, format: "webp" | "avif" | "original"): boolean {
  if (!browserSupportsLocal()) return false;
  if (file.size > LOCAL_MAX_BYTES) return false;
  if (!DECODABLE.has(file.type)) return false;
  if (format === "original" && !REENCODABLE.has(file.type)) return false;
  return true;
}
