"use client";

import { Download } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Confetti, type ConfettiRef } from "@/components/ui/confetti";
import { Button } from "@/components/ui/button";
import { Ticker } from "./savings-ticker";
import type { QueueItem } from "./types";
import { isEncoding } from "./use-encoding-flag";

const ACTIVE = new Set(["pending", "processing"]);

function savedUnits(bytes: number): { value: number; unit: string; decimals: number } {
  if (bytes >= 1024 ** 3) return { value: bytes / 1024 ** 3, unit: "GB", decimals: 2 };
  if (bytes >= 1024 ** 2) return { value: bytes / 1024 ** 2, unit: "MB", decimals: 1 };
  return { value: bytes / 1024, unit: "KB", decimals: 1 };
}

/**
 * "Saved 48.2 MB (63%) across 12 files" plus Download all. Fires confetti once when
 * the last running job of a batch finishes — never under reduced motion, and never
 * while an in-browser encode is still running.
 */
export function BatchSummary({
  items,
  onDownloadAll,
}: {
  items: QueueItem[];
  onDownloadAll: () => void;
}) {
  const confetti = useRef<ConfettiRef>(null);
  const reduced = useReducedMotion();
  const activeCount = items.filter((i) => ACTIVE.has(i.status)).length;
  const prevActive = useRef(activeCount);

  const done = items.filter(
    (i) =>
      (i.status === "ready" || i.status === "downloaded") &&
      i.originalBytes != null &&
      i.processedBytes != null
  );
  const original = done.reduce((s, i) => s + (i.originalBytes ?? 0), 0);
  const saved = done.reduce((s, i) => s + Math.max(0, (i.originalBytes ?? 0) - (i.processedBytes ?? 0)), 0);
  const percent = original ? Math.round((saved / original) * 100) : 0;
  const downloadable = items.filter((i) => i.canDownload && i.status === "ready").length;

  useEffect(() => {
    const finished = prevActive.current > 0 && activeCount === 0 && done.length > 0;
    prevActive.current = activeCount;
    if (finished && !reduced && !isEncoding()) {
      void confetti.current?.fire({ particleCount: 90, spread: 70, origin: { y: 0.3 } });
    }
  }, [activeCount, done.length, reduced]);

  const units = savedUnits(saved);

  return (
    <>
      <Confetti
        ref={confetti}
        manualstart
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-50 size-full"
      />
      {done.length > 0 && (
        <div className="bg-muted mx-3 mb-3 flex flex-col gap-3 rounded-[10px] p-3.5 sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Total saved</span>
            <span aria-live="polite" className="tabular text-[15px] font-semibold">
              Saved{" "}
              <span className="text-success">
                <Ticker value={units.value} decimals={units.decimals} /> {units.unit} (
                <Ticker value={percent} />
                %)
              </span>{" "}
              across {done.length} file{done.length !== 1 ? "s" : ""}
            </span>
          </div>
          {downloadable > 1 && (
            <Button
              variant="outline"
              onClick={onDownloadAll}
              className="bg-card h-11 rounded-[10px] sm:h-10"
            >
              <Download aria-hidden="true" className="size-4" />
              Download all
            </Button>
          )}
        </div>
      )}
    </>
  );
}
