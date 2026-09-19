"use client";

import { m } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

export function ProgressBar({
  value,
  label,
  showValue = false,
  className,
}: {
  /** 0–100 */
  value: number;
  label: string;
  showValue?: boolean;
  className?: string;
}) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));

  return (
    <div className={className}>
      <div className="mb-3 flex items-baseline justify-between gap-4 text-sm font-medium text-foreground-secondary">
        <span>{label}</span>
        {showValue && <span className="tabular-nums text-foreground-muted">{percent}%</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-accent-track/40"
      >
        <m.div
          className="h-full rounded-full bg-accent"
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5, ease: EASE }}
        />
      </div>
    </div>
  );
}
