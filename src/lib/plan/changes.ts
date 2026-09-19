import type { Category, FinancialAnalysis, PlanChange, PlanStat, UserProfile } from "@/lib/types";
import { formatNaira } from "@/lib/format";
import { cap, clamp, floorTo, niceAmount, niceTarget, plural, roundTo, tidyName, WEEKS_PER_MONTH } from "./numbers";
import { helpingBucket, type MonthlySpending } from "./spending";

const n = formatNaira;

/** Nothing smaller than this is worth a person's attention as a "change". */
const MIN_SAVING_FLOOR = 1_500;
const MIN_SAVING_SHARE_OF_INCOME = 0.01;
const MIN_GIVING_FLOOR = 5_000;
const MIN_GIVING_SHARE_OF_INCOME = 0.03;

/** Bigger data plans are cheaper per GB — the saving we quote, stated once. */
const BULK_DATA_SAVING = 0.3;
const SHOPPING_CUT = 0.25;
const PERSONAL_CUT = 0.2;
const TRANSPORT_CUT = 0.15;
const FEES_CUT = 0.25;
const CASH_CUT = 0.2;
const MIN_CASH_WITHDRAWALS = 4;
const BETTING_CUT = 0.5;
const FOOD_MIN_CUT = 0.1;
const FOOD_MAX_CUT = 0.3;
/** Meals swapped at home per week that the food change is sized around. */
const FOOD_SWAPS_PER_WEEK = 2;

const MAX_CHANGES = 6;

export interface ChangeContext {
  analysis: FinancialAnalysis;
  profile: UserProfile;
  months: number;
  income: number;
  spending: MonthlySpending;
}

interface Ranked extends PlanChange {
  score: number;
}

const times = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);

