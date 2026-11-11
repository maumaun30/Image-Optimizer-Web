"use client";

import { LoaderCircle, X, Zap, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import { useId } from "react";
import { MagicCard } from "@/components/ui/magic-card";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { fmtBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Options panel. Magic card spotlight follows a fine pointer; inert on touch. */
export function OptionsCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <MagicCard
      className="shadow-card rounded-xl"
      gradientSize={260}
      gradientColor="var(--accent)"
      gradientOpacity={0.5}
      gradientFrom="var(--primary)"
      gradientTo="var(--accent)"
    >
      <div className={cn("grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-5 sm:p-5", className)}>
        {children}
      </div>
    </MagicCard>
  );
}

export function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <span className="text-[13px] font-medium">
      {children}
      {optional && <span className="text-muted-foreground font-normal"> (optional)</span>}
    </span>
  );
}

/**
 * Single-choice segmented control (radio semantics). The selected pill slides with
 * a spring; under reduced motion MotionConfig makes it jump.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span id={id} className="text-[13px] font-medium">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="bg-muted border-border flex rounded-[10px] border p-[3px]"
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                // Arrow keys move the selection, like native radios
                const i = options.findIndex((x) => x.value === value);
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const next = options[(i + step + options.length) % options.length];
                onChange(next.value);
                (e.currentTarget.parentElement?.children[options.indexOf(next)] as HTMLElement)?.focus();
              }}
              tabIndex={on ? 0 : -1}
              className={cn(
                "relative h-10 flex-1 rounded-[7px] text-sm font-medium transition-colors duration-150 sm:h-9 sm:text-[13px]",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {on && (
                <motion.span
                  layoutId={`seg-${id}`}
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className="bg-card shadow-segment absolute inset-0 rounded-[7px]"
                />
              )}
              <span className="relative">{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Descriptive radio cards (PDF level, video codec). */
