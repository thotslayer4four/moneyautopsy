import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-wash text-accent",
        className
      )}
    >
      <Icon size={22} aria-hidden />
    </div>
  );
}
