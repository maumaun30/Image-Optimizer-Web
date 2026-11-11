import { ApiError } from "./api";

/** Normal gap between status checks. */
export const POLL_INTERVAL_MS = 2000;
/** Longest gap while the server is unreachable. */
export const MAX_BACKOFF_MS = 30_000;
/** Consecutive failures before the row tells the user something is wrong. */
export const STALE_AFTER_FAILURES = 3;

/**
 * What to do when a status check fails:
 * - "auth": the session ended. Stop; the sign-in gate takes over (the 401 already
 *   fired its event).
 * - "gone": the server no longer knows the job. Stop and mark it failed.
 * - "retry": network blip, deploy restart, 5xx, rate limit. Keep trying.
 */
export type PollFailure = "auth" | "gone" | "retry";

export function classifyPollError(err: unknown): PollFailure {
  if (err instanceof ApiError) {
    if (err.status === 401) return "auth";
    if (err.status === 404) return "gone";
  }
  return "retry";
}

/**
 * Delay before the next check after `failures` consecutive failures: 2s, 4s, 8s, 16s,
 * then 30s, each with ±20% jitter so many open tabs don't retry in lockstep after
 * an outage.
 */
export function nextPollDelay(failures: number, random: () => number = Math.random): number {
  if (failures <= 0) return POLL_INTERVAL_MS;
  const base = Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(base * jitter);
}
