"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classifyPollError, nextPollDelay, STALE_AFTER_FAILURES } from "@/lib/poll";

interface Options<T> {
  /** Fetch the job's current state; throws ApiError on a non-2xx response. */
  fetchStatus: (id: string) => Promise<T>;
  onUpdate: (id: string, job: T) => void;
  isDone: (job: T) => boolean;
  /** The server no longer has the job (404). */
  onGone: (id: string) => void;
}

/**
 * Polls server jobs until they finish. Unlike a plain setInterval it:
 * - never overlaps requests (each check is scheduled after the last one returns),
 * - backs off on failure instead of giving up on the first error, and reports jobs
 *   that have been unreachable for a while as `stale`,
 * - retries at once when the browser comes back online,
 * - stops on 401 (the sign-in gate takes over) and on 404,
 * - clears every timer when the page unmounts.
 *
 * Callbacks are read through a ref, so `start` stays stable across renders.
 */
export function useJobPoller<T>(options: Options<T>) {
  const opts = useRef(options);
  opts.current = options;

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const failures = useRef(new Map<string, number>());
  const [stale, setStale] = useState<ReadonlySet<string>>(new Set());

  const markStale = useCallback((id: string, on: boolean) => {
    setStale((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const stop = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.delete(id);
      failures.current.delete(id);
      markStale(id, false);
    },
    [markStale]
  );

  const check = useCallback(
    async (id: string) => {
      try {
        const job = await opts.current.fetchStatus(id);
        if (!timers.current.has(id)) return; // stopped meanwhile (unmount)
        failures.current.set(id, 0);
        markStale(id, false);
        opts.current.onUpdate(id, job);
        if (opts.current.isDone(job)) {
          stop(id);
          return;
        }
      } catch (err) {
        if (!timers.current.has(id)) return;
        const kind = classifyPollError(err);
        if (kind === "auth") {
          stop(id);
          return;
        }
        if (kind === "gone") {
          stop(id);
          opts.current.onGone(id);
          return;
        }
        const n = (failures.current.get(id) ?? 0) + 1;
        failures.current.set(id, n);
        if (n >= STALE_AFTER_FAILURES) markStale(id, true);
      }
      // Still running (or failed transiently): schedule the next check
      const delay = nextPollDelay(failures.current.get(id) ?? 0);
      timers.current.set(id, setTimeout(() => void check(id), delay));
    },
    [markStale, stop]
  );

  const start = useCallback(
    (id: string) => {
      if (timers.current.has(id)) return;
      failures.current.set(id, 0);
      timers.current.set(id, setTimeout(() => void check(id), nextPollDelay(0)));
    },
    [check]
  );

  // Back online: check every waiting job now instead of sitting out the backoff
  useEffect(() => {
    const onOnline = () => {
      for (const [id, t] of timers.current) {
        clearTimeout(t);
        timers.current.set(id, setTimeout(() => void check(id), 0));
      }
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [check]);

  // Leaving the page stops every poll
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all.values()) clearTimeout(t);
      all.clear();
    };
  }, []);

  return { start, stale };
}
