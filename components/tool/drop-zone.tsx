"use client";

import { CircleAlert, Upload, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { BorderBeam } from "@/components/ui/border-beam";
import { fmtBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_CHIPS = 5;

/**
 * File input with drag-and-drop. States: empty, drag-over (border beam), files queued
 * (removable chips), invalid drop (shake + message for 4s).
 *
 * The picker opens from a real <button>, so it's keyboard and screen-reader
 * operable; Clear and the chip remove buttons sit beside it, never nested inside.
 */
export function DropZone({
  accept,
  files,
  onAdd,
  onRemove,
  onClear,
  accepts,
  noun,
  hint,
  icon: Icon = Upload,
  disabled,
}: {
  /** `accept` attribute for the file input. */
  accept: string;
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  /** Whether a file is this tool's kind. Rejected files trigger the invalid state. */
  accepts: (file: File) => boolean;
  /** "image" / "PDF" / "video", for messages. */
  noun: string;
  /** Accepted formats and size limit, e.g. "JPG, PNG, WebP · up to 50 MB each". */
  hint: string;
  icon?: LucideIcon;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  // Drag events fire for every child element crossed; count to know when we've left
  const depth = useRef(0);

  useEffect(() => {
    if (!invalid) return;
    const t = setTimeout(() => setInvalid(null), 4000);
    return () => clearTimeout(t);
  }, [invalid]);

  const take = (list: FileList | File[]) => {
    const all = Array.from(list);
    const good = all.filter(accepts);
    const bad = all.filter((f) => !accepts(f));
    if (bad.length) {
      setInvalid(
        bad.length === 1
          ? `${bad[0].name} isn’t ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`
          : `${bad.length} files aren’t ${noun}s and were skipped`
      );
    } else {
      setInvalid(null);
    }
    if (good.length) onAdd(good);
  };

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  const total = files.reduce((s, f) => s + f.size, 0);
  const queued = files.length > 0;
  const shown = files.slice(0, MAX_CHIPS);

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      onClick={(e) => {
        // Clicks on the empty area open the picker too; inner buttons handle their own
        if (e.target === e.currentTarget) open();
      }}
      className={cn(
        "bg-card relative flex flex-col gap-3 rounded-xl border-[1.5px] p-3.5 transition-[border-color,background-color,box-shadow] duration-150 sm:gap-4 sm:p-5",
        invalid
          ? "border-destructive bg-destructive-soft animate-shake"
          : dragging
            ? "border-primary bg-accent shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_15%,transparent)]"
            : queued
              ? "border-primary shadow-[0_0_0_4px_var(--accent)]"
              : "border-border-strong hover:border-muted-foreground cursor-pointer border-dashed"
      )}
    >
      {dragging && !invalid && (
        <BorderBeam size={90} duration={4} colorFrom="var(--primary)" colorTo="var(--accent)" borderWidth={2} />
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) take(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex w-full items-center gap-3 sm:gap-3.5">
        <button
          type="button"
          onClick={open}
          disabled={disabled}
          aria-describedby={hintId}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 rounded-[10px] text-left sm:gap-3.5",
            !queued && !dragging && !invalid && "sm:flex-col sm:py-6 sm:text-center"
          )}
        >
          <span
            className={cn(
              "flex size-10 flex-none items-center justify-center rounded-[10px] sm:size-11 sm:rounded-xl",
              invalid ? "bg-card" : "bg-accent"
            )}
          >
            {invalid ? (
              <CircleAlert aria-hidden="true" className="text-destructive size-5" />
            ) : (
              <Icon aria-hidden="true" className="text-primary size-5" strokeWidth={1.75} />
            )}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={cn("text-[15px] font-semibold", invalid && "text-destructive")}>
              {invalid ? (
                <span role="alert">{invalid}</span>
              ) : dragging ? (
                <span className="text-accent-foreground">Release to add files</span>
              ) : queued ? (
                <>
                  {files.length} file{files.length !== 1 ? "s" : ""} ·{" "}
                  <span className="tabular">{fmtBytes(total)}</span>
                </>
              ) : (
                <>
                  <span className="sm:hidden">Tap to choose files</span>
                  <span className="hidden sm:inline">Drop files here or click to select</span>
                </>
              )}
            </span>
            <span id={hintId} className="text-muted-foreground text-xs sm:text-[13px]">
              {queued && !invalid ? (
                <>
                  <span className="sm:hidden">Tap to add more</span>
                  <span className="hidden sm:inline">Drop more or click to add · {hint}</span>
                </>
              ) : (
                hint
              )}
            </span>
          </span>
        </button>
        {queued && (
          <button
            type="button"
            onClick={onClear}
            className="text-primary min-h-11 flex-none px-1 text-[13px] font-medium underline underline-offset-3"
          >
            Clear
          </button>
        )}
      </div>

      {queued && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Queued files">
          {shown.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="bg-muted border-border inline-flex h-8 max-w-[150px] items-center gap-1 rounded-sm border pr-1 pl-2.5 text-xs sm:h-7 sm:max-w-[200px]"
            >
              <span title={f.name} className="truncate">
                {f.name}
              </span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${f.name}`}
                className="text-muted-foreground hover:text-foreground flex size-6 flex-none items-center justify-center rounded"
              >
                <X aria-hidden="true" className="size-3.5" strokeWidth={2} />
              </button>
            </li>
          ))}
          {files.length > MAX_CHIPS && (
            <li className="text-muted-foreground inline-flex h-7 items-center px-2.5 text-xs">
              +{files.length - MAX_CHIPS} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
