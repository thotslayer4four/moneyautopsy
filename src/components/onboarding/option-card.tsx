"use client";

import { m } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function OptionCard({
  label,
  selected,
  onClick,
  hint,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  /** Keyboard shortcut shown on larger screens. */
  hint?: string;
}) {
  return (
    <m.button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "flex min-h-12 w-full items-center justify-between gap-4 rounded-2xl border px-6 py-4 text-left text-base font-medium transition-colors duration-200",
        selected
          ? "border-accent bg-accent-wash text-foreground"
          : "border-border-strong bg-surface text-foreground-secondary hover:border-foreground-muted hover:bg-foreground/[0.03]"
      )}
    >
      {label}
      {selected ? (
        <m.span
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground"
        >
          <Check size={14} strokeWidth={3} aria-hidden />
        </m.span>
      ) : (
        hint && (
          <span
            aria-hidden
            className="hidden shrink-0 rounded-md border border-border-strong px-2 py-1 text-xs text-foreground-muted sm:inline-block"
          >
            {hint}
          </span>
        )
      )}
    </m.button>
  );
}
