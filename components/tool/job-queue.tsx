"use client";

import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { BatchSummary } from "./batch-summary";
import { JobRow } from "./job-row";
import type { QueueItem } from "./types";

export function JobQueue({
  items,
  onDownload,
  onDownloadAll,
  className,
}: {
  items: QueueItem[];
  onDownload: (id: string) => void;
  onDownloadAll: () => void;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="queue-title"
      className={cn("bg-card border-border shadow-card overflow-hidden rounded-xl border", className)}
    >
      <div className="flex items-baseline gap-2 px-4 pt-4 pb-3.5">
        <h2 id="queue-title" className="text-[15px] font-semibold">
          Queue
        </h2>
        {items.length > 0 && (
          <span className="tabular text-muted-foreground text-xs">
            {items.length} job{items.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <BatchSummary items={items} onDownloadAll={onDownloadAll} />

      {items.length === 0 ? (
        <div className="bg-muted mx-3 mb-3 flex h-44 flex-col items-center justify-center gap-2.5 rounded-xl p-4 text-center">
          <span className="bg-card border-border flex size-11 items-center justify-center rounded-xl border">
            <Inbox aria-hidden="true" className="text-muted-foreground size-5" strokeWidth={1.75} />
          </span>
          <span className="text-muted-foreground text-[13px]">Compressed files show up here.</span>
        </div>
      ) : (
        <ul aria-live="polite" className="m-0 list-none p-0">
          {items.map((item) => (
            <JobRow key={item.id} item={item} onDownload={onDownload} />
          ))}
        </ul>
      )}
    </section>
  );
}
