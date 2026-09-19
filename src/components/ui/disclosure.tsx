import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A quiet expander for detail that's worth having but not worth showing by default. It's a native
 * <details>, so the content stays mounted (and keeps its state) while closed.
 */
export function Disclosure({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  /** A short hint on the right of the row, such as a count. */
  meta?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group flex flex-col", className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl border border-border-strong bg-surface px-6 py-4 text-sm font-medium transition-colors duration-200 hover:bg-foreground/[0.03] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{title}</span>
        <span className="flex shrink-0 items-center gap-3 text-foreground-muted">
          {meta && <span className="text-xs font-normal tabular-nums">{meta}</span>}
          <ChevronDown size={16} aria-hidden className="transition-transform duration-200 group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-col gap-4 pt-4">{children}</div>
    </details>
  );
}
