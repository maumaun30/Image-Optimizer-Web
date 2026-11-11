"use client";

import { CircleAlert, Download, Info, Laptop, Server, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { AnimatedCircularProgressBar } from "@/components/ui/animated-circular-progress-bar";
import { Button } from "@/components/ui/button";
import { fmtBytes, fmtEta } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SavingsTicker } from "./savings-ticker";
import { StatusBadge } from "./status-badge";
import type { QueueItem } from "./types";

function sizeLine(item: QueueItem): string {
  const sizes =
    item.processedBytes != null
      ? `${fmtBytes(item.originalBytes)} → ${fmtBytes(item.processedBytes)}`
      : fmtBytes(item.originalBytes);
  return item.meta ? `${sizes} · ${item.meta}` : sizes;
}

function EncodeProgress({ item }: { item: QueueItem }) {
  if (!item.progress || item.status !== "processing") return null;
  const { percent, eta } = item.progress;
  const label = eta != null ? `${percent}% · ${fmtEta(eta)}` : `${percent}%`;
  return (
    <div className="flex items-center gap-2.5">
      <div
        role="progressbar"
        aria-label={`Encoding ${item.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-250 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="tabular text-muted-foreground w-36 text-right text-xs">{label}</span>
    </div>
  );
}

function Note({ note }: { note: NonNullable<QueueItem["note"]> }) {
  const Icon = note.kind === "info" ? Info : note.kind === "warning" ? TriangleAlert : CircleAlert;
  const color =
    note.kind === "error"
      ? "text-destructive"
      : note.kind === "warning"
        ? "text-warning"
        : "text-muted-foreground";

  // Fallback reasons expand on tap/click/Enter, so nothing hides behind hover
  if (note.detail) {
    return (
      <details className={cn("group text-xs", color)}>
        <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
          <Icon aria-hidden="true" className="size-3.5 flex-none" />
          <span className="underline decoration-dotted underline-offset-2">{note.text}</span>
        </summary>
        <p className="mt-1 ml-5 leading-[17px]">{note.detail}</p>
      </details>
    );
  }
  return (
    <p
      role={note.kind === "error" ? "alert" : undefined}
      className={cn("flex items-start gap-1.5 text-xs leading-[17px]", color)}
    >
      <Icon aria-hidden="true" className="mt-px size-3.5 flex-none" />
      {note.text}
    </p>
  );
}

export function JobRow({
  item,
  onDownload,
}: {
  item: QueueItem;
  onDownload: (id: string) => void;
}) {
  const done = item.status === "ready" || item.status === "downloaded";
  const encoding = item.status === "processing" && item.progress != null;
  const queuedVideo = item.status === "pending" && item.progress != null;

  return (
    // Magic UI's blur-fade entrance, applied to the <li> itself (BlurFade wraps its
    // children in a <div>, which can't sit directly inside a <ul>)
    <motion.li
      initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="border-border flex flex-col gap-2.5 border-t px-4 py-3.5"
    >
        <div className="flex items-center gap-3">
          {/* Desktop queue: ring; narrower layouts use the linear bar below */}
          {encoding && (
            <div className="hidden flex-none lg:block" aria-hidden="true">
              <AnimatedCircularProgressBar
                value={item.progress!.percent}
                gaugePrimaryColor="var(--primary)"
                gaugeSecondaryColor="var(--muted)"
                className="size-12 text-xs"
              />
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span title={item.name} className="truncate text-sm font-medium">
              {item.name}
            </span>
            <span className="tabular text-muted-foreground truncate text-xs">{sizeLine(item)}</span>
          </div>
          <SavingsTicker percent={done ? item.savingsPercent : null} active={done} />
        </div>

        <div className={cn(encoding && "lg:hidden")}>
          <EncodeProgress item={item} />
        </div>
        {encoding && item.progress!.eta != null && (
          <span className="tabular text-muted-foreground -mt-1 hidden text-xs lg:block">
            Encoding · {fmtEta(item.progress!.eta)}
          </span>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={item.status} label={queuedVideo ? "Queued" : undefined} />
          <span className="border-border text-muted-foreground inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs">
            {item.local ? (
              <Laptop aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            ) : (
              <Server aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            )}
            {item.local ? "On device" : "Server"}
          </span>
          <span className="flex-1" />
          {item.canDownload && (
            <Button
              size="sm"
              onClick={() => onDownload(item.id)}
              aria-label={`Download ${item.name}`}
              className="bg-accent text-accent-foreground hover:bg-accent/80 h-11 rounded-[10px] px-3.5 font-semibold sm:h-9"
            >
              <Download aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">
                {item.status === "downloaded" ? "Again" : "Download"}
              </span>
            </Button>
          )}
        </div>

        {item.note && <Note note={item.note} />}
    </motion.li>
  );
}
