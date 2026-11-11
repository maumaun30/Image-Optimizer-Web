import { describe, expect, it } from "vitest";
import { CHUNK_BYTES } from "./resumableUpload";

describe("CHUNK_BYTES", () => {
  it("fits under Cloudflare's 100 MB request cap and the server's 40 MB chunk limit", () => {
    expect(CHUNK_BYTES).toBeLessThanOrEqual(40 * 1024 * 1024);
    expect(CHUNK_BYTES).toBeLessThan(100 * 1000 * 1000);
  });
});
