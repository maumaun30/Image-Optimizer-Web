import { describe, expect, it } from "vitest";
import { fmtBytes, fmtDuration, fmtEta } from "./format";

describe("fmtBytes", () => {
  it.each([
    [null, "—"],
    [0, "0 B"],
    [840, "840 B"],
    [12.4 * 1024, "12.4 KB"],
    [3.1 * 1024 ** 2, "3.1 MB"],
    [1.46 * 1024 ** 3, "1.46 GB"],
  ])("%s → %s", (bytes, out) => {
    expect(fmtBytes(bytes)).toBe(out);
  });
});

describe("fmtEta", () => {
  it("rounds to what a person can act on", () => {
    expect(fmtEta(0.2)).toBe("1s left");
    expect(fmtEta(42)).toBe("42s left");
    expect(fmtEta(125)).toBe("about 2 min left");
    expect(fmtEta(2 * 3600)).toBe("about 2 h left");
  });
});

describe("fmtDuration", () => {
  it("formats seconds", () => {
    expect(fmtDuration(null)).toBeNull();
    expect(fmtDuration(45)).toBe("45s");
    expect(fmtDuration(80)).toBe("1m 20s");
  });
});
