import type { LucideIcon } from "lucide-react";

export function StatBlock({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-background px-4 py-4">
      <div className="flex items-center gap-2">
        <Icon size={16} className="shrink-0 text-accent" aria-hidden />
        <span className="text-xs text-foreground-muted">{label}</span>
      </div>
      <span className="break-words text-xl font-semibold tracking-tight tabular-nums">{value}</span>
    </div>
  );
}
