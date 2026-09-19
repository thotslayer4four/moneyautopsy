import { SecondaryCard } from "@/components/ui/card";
import type { Finding } from "@/lib/types";
import { CategoryIcon } from "./icons";

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <SecondaryCard className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-medium text-foreground-muted">
          <CategoryIcon category={finding.category} size={16} className="text-accent" aria-hidden />
          {finding.category}
        </span>
        {finding.confidence < 0.6 && (
          <span className="rounded-full border border-border px-3 py-1 text-xs text-foreground-muted">
            Low confidence
          </span>
        )}
      </div>
      <div className="flex max-w-prose flex-col gap-2">
        <h3 className="text-xl font-semibold tracking-tight">{finding.title}</h3>
        <p className="text-base leading-7 text-foreground-secondary">{finding.summary}</p>
        <p className="text-sm leading-6 text-foreground-muted">{finding.detail}</p>
      </div>
      {finding.dataPoints.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {finding.dataPoints.map((dp, i) => (
            <span
              key={i}
              className="rounded-full border border-border bg-background px-3 py-1 font-mono text-xs text-foreground-secondary"
            >
              {dp}
            </span>
          ))}
        </div>
      )}
    </SecondaryCard>
  );
}
