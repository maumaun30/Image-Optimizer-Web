import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { classifyPollError, MAX_BACKOFF_MS, nextPollDelay, POLL_INTERVAL_MS } from "./poll";

describe("classifyPollError", () => {
  it("stops on 401 so the sign-in gate takes over", () => {
    expect(classifyPollError(new ApiError("x", 401))).toBe("auth");
  });
  it("treats 404 as a job the server no longer has", () => {
    expect(classifyPollError(new ApiError("x", 404))).toBe("gone");
  });
  it.each([500, 502, 503, 429])("retries on %i", (status) => {
    expect(classifyPollError(new ApiError("x", status))).toBe("retry");
  });
  it("retries on network errors", () => {
    expect(classifyPollError(new TypeError("Failed to fetch"))).toBe("retry");
  });
});

describe("nextPollDelay", () => {
  const noJitter = () => 0.5; // jitter factor exactly 1

  it("polls at the normal interval while healthy", () => {
    expect(nextPollDelay(0, noJitter)).toBe(POLL_INTERVAL_MS);
  });
  it("doubles per consecutive failure", () => {
    expect([1, 2, 3, 4].map((n) => nextPollDelay(n, noJitter))).toEqual([4000, 8000, 16000, 30000]);
  });
  it("never waits longer than the cap", () => {
    expect(nextPollDelay(50, noJitter)).toBe(MAX_BACKOFF_MS);
  });
  it("jitters within ±20%", () => {
    expect(nextPollDelay(2, () => 0)).toBe(6400);
    expect(nextPollDelay(2, () => 1)).toBe(9600);
  });
});
