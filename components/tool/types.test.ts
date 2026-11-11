import { describe, expect, it } from "vitest";
import { canDownload, noteFor } from "./types";

const job = { status: "processing" as const, error_message: null };

describe("noteFor", () => {
  it("is empty for a healthy job", () => {
    expect(noteFor(job)).toBeUndefined();
  });
  it("warns when status checks keep failing", () => {
    expect(noteFor(job, true)?.kind).toBe("warning");
  });
  it("doesn't warn about reachability once a job is finished", () => {
    expect(noteFor({ ...job, status: "ready" }, true)).toBeUndefined();
  });
  it("shows the server's error on failure", () => {
    expect(noteFor({ status: "failed", error_message: "bad file" })).toEqual({ kind: "error", text: "bad file" });
  });
  it("explains expiry", () => {
    expect(noteFor({ status: "expired", error_message: null })?.kind).toBe("warning");
  });
  it("explains a fallback to the server, with details on demand", () => {
    const note = noteFor({ ...job, fallback_reason: "your browser can’t encode AV1" });
    expect(note?.text).toBe("Sent to server: your browser can’t encode AV1");
    expect(note?.detail).toBeTruthy();
  });
});

describe("canDownload", () => {
  it.each([
    [{ status: "ready" as const }, true],
    [{ status: "downloaded" as const }, true], // server grace window
    [{ status: "downloaded" as const, local: true }, false], // browser result released
    [{ status: "processing" as const }, false],
    [{ status: "failed" as const }, false],
  ])("%o → %s", (j, out) => {
    expect(canDownload(j)).toBe(out);
  });
});
