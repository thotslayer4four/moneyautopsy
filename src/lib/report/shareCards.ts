import type { FinancialAnalysis, ShareCard } from "@/lib/types";
import { formatNaira } from "@/lib/format";
import { topKnownCategory } from "@/lib/analysis/helpers";
import { feeTagline, runwayTagline } from "@/lib/analysis/slang";

const n = formatNaira;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function period(a: FinancialAnalysis): string | null {
  if (!a.periodStart || !a.periodEnd) return null;
  const fmt = (iso: string, withYear: boolean) =>
    new Date(iso + "T00:00:00Z").toLocaleDateString("en-NG", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  return `${fmt(a.periodStart, false)} – ${fmt(a.periodEnd, true)}`;
}

/**
 * The cards a person might post: one loud, specific number each, no names, no merchants —
 * only figures and counts. Each card is built only when the data actually supports it, and
 * carries a masked variant so it can be shared without showing any naira amounts.
 */
export function buildShareCards(a: FinancialAnalysis): ShareCard[] {
  const cards: ShareCard[] = [];
  const when = period(a);
  const b = a.betting;
  const d = a.dataAirtime;

  if (b && b.depositCount >= 3) {
    const ahead = b.netResult >= 0;
    cards.push({
      id: "betting",
      theme: ahead ? "win" : "hot",
      kicker: "Betting",
      big: `${b.depositCount} deposits`,
      label: "into betting apps",
      lines: [`${n(b.deposited)} in, ${n(b.withdrawn)} back`, ahead ? `Came out ${n(b.netResult)} ahead` : `Net cost ${n(-b.netResult)}`],
      tagline: b.tagline,
      period: when,
    });
  }

  if (d && d.dataCount + d.airtimeCount >= 5) {
    const count = d.dataCount + d.airtimeCount;
    cards.push({
      id: "data-airtime",
      theme: "signal",
      kicker: "Data & airtime",
      big: n(d.dataTotal + d.airtimeTotal),
      bigMasked: `${count} top-ups`,
      label: "on data and airtime",
      lines: [`${plural(count, "separate purchase")}`, `About ${n(d.averagePurchase)} each`],
      tagline: d.tier === "light" ? undefined : d.tagline,
      period: when,
    });
  }

  if (a.bankChargeCount >= 5 || a.bankCharges >= 1000) {
    cards.push({
      id: "bank-charges",
      theme: "amber",
      kicker: "Bank charges",
      big: n(a.bankCharges),
      bigMasked: plural(a.bankChargeCount, "charge"),
      label: "gone to fees",
      lines: [`${plural(a.bankChargeCount, "separate charge")}`],
      tagline: feeTagline(a.bankCharges + a.bankChargeCount),
      period: when,
    });
  }

  if (a.peopleTransfers.count >= 3 && a.peopleTransfers.total > 0) {
    cards.push({
      id: "people",
      theme: "warm",
      kicker: "Sent to people",
      big: n(a.peopleTransfers.total),
      bigMasked: plural(a.peopleTransfers.count, "transfer"),
      label: "sent to other people",
      lines: [`${plural(a.peopleTransfers.count, "transfer")}`, ...(a.support.sent > 0 ? [`${n(a.support.sent)} as gifts & support`] : [])],
      tagline: a.totalOutflow > 0 && a.peopleTransfers.total / a.totalOutflow >= 0.25 ? "Na you dey carry everybody." : undefined,
      period: when,
    });
  }

  const runway = a.balance?.runway;
  if (runway) {
    cards.push({
      id: "runway",
      theme: "ink",
      kicker: "Payday",
      big: `${runway.medianDays} days`,
      label: "before the money's mostly gone",
      lines: [`Based on ${plural(runway.events, "payday")}`],
      tagline: runway.medianDays <= 7 ? runwayTagline(runway.medianDays) : undefined,
      period: when,
    });
  }

  const night = a.timePatterns?.lateNight;
  if (night && night.percentOfSpend >= 25 && night.count >= 5) {
    cards.push({
      id: "late-night",
      theme: "ink",
      kicker: "After dark",
      big: `${Math.round(night.percentOfSpend)}%`,
      label: "of my spending happens after 10pm",
      lines: [`${plural(night.count, "late-night transaction")}`],
      period: when,
    });
  }

  const top = topKnownCategory(a.categoryBreakdown);
  if (top && a.totalOutflow > 0) {
    cards.push({
      id: "leak",
      theme: "signal",
      kicker: "Biggest leak",
      big: top.category,
      label: "is where my money really goes",
      lines: [`${n(top.total)} · ${Math.round(top.percentOfOutflow)}% of everything that left`],
      period: when,
    });
  }

  cards.push({
    id: "summary",
    theme: "ink",
    kicker: "My money autopsy",
    big: n(a.outflowSplit.spent),
    bigMasked: plural(a.transactionCount, "transaction"),
    label: "actually spent",
    lines: [`${n(a.totalInflow)} in · ${n(a.totalOutflow)} out`, `${plural(a.transactionCount, "transaction")} analysed`],
    period: when,
  });

  return cards;
}