export function buildChanges(ctx: ChangeContext): PlanChange[] {
  const { analysis, months, income, spending } = ctx;
  const minSaving = Math.max(MIN_SAVING_FLOOR, income * MIN_SAVING_SHARE_OF_INCOME);
  const minGiving = Math.max(MIN_GIVING_FLOOR, income * MIN_GIVING_SHARE_OF_INCOME);
  const found: Ranked[] = [];

  const category = (c: Category) => spending.byCategory.get(c);
  const topSpend = analysis.categoryBreakdown.find((c) => c.kind === "spend")?.category;

  // ---- food: swap, don't stop ----
  const food = category("Food");
  if (food && food.monthly >= minSaving / FOOD_MIN_CUT) {
    const perMonth = food.count / months;
    const swapShare = perMonth > 0 ? (FOOD_SWAPS_PER_WEEK * WEEKS_PER_MONTH) / perMonth : FOOD_MIN_CUT;
    const target = niceTarget(food.monthly, clamp(swapShare, FOOD_MIN_CUT, FOOD_MAX_CUT));
    const saving = roundTo(food.monthly, 1) - target;
    if (saving >= minSaving) {
      const swapsPerWeek = Math.round((saving / food.monthly) * perMonth / WEEKS_PER_MONTH);
      found.push({
        id: "food",
        label: "food",
        category: "Food",
        bucket: "everyday",
        nature: "cut",
        monthlyNow: Math.round(food.monthly),
        monthlyTarget: target,
        monthlySaving: Math.round(food.monthly) - target,
        optional: false,
        fact: `You spent about ${n(food.monthly)} a month on food, across roughly ${plural(Math.round(perMonth), "purchase")} a month.`,
        proposal:
          swapsPerWeek >= 1
            ? `Eat at home ${times(swapsPerWeek)} more a week. That alone brings food to about ${n(target)} a month.`
            : `Try keeping food around ${n(target)} a month. You don't have to stop eating out.`,
        why: topSpend === "Food" ? "Food is your biggest spend, so a small swap here does the most." : "Small swaps add up fastest where you spend most often.",
        rule: `Keep food under ${n(target)} a month.`,
        reset: `Keep food under ${n(target)}.`,
        stats: [],
        vsGoalAmount: null,
        scenario: true,
        score: saving,
      });
    }
  }

  // ---- shopping / personal / transport: an allowance, not a ban ----
  const allowanceFor = (
    id: string,
    label: string,
    cat: Category,
    cut: number,
    why: string,
    bucket: PlanChange["bucket"]
  ) => {
    const e = category(cat);
    if (!e || e.monthly * cut < minSaving) return;
    const target = niceTarget(e.monthly, cut);
    const now = Math.round(e.monthly);
    if (now - target < minSaving) return;
    found.push({
      id,
      label,
      category: cat,
      bucket,
      nature: "cut",
      monthlyNow: now,
      monthlyTarget: target,
      monthlySaving: now - target,
      optional: false,
      fact: `You spent about ${n(now)} a month on ${label}, across roughly ${plural(Math.round(e.count / months), "purchase")} a month.`,
      proposal: `Set a monthly ${label} allowance of ${n(target)}. No need to stop, just decide the number first.`,
      why,
      rule: `Give ${label} an allowance of ${n(target)} a month. When it's gone, it's gone.`,
      reset: `Keep ${label} within ${n(target)}.`,
      stats: [],
      vsGoalAmount: null,
      scenario: true,
      score: now - target,
    });
  };
  allowanceFor("shopping", "shopping", "Shopping", SHOPPING_CUT, "An allowance keeps the things you love without letting them quietly grow.", "everyday");
  allowanceFor("personal", "personal spending", "Personal expenses", PERSONAL_CUT, "Small personal spends are easy to lose track of, so a ceiling helps.", "everyday");
  if (ctx.spending.byCategory.has("Transport") && !ctx.profile.expensesCovered.includes("transportation")) {
    allowanceFor("transport", "transport", "Transport", TRANSPORT_CUT, "Transport adds up in small trips, and a weekly figure is easier to keep than a monthly one.", "everyday");
  }

  // ---- cash: a weekly limit is easier to keep than a monthly total ----
  const cash = category("Cash");
  if (cash && cash.count >= MIN_CASH_WITHDRAWALS && cash.monthly * CASH_CUT >= minSaving) {
    const target = niceTarget(cash.monthly, CASH_CUT);
    const now = Math.round(cash.monthly);
    if (now - target >= minSaving) {
      const weekly = roundTo(target / WEEKS_PER_MONTH, 500);
      found.push({
        id: "cash",
        label: "cash",
        category: "Cash",
        bucket: "everyday",
        nature: "cut",
        monthlyNow: now,
        monthlyTarget: target,
        monthlySaving: now - target,
        optional: false,
        fact: `You withdrew about ${n(now)} a month in cash, across ${plural(cash.count, "withdrawal")}.`,
        proposal: `Withdraw cash once a week, capped at ${n(weekly)}. You keep the convenience, and every naira stays easier to trace.`,
        why: "Cash is hard to see once it's in your hand, so a weekly limit is an easy way to stay in control.",
        rule: `Withdraw cash once a week, and no more than ${n(weekly)}.`,
        reset: `Keep cash withdrawals to ${n(weekly)} a week.`,
        stats: [],
        vsGoalAmount: null,
        scenario: true,
        score: now - target,
      });
    }
  }

  // ---- subscriptions ----
  const subs = analysis.potentialSubscriptions;
  if (subs.length > 0) {
    const monthly = subs.reduce((s, r) => {
      const perMonth = r.cadenceDays && r.cadenceDays > 0 ? Math.min(30 / r.cadenceDays, 4) : 1;
      return s + r.averageAmount * perMonth;
    }, 0);
    const oneOff = Math.round(monthly / subs.length);
    if (oneOff >= minSaving) {
      const now = Math.round(monthly);
      found.push({
        id: "subscriptions",
        label: "subscriptions",
        category: "Subscriptions",
        bucket: "everyday",
        nature: "cut",
        monthlyNow: now,
        monthlyTarget: now - oneOff,
        monthlySaving: oneOff,
        optional: false,
        fact: `You had about ${n(now)} a month in recurring subscriptions, across ${plural(subs.length, "payment")}.`,
        proposal:
          subs.length === 1
            ? `Check whether you still use ${tidyName(subs[0].merchant)}. If not, cancelling saves about ${n(oneOff)} a month.`
            : `Cancel anything you don't actively use. Dropping just one saves about ${n(oneOff)} a month.`,
        why: "Subscriptions charge you whether or not you remember them.",
        rule: "Review your subscriptions on the first of every month.",
        reset: subs.length === 1 ? `Decide whether to keep ${tidyName(subs[0].merchant)}.` : "Cancel at least one subscription you don't use.",
        stats: [],
        vsGoalAmount: null,
        scenario: false,
        score: oneOff,
      });
    }
  }

  // ---- bank charges ----
  const feesMonthly = analysis.bankCharges / months;
  if ((analysis.bankChargeCount >= 5 || feesMonthly >= minSaving) && feesMonthly * FEES_CUT >= minSaving) {
    const target = niceTarget(feesMonthly, FEES_CUT);
    const now = Math.round(feesMonthly);
    if (now - target >= minSaving) {
      found.push({
        id: "fees",
        label: "bank charges",
        category: "Banking fees",
        bucket: "essentials",
        nature: "cut",
        monthlyNow: now,
        monthlyTarget: target,
        monthlySaving: now - target,
        optional: false,
        fact: `You paid about ${n(now)} a month in bank fees, across ${plural(analysis.bankChargeCount, "charge")}.`,
        proposal: "Batch small transfers into fewer, bigger ones, and skip withdrawals you can avoid.",
        why: "Fees are money you never see a benefit from, and they're the easiest leak to close.",
        rule: "Send one bigger transfer instead of several small ones.",
        reset: "Batch your small transfers where you can.",
        stats: [],
        vsGoalAmount: null,
        scenario: false,
        score: now - target,
      });
    }
  }

  // ---- data: buy bigger, not less ----
  const d = analysis.dataAirtime;
  if (d && d.dataTotal > 0) {
    const dataMonthly = d.dataTotal / months;
    const purchasesPerMonth = d.dataCount / months;
    if (purchasesPerMonth >= 3 && dataMonthly * BULK_DATA_SAVING >= minSaving) {
      const target = niceTarget(dataMonthly, BULK_DATA_SAVING);
      const now = Math.round(dataMonthly);
      if (now - target >= minSaving) {
        found.push({
          id: "data",
          label: "data",
          category: "Data",
          bucket: "essentials",
          nature: "cut",
          monthlyNow: now,
          monthlyTarget: target,
          monthlySaving: now - target,
          optional: false,
          fact: `You spent about ${n(now)} a month on data, in roughly ${plural(Math.round(purchasesPerMonth), "separate top-up")} a month.`,
          proposal: `Buy one bigger plan instead of topping up in bits. Bigger plans usually work out about 30% cheaper, so the same data for around ${n(target)}.`,
          why: "You clearly need the data. The saving is in how you buy it, not in using less.",
          rule: "Buy your data in one bigger plan, not in bits.",
          reset: "Buy one bigger data plan instead of topping up.",
          stats: [
            { label: "Top-ups a month", value: String(Math.round(purchasesPerMonth)) },
            { label: "Average top-up", value: n(d.dataTotal / d.dataCount) },
          ],
          vsGoalAmount: null,
          scenario: false,
          score: now - target,
        });
      }
    }
  }

  // ---- betting: theirs to decide, never assumed ----
  const b = analysis.betting;
  if (b && b.depositCount >= 3 && b.netOutflow / months >= minSaving) {
    const now = Math.round(b.netOutflow / months);
    const target = niceTarget(now, BETTING_CUT);
    const depositedMonthly = b.deposited / months;
    const weeklyCap = Math.max(1_000, roundTo((depositedMonthly * BETTING_CUT) / WEEKS_PER_MONTH, 500));
    const stats: PlanStat[] = [
      { label: "Deposited a month", value: n(depositedMonthly) },
      { label: "Withdrawn a month", value: n(b.withdrawn / months) },
      { label: "Net cost a month", value: n(now) },
      { label: "Deposits a month", value: String(Math.round(b.depositCount / months)) },
    ];
    found.push({
      id: "betting",
      label: "betting",
      category: "Betting",
      bucket: "fun",
      nature: "cut",
      monthlyNow: now,
      monthlyTarget: target,
      monthlySaving: now - target,
      optional: true,
      fact: `You deposited about ${n(depositedMonthly)} a month into betting and withdrew ${n(b.withdrawn / months)}, a net cost of ${n(now)}.`,
      proposal: `If you want to change this, a weekly cap of ${n(weeklyCap)} on deposits is a place to start. It's your call how far to go.`,
      why: "Winnings coming back are counted, so this is what betting actually cost you, not what you put in.",
      rule: `Cap betting deposits at ${n(weeklyCap)} a week.`,
      reset: `Cap betting deposits at ${n(weeklyCap)} a week and note each one.`,
      stats,
      vsGoalAmount: Math.round(depositedMonthly),
      scenario: false,
      score: now - target,
    });
  }

  // ---- helping people: give it its own budget, don't cut it ----
  const giveBucket = helpingBucket(ctx.profile);
  if (analysis.support.sentCount >= 2 && spending.supportSent >= minGiving) {
    const now = Math.round(spending.supportSent);
    const allowance = niceAmount(spending.supportSent);
    found.push({
      id: "support",
      label: "helping people",
      category: "Gifts & support",
      bucket: giveBucket,
      nature: "limit",
      monthlyNow: now,
      monthlyTarget: allowance,
      monthlySaving: 0,
      optional: false,
      fact: `You sent about ${n(now)} a month to people, across ${plural(analysis.support.sentCount, "transfer")}.`,
      proposal: `Give helping people its own ${n(allowance)} a month. That makes it a decision, not a drain on your own goals.`,
      why: "Supporting people is part of your real financial life. A number of its own lets you do it without guilt.",
      rule: `Give helping people its own ${n(allowance)} a month.`,
      reset: `Keep helping people within ${n(allowance)}.`,
      stats: [],
      vsGoalAmount: null,
      scenario: false,
      score: now * 0.25,
    });
  }

  // ---- lending ----
  if (spending.lentNet >= minGiving) {
    const now = Math.round(spending.lentNet);
    const allowance = niceAmount(spending.lentNet);
    const back = analysis.loans.receivedBack;
    found.push({
      id: "lending",
      label: "lending",
      category: "Loans",
      bucket: giveBucket,
      nature: "limit",
      monthlyNow: now,
      monthlyTarget: allowance,
      monthlySaving: 0,
      optional: false,
      fact: `You lent about ${n(now)} a month${back > 0 ? ` and got ${n(back / ctx.months)} back` : ", and this statement shows none of it coming back"}.`,
      proposal: `If helping people matters to you, give lending a limit of ${n(allowance)} a month so it doesn't compete with your own goals.`,
      why: "Money you lend is money you may not see again, so it's worth deciding how much you can afford to let go.",
      rule: `Lend only from a ${n(allowance)} monthly allowance.`,
      reset: `Keep lending within ${n(allowance)}.`,
      stats: [],
      vsGoalAmount: null,
      scenario: false,
      score: now * 0.25,
    });
  }

  // Best first. Anything they must opt into (betting) is always offered, never leads.
  const ranked = found.sort((a, b) => Number(a.optional) - Number(b.optional) || b.score - a.score).slice(0, MAX_CHANGES);
  return ranked.map(({ score: _score, ...change }) => (void _score, { ...change, fact: cap(change.fact), proposal: cap(change.proposal), why: cap(change.why) }));
}

/** Rules that stand on their own evidence, whichever changes are chosen. */
export function buildExtraRules(ctx: ChangeContext): { id: string; text: string }[] {
  const { analysis } = ctx;
  const rules: { id: string; text: string }[] = [];

  const unusual = analysis.unusualTransactions;
  if (unusual.length > 0) {
    const threshold = floorTo(Math.min(...unusual.map((u) => u.amount)), 5_000);
    if (threshold >= 5_000) rules.push({ id: "pause", text: `Anything over ${n(threshold)} gets a 24-hour pause before you pay.` });
  }

  return rules;
}
