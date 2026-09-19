"use client";

import { m } from "framer-motion";
import { formatNaira } from "@/lib/format";
import { CategoryIcon } from "./icons";
import { cn } from "@/lib/utils";
import type { CategoryBreakdownEntry } from "@/lib/types";

/** Spending keeps the accent; money that was only moved, or is unexplained, reads quieter. */
export function CategoryBar({ entry, max, note }: { entry: CategoryBreakdownEntry; max: number; note?: string }) {
  const isSpend = entry.kind === "spend" || entry.kind === "support";
  const widthPct = max > 0 ? Math.max((entry.total / max) * 100, 3) : 0;
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <CategoryIcon
            category={entry.category}
            size={16}
            aria-hidden
            className={cn("shrink-0", isSpend ? "text-accent" : "text-foreground-muted")}
          />
          <span className="truncate">{entry.category}</span>
        </span>
        <span className="text-sm tabular-nums text-foreground-muted">
          {formatNaira(entry.total)} · {Math.round(entry.percentOfOutflow)}%
        </span>
      </div>
      {note && <p className="max-w-prose text-xs leading-5 text-foreground-muted">{note}</p>}
      <div
        aria-hidden
        className={cn(
          "h-2 w-full overflow-hidden rounded-full",
          isSpend ? "bg-accent-track/40" : "bg-foreground/[0.06]",
        )}
      >
        <m.div
          className={cn("h-full rounded-full", isSpend ? "bg-accent" : "bg-foreground-muted")}
          initial={{ width: 0 }}
          whileInView={{ width: `${widthPct}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
