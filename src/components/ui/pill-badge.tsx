import type { LucideIcon } from "lucide-react";

export function PillBadge({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-4 py-2 text-xs font-medium text-foreground-secondary">
      <Icon size={14} className="text-accent" aria-hidden />
      {children}
    </span>
  );
}
