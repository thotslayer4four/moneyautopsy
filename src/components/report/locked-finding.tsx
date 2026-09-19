import { Lock } from "lucide-react";
import { SecondaryCard } from "@/components/ui/card";
import { CategoryIcon } from "./icons";

export function LockedFinding({ title, category }: { title: string; category: string }) {
  return (
    <SecondaryCard className="flex flex-col gap-4 hover:shadow-none">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-medium text-foreground-muted">
          <CategoryIcon category={category} size={16} className="text-accent" aria-hidden />
          {category}
        </span>
        <Lock size={14} className="text-foreground-muted" aria-label="Locked" />
      </div>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      <div aria-hidden className="flex select-none flex-col gap-2 blur-sm">
        <div className="h-3 w-4/5 rounded-full bg-foreground/15" />
        <div className="h-3 w-3/5 rounded-full bg-foreground/15" />
        <div className="h-6 w-2/5 rounded-full bg-accent/30" />
      </div>
    </SecondaryCard>
  );
}
