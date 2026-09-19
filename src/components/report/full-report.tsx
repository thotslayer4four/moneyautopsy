"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Brain, CalendarDays, Compass, Droplets, Flame, Lightbulb, ScanSearch, ShoppingBag, TrendingDown } from "lucide-react";
import { Callout } from "@/components/ui/callout";
import { Card, SecondaryCard } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Spinner } from "@/components/ui/spinner";
import { StatBlock } from "./stat-block";
import { ReportSection } from "./section-heading";
import { CategoryBar } from "./category-bar";
import { FindingCard } from "./finding-card";
import { UncertainBreakdown } from "./uncertain-breakdown";
import { HighlightGrid } from "./highlight-grid";
import { BalanceChart } from "./balance-chart";
import { ShareCards } from "./share-cards";
import { DownloadPdfButton } from "./download-pdf-button";
import { InflowBreakdown } from "./inflow-breakdown";
import { SpendingDonut } from "./spending-donut";
import { SpendingBehavior } from "./spending-behavior";
import { ReportTabs, isReportTab, type ReportTab } from "./report-tabs";
import { Takeaways, type Takeaway } from "./takeaways";
import { PlanOverview } from "./plan/plan-overview";
import { SafeToSpendCard } from "./plan/safe-to-spend";
import { PlanAssumptions } from "./plan/plan-assumptions";
import { PlanChanges } from "./plan/plan-changes";
import { PlanScenarios } from "./plan/plan-scenarios";
import { NumberedList } from "./plan/numbered-list";
import { useMoneyPlan } from "./plan/use-money-plan";
import { formatNaira, formatDate } from "@/lib/format";
import { topKnownCategory } from "@/lib/analysis/helpers";
import type { CategoryBreakdownEntry, ClientReport } from "@/lib/types";

/** Findings shown up front; the rest sit behind an expander so the list doesn't swamp the tab. */
const FINDINGS_SHOWN = 3;

function CategoryGroup({
  title,
  entries,
  max,
  notes,
}: {
  title: string;
  entries: CategoryBreakdownEntry[];
  max: number;
  notes?: Partial<Record<string, string>>;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium text-foreground-secondary">{title}</p>
      <div className="flex flex-col divide-y divide-border">
        {entries.map((entry) => (
          <CategoryBar key={entry.category} entry={entry} max={max} note={notes?.[entry.category]} />
        ))}
      </div>
    </div>
  );
}

