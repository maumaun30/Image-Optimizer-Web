"use client";

import { AnimatePresence, motion } from "motion/react";
import { Ban, Check, CheckCheck, CircleAlert, Clock, LoaderCircle, type LucideIcon } from "lucide-react";
import type { JobStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS: Record<JobStatus, { label: string; icon: LucideIcon; className: string }> = {
  pending: { label: "Pending", icon: Clock, className: "text-neutral bg-neutral-soft" },
  processing: { label: "Processing", icon: LoaderCircle, className: "text-info bg-info-soft" },
  ready: { label: "Ready", icon: Check, className: "text-success bg-success-soft" },
  downloaded: { label: "Downloaded", icon: CheckCheck, className: "text-done bg-done-soft" },
  failed: { label: "Failed", icon: CircleAlert, className: "text-destructive bg-destructive-soft" },
  expired: { label: "Expired", icon: Ban, className: "text-warning bg-warning-soft" },
};

/** Icon + label + color, never color alone. Status changes crossfade. */
export function StatusBadge({ status, label }: { status: JobStatus; label?: string }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className="relative inline-grid">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={status}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full pr-2.5 pl-2 text-xs font-medium",
            s.className
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn("size-3.5", status === "processing" && "animate-spin")}
            strokeWidth={2.25}
          />
          {label ?? s.label}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
