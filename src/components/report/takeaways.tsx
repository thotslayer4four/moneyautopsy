import { ChevronRight, type LucideIcon } from "lucide-react";
import { IconTile } from "@/components/ui/icon-tile";
import type { ReportTab } from "./report-tabs";

export interface Takeaway {
  icon: LucideIcon;
  label: string;
  text: string;
  /** Where the detail lives. */
  tab: ReportTab;
}

/** The short version of the autopsy: a few plain sentences, each one a way into the detail. */
export function Takeaways({ items, onOpen }: { items: Takeaway[]; onOpen: (tab: ReportTab) => void }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.label}>
          <button
            type="button"
            onClick={() => onOpen(item.tab)}
            className="group flex min-h-12 w-full items-center gap-4 rounded-2xl border border-border-strong bg-surface px-6 py-4 text-left transition-colors duration-200 hover:bg-foreground/[0.03]"
          >
            <IconTile icon={item.icon} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-xs text-foreground-muted">{item.label}</span>
              <span className="text-base font-medium leading-6">{item.text}</span>
            </span>
            <ChevronRight
              size={18}
              aria-hidden
              className="shrink-0 text-foreground-muted transition-transform duration-200 group-hover:translate-x-1"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