export function RadioCards<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  columns = 2,
  className,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; title: string; description: string; isDefault?: boolean }[];
  onChange: (v: T) => void;
  columns?: 2 | 3;
  className?: string;
}) {
  return (
    <fieldset className={cn("m-0 flex min-w-0 flex-col gap-2 border-0 p-0", className)}>
      <legend className="mb-2 p-0 text-[13px] font-medium">{legend}</legend>
      <div className={cn("grid grid-cols-1 gap-2.5", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <label
              key={o.value}
              className={cn(
                "relative flex cursor-pointer flex-col gap-1 rounded-lg p-3.5 pr-10 transition-colors duration-150",
                "has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
                on ? "border-primary bg-accent border-[1.5px]" : "border-border bg-card hover:border-border-strong border"
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={on}
                onChange={() => onChange(o.value)}
                className="accent-primary absolute top-3.5 right-3.5 m-0 size-4 focus-visible:outline-none"
              />
              <span className="flex items-center gap-2 text-sm font-semibold">
                {o.title}
                {o.isDefault && (
                  <span className="bg-accent text-accent-foreground rounded-md px-1.5 py-px text-[11px] font-medium">
                    Default
                  </span>
                )}
              </span>
              <span className="text-muted-foreground text-xs leading-[17px]">{o.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Text input with a trailing unit, e.g. "px". */
export function UnitInput({
  label,
  value,
  onChange,
  unit,
  placeholder,
  max,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  placeholder: string;
  max: number;
  optional?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2">
      <FieldLabel optional={optional}>{label}</FieldLabel>
      <span className="border-border bg-card focus-within:outline-ring flex h-11 items-center gap-2 rounded-[10px] border px-3 focus-within:outline-2 focus-within:outline-offset-2">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, String(max).length);
            onChange(digits && Number(digits) > max ? String(max) : digits);
          }}
          className="tabular placeholder:text-muted-foreground min-w-0 flex-1 border-0 bg-transparent text-base outline-none focus-visible:outline-none sm:text-sm"
        />
        <span className="text-muted-foreground text-[13px]">{unit}</span>
      </span>
    </label>
  );
}

/**
 * The page's one primary action, and its only looping effect (Magic UI shimmer).
 * The shimmer stops while loading, when disabled, and while an in-browser encode runs.
 */
export function CompressButton({
  count,
  loading,
  loadingLabel = "Uploading…",
  onClick,
}: {
  count: number;
  loading: boolean;
  loadingLabel?: string;
  onClick: () => void;
}) {
  const disabled = count === 0 || loading;
  const label = count ? `Compress ${count} file${count !== 1 ? "s" : ""}` : "Compress files";
  const content = (
    <span className="relative z-10 flex items-center gap-2.5">
      {loading ? (
        <LoaderCircle aria-hidden="true" className="size-[18px] animate-spin" strokeWidth={2.25} />
      ) : (
        <Zap aria-hidden="true" className="size-[18px]" strokeWidth={2} />
      )}
      {loading ? loadingLabel : label}
    </span>
  );
  const base = "h-[52px] w-full rounded-lg text-base font-semibold sm:text-[15px]";

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        aria-busy={loading || undefined}
        className={cn(
          base,
          "flex items-center justify-center",
          loading ? "bg-primary text-primary-foreground opacity-85" : "bg-border text-[#71717a] dark:text-[#a1a1aa]"
        )}
      >
        {content}
      </button>
    );
  }
  return (
    <ShimmerButton
      type="button"
      data-shimmer
      onClick={onClick}
      background="var(--primary)"
      shimmerColor="color-mix(in oklab, var(--primary-foreground) 70%, transparent)"
      borderRadius="12px"
      shimmerDuration="3s"
      className={cn(
        base,
        "text-primary-foreground shadow-[0_6px_20px_-6px_var(--primary)] hover:shadow-[0_8px_24px_-8px_var(--primary)] active:scale-[.98]"
      )}
    >
      {content}
    </ShimmerButton>
  );
}

/**
 * Upload progress for big server-bound files (video). Uploads are resumable: the
 * copy tells people a dropped connection or closed tab isn't fatal.
 */
export function UploadProgress({
  label,
  sentBytes,
  totalBytes,
  resumedBytes,
  onCancel,
}: {
  label: string;
  sentBytes: number;
  totalBytes: number;
  /** Bytes already on the server from an earlier, interrupted attempt. */
  resumedBytes?: number | null;
  onCancel?: () => void;
}) {
  const percent = totalBytes ? Math.min(100, Math.floor((sentBytes / totalBytes) * 100)) : 0;
  return (
    <div className="bg-card border-border flex flex-col gap-2.5 rounded-xl border p-4">
      <div className="tabular flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{label}</span>
        <span className="min-w-14 text-right text-xl font-semibold">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-muted h-2 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-250 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="tabular text-muted-foreground flex items-center justify-between gap-3 text-xs">
        <span>
          {percent >= 100
            ? "Upload complete — starting the encode…"
            : `${fmtBytes(sentBytes)} of ${fmtBytes(totalBytes)} sent`}
        </span>
        {onCancel && percent < 100 && (
          <button
            type="button"
            onClick={onCancel}
            className="text-foreground -my-2 min-h-11 px-1 font-medium underline underline-offset-3 sm:min-h-0"
          >
            Cancel
          </button>
        )}
      </div>
      <p className="text-muted-foreground m-0 text-xs leading-[17px]" aria-live="polite">
        {resumedBytes
          ? `Resumed — ${fmtBytes(resumedBytes)} was already on the server.`
          : "Connection drops are retried automatically. If you close this tab, pick the same file with the same options to resume."}
      </p>
    </div>
  );
}

/** Request-level failure, e.g. "Server is busy — too many files queued." */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  // Lead with the first sentence; the rest reads as guidance
  const [head, ...rest] = message.split(/(?<=[.!?—])\s+/);
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="border-warning-border bg-warning-soft text-warning flex items-start gap-3 rounded-xl border py-3 pr-3 pl-3.5"
    >
      <TriangleAlert aria-hidden="true" className="mt-px size-[18px] flex-none" strokeWidth={2} />
      <p className="m-0 flex-1 text-sm leading-5">
        <strong className="font-semibold">{head}</strong>
        {rest.length > 0 && ` ${rest.join(" ")}`}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-my-1.5 -mr-1 flex size-8 flex-none items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
      >
        <X aria-hidden="true" className="size-4" strokeWidth={2} />
      </button>
    </motion.div>
  );
}

/** Quality slider, 50–100, with 100 labelled "Lossless". */
export function QualitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5 sm:col-span-2">
      <label htmlFor={id} className="flex justify-between text-[13px] font-medium">
        <span>Quality</span>
        <span className="tabular font-mono">{value === 100 ? "100 · Lossless" : value}</span>
      </label>
      <input
        id={id}
        type="range"
        min={50}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={value === 100 ? "100, lossless" : String(value)}
        className="accent-primary m-0 h-11 w-full sm:h-6"
      />
      <span className="text-muted-foreground flex justify-between text-xs">
        <span>50 · Smallest</span>
        <span>100 · Lossless</span>
      </span>
    </div>
  );
}

export function SwitchField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="border-border has-[:focus-visible]:outline-ring flex h-11 cursor-pointer items-center justify-between gap-3 rounded-[10px] border px-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex h-6 w-10 items-center rounded-full p-0.5 transition-colors duration-150",
          checked ? "bg-primary justify-end" : "bg-border-strong justify-start"
        )}
      >
        <motion.span layout transition={{ type: "spring", stiffness: 500, damping: 40 }} className="bg-primary-foreground size-5 rounded-full dark:bg-white" />
      </span>
    </label>
  );
}