export function FullReport({
  report,
  onReportUpdated,
}: {
  report: Extract<ClientReport, { status: "unlocked" }>;
  onReportUpdated: (report: ClientReport) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const { selected, toggle, view: planView } = useMoneyPlan(report.moneyPlan, report.id);
  const plan = report.moneyPlan;
  const allFindings = report.freeFinding ? [report.freeFinding, ...report.lockedFindings] : report.lockedFindings;
  const maxCategory = report.categoryBreakdown[0]?.total ?? 0;
  const topCategory = topKnownCategory(report.categoryBreakdown);
  // Prefer a finding about the top category. Otherwise fall back to the first finding overall,
  // labelled with its own category so it isn't read as being about the category above it.
  const topCategoryFinding = topCategory
    ? allFindings.find((f) => f.category.toLowerCase() === topCategory.category.toLowerCase())
    : undefined;
  const biggestFinding = topCategoryFinding ?? allFindings[0];
  const noticedLeadIn =
    biggestFinding && !topCategoryFinding ? `Separately, on ${biggestFinding.category.toLowerCase()}.` : "What we noticed.";
  const spentEntries = report.categoryBreakdown.filter((c) => c.kind === "spend" || c.kind === "support");
  // Savings and investments are shown NET: gross is dominated by wallet pockets (OWealth,
  // PiggyVest…) that move money in and out on nearly every payment.
  const sv = report.savings ?? { savedOut: 0, investedOut: 0, withdrawnBack: 0, netSaved: 0, savedCount: 0 };
  const netSavedByCategory: Record<string, number> = {
    Savings: sv.savedOut - sv.withdrawnBack,
    Investments: sv.investedOut,
  };
  const movedNotes: Record<string, string> = {};
  const movedEntries = report.categoryBreakdown
    .filter((c) => c.kind === "moved")
    .map((c) => {
      if (c.category === "Transfers" && (report.walletPockets?.count ?? 0) > 0) {
        const wp = report.walletPockets!;
        movedNotes.Transfers = `Includes ${formatNaira(wp.movedOut)} moved into and ${formatNaira(wp.movedIn)} back out of wallet pockets like OPay's OWealth. That's your wallet shuffling money between its own pockets — not saving, not spending.`;
        return c;
      }
      if (c.category !== "Savings") return c;
      const net = Math.max(0, netSavedByCategory.Savings);
      movedNotes.Savings = `${formatNaira(c.total)} went in and ${formatNaira(sv.withdrawnBack)} came back out — net ${formatNaira(net)}. Wallets like OWealth move money in and out with every payment.`;
      return { ...c, total: net, percentOfOutflow: report.overview.totalOutflow > 0 ? (net / report.overview.totalOutflow) * 100 : 0 };
    })
    .sort((a, b) => b.total - a.total);
  const unexplainedEntries = report.categoryBreakdown.filter((c) => c.kind === "uncertain");

  const ub = report.uncertainBreakdown;
  const uncertainItems = (ub?.topRecipients?.length ?? 0) + (ub?.incomingSenders?.length ?? 0);
  const incomeQuestionCount = report.incomeCheck?.questions.length ?? 0;
  const hasUncertain = uncertainItems + (ub?.largestTransactions?.length ?? 0) + incomeQuestionCount > 0;
  // Answering these sharpens everything else, so when there are any they lead the Summary. Decided
  // once, so answering the last one doesn't make the card jump tabs and lose its "Done" note.
  const [questionsOnTop] = useState(() => incomeQuestionCount + (ub?.questions?.length ?? 0) > 0);
  const shownFindings = allFindings.slice(0, FINDINGS_SHOWN);
  const moreFindings = allFindings.slice(FINDINGS_SHOWN);

  const [tab, setTab] = useState<ReportTab>("summary");
  // A link like /report#plan opens straight onto that tab.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isReportTab(hash)) setTab(hash);
  }, []);
  function openTab(next: ReportTab) {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  // The plan's gap note sends people to the questions that could close it: open the Summary and
  // scroll to them, leaving room for the sticky tab bar.
  const STICKY_TAB_BAR_OFFSET = 72;
  function openIncomeQuestions() {
    openTab("summary");
    requestAnimationFrame(() => {
      const top = document.getElementById("income-questions")?.getBoundingClientRect().top;
      if (top !== undefined) window.scrollTo({ top: window.scrollY + top - STICKY_TAB_BAR_OFFSET, behavior: "smooth" });
    });
  }

  const questions = (
    <UncertainBreakdown
      reportId={report.id}
      breakdown={report.uncertainBreakdown}
      incomeCheck={report.incomeCheck}
      planIncome={plan?.income.monthly ?? null}
      onReportUpdated={onReportUpdated}
      onRefreshingChange={setRefreshing}
    />
  );

  // The short version: one plain sentence per thing worth knowing, each a way into the detail.
  const taglined = report.highlights.find((h) => h.tagline);
  const candidates: (Takeaway | false | null | undefined)[] = [
    { icon: Brain, label: "Your money personality", text: report.moneyPersonality.name, tab: "insights" as const },
    topCategory && {
      icon: Droplets,
      label: "Biggest leak",
      text: `${topCategory.category}: ${Math.round(topCategory.percentOfOutflow)}% of what left your account`,
      tab: "money" as const,
    },
    allFindings[0] && { icon: ScanSearch, label: "Top finding", text: allFindings[0].title, tab: "insights" as const },
    taglined && { icon: Flame, label: taglined.label, text: taglined.tagline!, tab: "insights" as const },
    plan?.safeToSpend
      ? { icon: Compass, label: "Safe to spend", text: `About ${formatNaira(plan.safeToSpend.daily)} a day`, tab: "plan" as const }
      : report.recommendations[0] && { icon: Lightbulb, label: "First thing to change", text: report.recommendations[0].title, tab: "plan" as const },
  ];
  const takeaways = candidates.filter((item): item is Takeaway => Boolean(item));

  const summary = (
    <>
      {questionsOnTop && (
        <ReportSection
          id="income-questions"
          title="Help us get this right"
          description="Answering these makes everything below more accurate, including your plan. Every answer updates the report straight away."
        >
          {questions}
        </ReportSection>
      )}

      <Card className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatBlock icon={ArrowDownLeft} label="Money in" value={formatNaira(report.overview.totalInflow)} />
          <StatBlock icon={ArrowUpRight} label="Money out" value={formatNaira(report.overview.totalOutflow)} />
          <StatBlock icon={ShoppingBag} label="Actually spent" value={formatNaira(report.overview.spent)} />
        </div>
        <p className="max-w-prose text-sm leading-6 text-foreground-secondary">
          Money out includes savings, loans and transfers between your own accounts. Only “actually spent” counts as
          consumption.
        </p>
      </Card>

      <ReportSection title="The short version" description="The few things worth knowing. Tap one to see the detail.">
        <Takeaways items={takeaways} onOpen={openTab} />
      </ReportSection>
    </>
  );

  const money = (
    <>
      <ReportSection
        title="Where your money went"
        description="Everything that left your account, split into what you spent, what you only moved, and what we can't explain yet."
      >
        <Card className="flex flex-col gap-8">
          <SpendingDonut entries={spentEntries} />
          <CategoryGroup title="Moved, not spent" entries={movedEntries} max={maxCategory} notes={movedNotes} />
          <CategoryGroup title="Not yet explained" entries={unexplainedEntries} max={maxCategory} />
        </Card>
        {hasUncertain && !questionsOnTop && (
          <Disclosure title="Help us explain the unexplained" meta={uncertainItems > 0 ? `${uncertainItems} to label` : undefined}>
            {questions}
          </Disclosure>
        )}
      </ReportSection>

      {report.inflowBreakdown.length > 0 && (
        <ReportSection title="Where it came from" description="Not every credit is income. Here's what each one actually was.">
          <Card>
            <InflowBreakdown
              entries={report.inflowBreakdown}
              totalInflow={report.overview.totalInflow}
              earnedIncome={report.overview.earnedIncome}
            />
          </Card>
        </ReportSection>
      )}

      {report.balance && <BalanceChart balance={report.balance} />}
    </>
  );

  const insights = (
    <>
      {report.highlights.length > 0 && (
        <ReportSection title="Numbers worth knowing" description="The figures that stood out in your statement.">
          <HighlightGrid highlights={report.highlights} />
        </ReportSection>
      )}

      {allFindings.length > 0 && (
        <ReportSection title="What we found" description="What we noticed in your statement, and why it matters.">
          {refreshing && (
            <Callout icon={<Spinner size={16} />} className="items-center">
              Updating your findings with what you just told us…
            </Callout>
          )}
          <div
            aria-busy={refreshing}
            className={`flex flex-col gap-4 transition-opacity duration-200 ${refreshing ? "opacity-60" : ""}`}
          >
            {shownFindings.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
            {moreFindings.length > 0 && (
              <Disclosure title={`Show ${moreFindings.length} more`} meta="Findings">
                {moreFindings.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} />
                ))}
              </Disclosure>
            )}
          </div>
        </ReportSection>
      )}

      {topCategory && (
        <ReportSection title="Your biggest leak">
          <Card className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-foreground-secondary">{topCategory.category}</p>
              <p className="text-4xl font-semibold tracking-tight tabular-nums">{formatNaira(topCategory.total)}</p>
              <p className="text-base leading-7 text-foreground-secondary">
                {Math.round(topCategory.percentOfOutflow)}% of everything that left your account, across{" "}
                {topCategory.transactionCount} transactions.
              </p>
            </div>
            {biggestFinding && <Callout leadIn={noticedLeadIn}>{biggestFinding.detail}</Callout>}
          </Card>
        </ReportSection>
      )}

      <ReportSection title="You told us..." description="What you said you spend too much on, next to what the statement shows.">
        <Card className="flex flex-col gap-6">
          <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="flex flex-col gap-2 pb-4 sm:pb-0 sm:pr-6">
              <span className="text-xs text-foreground-muted">You thought</span>
              <p className="text-base font-medium leading-7">&ldquo;{report.userBeliefComparison.whatTheyThought}&rdquo;</p>
            </div>
            <div className="flex flex-col gap-2 pt-4 sm:pl-6 sm:pt-0">
              <span className="text-xs text-foreground-muted">The data shows</span>
              <p className="text-base font-medium leading-7">{report.userBeliefComparison.whatDataShows}</p>
            </div>
          </div>
          <Callout leadIn="What this means.">{report.userBeliefComparison.explanation}</Callout>
        </Card>
      </ReportSection>

      <ReportSection title="Your spending behavior">
        <SpendingBehavior personality={report.moneyPersonality} patterns={report.patterns} />
      </ReportSection>
    </>
  );

  const planTab =
    plan && planView ? (
      <>
        <ReportSection title="Your money plan">
          <PlanOverview plan={plan} view={planView} incomeQuestionCount={incomeQuestionCount} onCheckIncome={openIncomeQuestions} />
          <SafeToSpendCard plan={plan} />
          <PlanAssumptions assumptions={plan.assumptions} />
        </ReportSection>

        <ReportSection title="What we'd change">
          <PlanChanges plan={plan} view={planView} selected={selected} onToggle={toggle} />
          <PlanScenarios plan={plan} />
        </ReportSection>

        {planView.rules.length > 0 && (
          <ReportSection title="Your new money rules">
            <Card>
              <NumberedList items={planView.rules} />
            </Card>
          </ReportSection>
        )}

        <ReportSection title="Your 30-day reset">
          <Card>
            <NumberedList items={planView.reset} />
          </Card>
        </ReportSection>
      </>
    ) : (
      <>
        {report.recommendations.length > 0 && (
          <ReportSection title="What you could change">
            <div className="flex flex-col gap-4">
              {report.recommendations.map((r, i) => (
                <SecondaryCard key={i} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="text-base font-semibold tracking-tight">{r.title}</h3>
                    {r.estimatedMonthlyImpact > 0 && (
                      <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-accent-wash px-3 py-1 text-xs font-medium tabular-nums text-foreground">
                        <TrendingDown size={14} className="text-accent" aria-hidden />
                        ~{formatNaira(r.estimatedMonthlyImpact)}/mo
                      </span>
                    )}
                  </div>
                  <p className="max-w-prose text-sm leading-6 text-foreground-secondary">{r.description}</p>
                </SecondaryCard>
              ))}
            </div>
          </ReportSection>
        )}

        {report.thirtyDayReset.length > 0 && (
          <ReportSection title="Your 30-day money reset">
            <Card>
              <NumberedList items={report.thirtyDayReset} />
            </Card>
          </ReportSection>
        )}
      </>
    );

  const share = (
    <ReportSection title="Share your autopsy" description="Cards made to post. Each one carries moneyautopsy.xyz.">
      <ShareCards cards={report.shareCards ?? []} />
    </ReportSection>
  );

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm font-medium tabular-nums text-foreground-muted">
          <CalendarDays size={14} className="text-accent" aria-hidden />
          {formatDate(report.overview.periodStart)} — {formatDate(report.overview.periodEnd)}
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight">Your money autopsy</h1>
        <div className="pt-4">
          <DownloadPdfButton reportId={report.id} />
        </div>
      </div>

      <ReportTabs value={tab} onValueChange={openTab} panels={{ summary, money, insights, plan: planTab, share }} />
    </div>
  );
}
