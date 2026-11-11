"use client";

import { useReducedMotion } from "motion/react";
import { NumberTicker } from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";

/**
 * A number that counts up when it lands (Magic UI number-ticker). Under reduced
 * motion it renders the final value straight away.
 */
export function Ticker({
  value,
  decimals = 0,
  className,
}: {
  value: number;
  decimals?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) {
    return (
      <span className={cn("tabular", className)}>
        {value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}
      </span>
    );
  }
  return (
    <NumberTicker
      value={value}
      decimalPlaces={decimals}
      className={cn("tracking-normal text-inherit dark:text-inherit", className)}
    />
  );
}

/** The hero number of each row: "−77%". */
export function SavingsTicker({ percent, active }: { percent: number | null; active: boolean }) {
  const show = percent != null && percent > 0;
  return (
    <span
      className={cn(
        "tabular min-w-18 text-right text-[22px] leading-[26px] font-semibold tracking-tight",
        active ? "text-foreground" : "text-muted-foreground"
      )}
      aria-label={show ? `${percent}% smaller` : undefined}
    >
      {show ? (
        <>
          −<Ticker value={percent} />%
        </>
      ) : (
        "—"
      )}
    </span>
  );
}
