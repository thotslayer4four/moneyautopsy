import { ArrowDownLeft, ArrowUpRight, FileSearch, Receipt, ScanSearch, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PillBadge } from "@/components/ui/pill-badge";
import { StatBlock } from "./stat-block";
import { FindingCard } from "./finding-card";
import { Paywall } from "./paywall";
import { formatNaira } from "@/lib/format";
import type { ClientReport } from "@/lib/types";

export function FreeReport({
  report,
  onUnlocked,
}: {
  report: Extract<ClientReport, { status: "free" }>;
  onUnlocked: (report: ClientReport) => void;
}) {
  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col items-start gap-4">
        <PillBadge icon={FileSearch}>Your free autopsy</PillBadge>
        <h1 className="text-balance text-4xl font-semibold tracking-tight">Your money at a glance</h1>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatBlock icon={ArrowDownLeft} label="Money in" value={formatNaira(report.overview.totalInflow)} />
          <StatBlock icon={ArrowUpRight} label="Money out" value={formatNaira(report.overview.totalOutflow)} />
          <StatBlock icon={Receipt} label="Transactions" value={String(report.overview.transactionCount)} />
        </div>
      </Card>

      <ul className="flex flex-col gap-4">
        {report.teaserBullets.map((bullet, i) => (
          <li key={i} className="flex max-w-prose gap-3 text-base leading-7 text-foreground-secondary">
            <span className="flex h-7 shrink-0 items-center text-accent" aria-hidden>
              <Sparkles size={16} />
            </span>
            {bullet}
          </li>
        ))}
      </ul>

      {report.freeFinding && (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground-secondary">
            <ScanSearch size={16} className="text-accent" aria-hidden />
            One thing we found in full
          </p>
          <FindingCard finding={report.freeFinding} />
        </div>
      )}

      <Paywall
        reportId={report.id}
        lockedFindingTitles={report.lockedFindingTitles}
        seenCount={report.freeFinding ? 1 : 0}
        onUnlocked={onUnlocked}
      />
    </div>
  );
}
