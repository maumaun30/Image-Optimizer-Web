"use client";

import { useEffect } from "react";

let active = 0;

export function isEncoding(): boolean {
  return active > 0;
}

/**
 * Marks <body data-encoding="true"> while an in-browser encode runs, which pauses
 * the page's one looping effect (the CTA shimmer) and holds back confetti, so the UI
 * never competes with the Web Workers for CPU/GPU. Counted, so several pages or
 * overlapping batches can't clear each other's flag.
 */
export function useEncodingFlag(encoding: boolean) {
  useEffect(() => {
    if (!encoding) return;
    active += 1;
    document.body.dataset.encoding = "true";
    return () => {
      active -= 1;
      if (active === 0) delete document.body.dataset.encoding;
    };
  }, [encoding]);
}
