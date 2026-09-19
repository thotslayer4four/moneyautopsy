import { Flame } from "lucide-react";
import type { Highlight } from "@/lib/types";
import { HighlightIcon } from "./icons";

export function HighlightGrid({ highlights }: { highlights: Highlight[] }) {
  if (highlights.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {highlights.map((h) => (
        <li key={h.id} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border-strong bg-surface p-6">
          <span className="flex items-center gap-2 text-xs text-foreground-muted">
            <HighlightIcon id={h.id} size={16} className="shrink-0 text-accent" aria-hidden />
            {h.label}
          </span>
          <span className="break-words text-xl font-semibold tracking-tight tabular-nums">{h.value}</span>
          <span className="text-sm leading-6 text-foreground-secondary">{h.note}</span>
          {h.tagline && (
            <span className="inline-flex items-center gap-2 self-start rounded-full bg-accent-wash px-3 py-1 text-xs font-medium text-foreground">
              <Flame size={14} className="shrink-0 text-accent" aria-hidden />
              {h.tagline}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
