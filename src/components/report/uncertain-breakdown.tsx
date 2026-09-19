"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { formatNaira, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SecondaryCard } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INFLOW_EDITABLE_CATEGORIES, OUTFLOW_EDITABLE_CATEGORIES, optionLabel } from "@/lib/categorization/categories";
import type { Category, ClientReport, IncomeQuestion, Report, UncertainQuestion } from "@/lib/types";

type Direction = "in" | "out";

// Answers usually come in bursts; wait for a pause before re-writing the narrative so one
// burst costs one rewrite, not one per answer.
const REFRESH_DEBOUNCE_MS = 2000;

export function UncertainBreakdown({
  reportId,
  breakdown,
  incomeCheck,
  planIncome,
  onReportUpdated,
  onRefreshingChange,
}: {
  reportId: string;
  breakdown: Report["uncertainBreakdown"] | undefined;
  /** Heavy credits we couldn't confidently call income. */
  incomeCheck?: Report["incomeCheck"];
  /** What the plan works from each month right now, so an answer can show what it changed. */
  planIncome?: number | null;
  onReportUpdated: (report: ClientReport) => void;
  /** True from the first answer until the findings have been re-written to match. */
  onRefreshingChange?: (refreshing: boolean) => void;
}) {
  const questions = breakdown?.questions ?? [];
  const incomeQuestions = incomeCheck?.questions ?? [];
  // A credit that is asked about as possible income isn't asked about twice.
  const askedAsIncome = new Set(incomeQuestions.flatMap((q) => q.coversTransactionIds));
  const outQuestions = questions.filter((q) => q.direction === "out");
  const inQuestions = questions.filter((q) => q.direction === "in" && !askedAsIncome.has(q.transactionId));
  const anyQuestions = outQuestions.length + inQuestions.length + incomeQuestions.length > 0;
  const notAsked = breakdown?.notAsked;
  const notAskedCount = (notAsked?.out.count ?? 0) + (notAsked?.in.count ?? 0);
  const notAskedTotal = (notAsked?.out.total ?? 0) + (notAsked?.in.total ?? 0);
  const coverage = breakdown?.coverage;
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [effect, setEffect] = useState<string | null>(null);
  const refreshTimer = useRef<number | undefined>(undefined);
  const refreshRun = useRef(0);

  useEffect(() => () => window.clearTimeout(refreshTimer.current), []);

  async function refreshNarrative() {
    refreshTimer.current = undefined;
    const run = ++refreshRun.current;
    try {
      const res = await fetch(`/api/report/${reportId}/refresh`, { method: "POST" });
      const json = await res.json();
      // A newer answer may have arrived while this ran — its own refresh will follow.
      if (res.ok && run === refreshRun.current) onReportUpdated(json.report as ClientReport);
    } catch {
      // The numbers are already updated; a failed rewrite just leaves the earlier wording.
    } finally {
      if (run === refreshRun.current && refreshTimer.current === undefined) onRefreshingChange?.(false);
    }
  }

  function scheduleRefresh() {
    onRefreshingChange?.(true);
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(refreshNarrative, REFRESH_DEBOUNCE_MS);
  }

  if (questions.length === 0 && notAskedCount === 0 && incomeQuestions.length === 0) return null;

  async function handleLabel(question: UncertainQuestion, category: Category) {
    setSavingKey(question.transactionId);
    setError(null);
    setEffect(null);
    try {
      const res = await fetch(`/api/report/${reportId}/recategorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: question.transactionId, category }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save that correction.");
      const next = json.report as ClientReport;
      onReportUpdated(next);
      scheduleRefresh();
      if (incomeQuestions.some((q) => q.transactionId === question.transactionId)) {
        setEffect(describeIncomeAnswer(category, planIncome ?? null, next.status === "unlocked" ? (next.moneyPlan?.income.monthly ?? null) : null));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <SecondaryCard className="flex flex-col gap-6 hover:shadow-none">
      {effect && (
        <div role="status">
          <Callout leadIn="Done.">{effect}</Callout>
        </div>
      )}

      {anyQuestions ? (
        <Callout>
          We only ask about what would change the picture.
          {coverage && (coverage.out > 0 || coverage.in > 0)
            ? ` Answering these would explain about ${[
                coverage.out > 0 ? `${coverage.out}% of the money we couldn't explain going out` : null,
                coverage.in > 0 ? `${coverage.in}% of what we couldn't explain coming in` : null,
              ]
                .filter(Boolean)
                .join(" and ")}.`
            : ""}{" "}
          You don&apos;t have to answer them all — every answer updates the whole autopsy. If you paid for someone and
          they paid you back, choose &ldquo;Paid for someone&rdquo; on the payment and &ldquo;Someone paying me
          back&rdquo; on the transfer.
        </Callout>
      ) : (
        <Callout>
          Nothing left unexplained is big enough to be worth asking about — it wouldn&apos;t change the picture.
        </Callout>
      )}

      <IncomeQuestionList
        items={incomeQuestions}
        overspending={incomeCheck?.overspending ?? false}
        savingKey={savingKey}
        onLabel={handleLabel}
      />

      <QuestionList title="Sent" direction="out" items={outQuestions} savingKey={savingKey} onLabel={handleLabel} />

      <QuestionList
        title="Received — not assumed to be income"
        direction="in"
        items={inQuestions}
        savingKey={savingKey}
        onLabel={handleLabel}
      />

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {notAskedCount > 0 && (
        <p className="max-w-prose text-xs leading-5 text-foreground-muted">
          We&apos;re not asking about the other {notAskedCount} unexplained transaction{notAskedCount === 1 ? "" : "s"} (
          {formatNaira(notAskedTotal)} together) — small or routine next to the rest.
          {questions.length > 0 ? " Answering the ones above also covers other payments to the same person." : ""}
        </p>
      )}
    </SecondaryCard>
  );
}

/** What an answer did, in a sentence — from the plan as it actually is now, not a guess. */
function describeIncomeAnswer(category: Category, before: number | null, after: number | null): string {
  if (category !== "Income") return "Got it. That won't count as income.";
  if (before !== null && after !== null && after !== before) {
    return `Counted as income. Your plan now works from about ${formatNaira(after)} a month, ${after > before ? "up" : "down"} from ${formatNaira(before)}.`;
  }
  return "Counted as income.";
}

/** Narrations carry long reference numbers and pipe separators; keep what a person would recognize. */
function cleanNarration(text: string): string {
  return text
    .replace(/\b\d{12,}\w*/g, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/(\s·)+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function QuestionList({
  title,
  direction,
  items,
  savingKey,
  onLabel,
}: {
  title: string;
  direction: Direction;
  items: UncertainQuestion[];
  savingKey: string | null;
  onLabel: (question: UncertainQuestion, category: Category) => void;
}) {
  if (items.length === 0) return null;
  const categories = direction === "in" ? INFLOW_EDITABLE_CATEGORIES : OUTFLOW_EDITABLE_CATEGORIES;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground-secondary">
        {direction === "in" ? (
          <ArrowDownLeft size={16} className="text-accent" aria-hidden />
        ) : (
          <ArrowUpRight size={16} className="text-accent" aria-hidden />
        )}
        {title}
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((q) => {
          const saving = savingKey === q.transactionId;
          return (
            <li key={q.transactionId} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm font-medium">{q.name}</span>
                  <span className="text-xs tabular-nums text-foreground-muted">
                    {formatNaira(q.amount)} · {formatDate(q.date)}
                  </span>
                  <span className="text-xs text-foreground-secondary">{q.why}</span>
                </div>
                <Select onValueChange={(value) => onLabel(q, value as string as Category)} disabled={saving}>
                  <SelectTrigger aria-label={`What was the ${formatNaira(q.amount)} ${direction === "in" ? "from" : "to"} ${q.name} on ${formatDate(q.date)}?`}>
                    <SelectValue placeholder={saving ? "Saving…" : direction === "in" ? "What is this?" : "What was this for?"} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>
                        {optionLabel(c, direction)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="border-l-2 border-border pl-3 text-xs leading-5 text-foreground-secondary" title={q.description}>
                <span className="line-clamp-2">{cleanNarration(q.description)}</span>
              </p>
              {q.followers > 0 && (
                <p className="text-xs text-foreground-muted">
                  {q.followers} other unexplained payment{q.followers === 1 ? "" : "s"} {direction === "in" ? "from" : "to"}{" "}
                  the same person will follow your answer.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const NOT_INCOME_CATEGORIES = INFLOW_EDITABLE_CATEGORIES.filter((c) => c !== "Income");

/**
 * Heavy credits we haven't confidently called income. Money from a person is never assumed to
 * be earnings, so the person says — and each question shows what a "yes" would do to the plan.
 */
function IncomeQuestionList({
  items,
  overspending,
  savingKey,
  onLabel,
}: {
  items: IncomeQuestion[];
  overspending: boolean;
  savingKey: string | null;
  onLabel: (question: UncertainQuestion, category: Category) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground-secondary">
        <Wallet size={16} className="text-accent" aria-hidden />
        Is this your income?
      </p>
      <p className="max-w-prose text-xs leading-5 text-foreground-muted">
        {overspending
          ? "You spend more than the income we can confirm, so we're asking about smaller credits too. "
          : "These are the biggest credits we couldn't place. "}
        Money from a person isn&apos;t assumed to be income, so tell us and we&apos;ll count it.
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((q) => {
          const saving = savingKey === q.transactionId;
          const showsRise = q.monthlyBefore !== null && q.monthlyAfter !== null && q.monthlyAfter > q.monthlyBefore;
          return (
            <li key={q.transactionId} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">{q.name}</span>
                <span className="text-xs tabular-nums text-foreground-muted">
                  {q.count > 1 ? `${q.count} credits · ${formatNaira(q.total)} in total` : `${formatNaira(q.total)} · ${formatDate(q.date)}`}
                </span>
                <span className="text-xs text-foreground-secondary">
                  {q.why}
                  {q.count > 1 ? ". One answer covers all of them." : ""}
                </span>
              </div>
              {showsRise && (
                <p className="max-w-prose text-sm leading-6 text-foreground-secondary">
                  If this is your income, your plan would work from about{" "}
                  <span className="font-medium tabular-nums text-foreground">{formatNaira(q.monthlyAfter!)}</span> a month, not{" "}
                  <span className="tabular-nums">{formatNaira(q.monthlyBefore!)}</span>.
                </p>
              )}
              <p className="border-l-2 border-border pl-3 text-xs leading-5 text-foreground-secondary" title={q.description}>
                <span className="line-clamp-2">{cleanNarration(q.description)}</span>
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => onLabel(q, "Income")} disabled={saving}>
                  {saving ? "Saving…" : "Yes, it's my income"}
                </Button>
                <Select onValueChange={(value) => onLabel(q, value as string as Category)} disabled={saving}>
                  <SelectTrigger aria-label={`If the ${formatNaira(q.total)} from ${q.name} isn't your income, what was it?`}>
                    <SelectValue placeholder="It's something else" />
                  </SelectTrigger>
                  <SelectContent>
                    {NOT_INCOME_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {optionLabel(c, "in")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
