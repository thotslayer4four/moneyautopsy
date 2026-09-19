import type {
  BalanceInsights,
  Category,
  DayOfWeekSpend,
  FeeEfficiency,
  LedgerEntry,
  NormalizedTransaction,
  PriceCreepEntry,
  TimePatterns,
} from "@/lib/types";
import { CATEGORY_KIND } from "@/lib/categorization/categories";
import { isTransferRail } from "@/lib/categorization/channels";
import { dayOfWeek, daysBetween, isSpendLike, isStrongRecipientKey, median, recipientKeyFor } from "./helpers";

/**
 * Behavioral analyses that go beyond totals: what the running balance says, when money
 * moves, who it moves between, and what it costs to move. Everything here is deterministic
 * and honest about missing data — a statement with no timestamps or balances simply gets
 * no time or balance findings, never guessed ones.
 */

const sum = (txs: NormalizedTransaction[]) => txs.reduce((s, t) => s + t.amount, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (iso: string) => Math.floor(new Date(iso + "T00:00:00Z").getTime() / DAY_MS);
const isoOfDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/**
 * Statements list newest-first as often as oldest-first. Balances only make sense in the
 * order things happened, so put the transactions in true chronological order (keeping the
 * file's own order within a day).
 */
export function chronological(txs: NormalizedTransaction[]): NormalizedTransaction[] {
  let ascending = 0;
  let descending = 0;
  for (let i = 0; i < txs.length - 1; i++) {
    const cmp = txs[i].date.localeCompare(txs[i + 1].date);
    if (cmp < 0) ascending++;
    else if (cmp > 0) descending++;
  }
  const ordered = descending > ascending ? [...txs].reverse() : [...txs];
  return ordered.sort((a, b) => a.date.localeCompare(b.date)); // stable
}

// ---------------------------------------------------------------------------
// 1. Balance and runway
// ---------------------------------------------------------------------------

const BALANCE_FLOOR = 5_000;
const RUNWAY_MIN_EVENT = 20_000;
const RUNWAY_REMAINING_FRACTION = 0.2;
const SERIES_MAX_POINTS = 60;

export function computeBalanceInsights(all: NormalizedTransaction[]): BalanceInsights | null {
  const txs = chronological(all);
  const withBalance = txs.filter((t) => t.balance !== null);
  if (withBalance.length < 10 || withBalance.length / txs.length < 0.7) return null;

  // Only trust balances that actually follow from the amounts, in this order.
  let checked = 0;
  let consistent = 0;
  for (let i = 1; i < withBalance.length; i++) {
    const prev = withBalance[i - 1];
    const cur = withBalance[i];
    checked++;
    const expected = prev.balance! + (cur.direction === "in" ? cur.amount : -cur.amount);
    if (Math.abs(expected - cur.balance!) <= Math.max(1, cur.amount * 0.02)) consistent++;
  }
  if (checked === 0 || consistent / checked < 0.85) return null;

  const closingByDate = new Map<string, number>();
  for (const t of withBalance) closingByDate.set(t.date, t.balance!);
  const dates = Array.from(closingByDate.keys()).sort();
  const firstDay = dayNumber(dates[0]);
  const lastDay = dayNumber(dates[dates.length - 1]);

  // Closing balance for every calendar day, carrying the last known balance forward.
  const daily: { day: number; balance: number }[] = [];
  let carry = closingByDate.get(dates[0])!;
  for (let d = firstDay; d <= lastDay; d++) {
    carry = closingByDate.get(isoOfDay(d)) ?? carry;
    daily.push({ day: d, balance: carry });
  }

  const closings = dates.map((date) => ({ date, balance: closingByDate.get(date)! }));
  const lowest = closings.reduce((a, b) => (b.balance < a.balance ? b : a));
  const highest = closings.reduce((a, b) => (b.balance > a.balance ? b : a));
  const daysBelowFloor = daily.filter((d) => d.balance < BALANCE_FLOOR).length;
  const averageClosing = daily.reduce((s, d) => s + d.balance, 0) / daily.length;

  // Runway: after real money arrives, how many days until most of it is gone?
  const events = withBalance.filter(
    (t) =>
      t.direction === "in" &&
      (t.category === "Income" || t.category === "Gifts & support") &&
      t.amount >= RUNWAY_MIN_EVENT &&
      t.balance! >= BALANCE_FLOOR * 2
  );
  const runways: { date: string; amount: number; days: number }[] = [];
  for (const ev of events) {
    const startDay = dayNumber(ev.date);
    const threshold = Math.max(BALANCE_FLOOR, ev.balance! * RUNWAY_REMAINING_FRACTION);
    const hit = daily.find((d) => d.day > startDay && d.balance <= threshold);
    if (hit) runways.push({ date: ev.date, amount: Math.round(ev.amount), days: hit.day - startDay });
  }
  const runway = runways.length
    ? {
        medianDays: Math.round(median(runways.map((r) => r.days))),
        events: runways.length,
        example: [...runways].sort((a, b) => b.amount - a.amount)[0],
      }
    : null;

  // Chartable series: thin evenly, but never drop the low point or the last day.
  let series = closings;
  if (series.length > SERIES_MAX_POINTS) {
    const step = Math.ceil(series.length / SERIES_MAX_POINTS);
    series = series.filter((_, i) => i % step === 0 || i === series.length - 1 || series[i].date === lowest.date);
  }

  return {
    floor: BALANCE_FLOOR,
    daysTracked: daily.length,
    daysBelowFloor,
    lowest: { date: lowest.date, balance: Math.round(lowest.balance) },
    highest: { date: highest.date, balance: Math.round(highest.balance) },
    averageClosing: Math.round(averageClosing),
    runway,
    series: series.map((s) => ({ date: s.date, balance: Math.round(s.balance) })),
  };
}

// ---------------------------------------------------------------------------
// 2. Time of day, sessions and rituals
// ---------------------------------------------------------------------------

const MIN_TIMED_SHARE = 0.7;
const MIN_TIMED_COUNT = 15;
const SESSION_GAP_MINUTES = 60;
const RITUAL_MIN_OCCURRENCES = 4;
const RITUAL_MIN_SHARE = 0.35;

const hourOf = (time: string) => Number(time.slice(0, 2));
const minutesOf = (time: string) => hourOf(time) * 60 + Number(time.slice(3, 5));
const isNight = (hour: number) => hour >= 22 || hour < 5;

function computeBettingSessions(deposits: NormalizedTransaction[]) {
  const byDate = new Map<string, NormalizedTransaction[]>();
  for (const t of deposits) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }

  let count = 0;
  let largest: { date: string; deposits: number; total: number; spanMinutes: number | null } | null = null;
  const consider = (date: string, run: NormalizedTransaction[]) => {
    if (run.length < 3) return;
    count++;
    const total = sum(run);
    if (!largest || total > largest.total) {
      const times = run.filter((t) => t.time).map((t) => minutesOf(t.time!));
      largest = {
        date,
        deposits: run.length,
        total: Math.round(total),
        spanMinutes: times.length === run.length ? Math.max(...times) - Math.min(...times) : null,
      };
    }
  };

  for (const [date, txs] of byDate.entries()) {
    if (!txs.every((t) => t.time)) {
      consider(date, txs); // no times: a run of deposits on one day is the best we can say
      continue;
    }
    const sorted = [...txs].sort((a, b) => minutesOf(a.time!) - minutesOf(b.time!));
    let run: NormalizedTransaction[] = [];
    for (const t of sorted) {
      const last = run[run.length - 1];
      if (last && minutesOf(t.time!) - minutesOf(last.time!) > SESSION_GAP_MINUTES) {
        consider(date, run);
        run = [];
      }
      run.push(t);
    }
    consider(date, run);
  }
  return { count, largest };
}

function computeRituals(spendTx: NormalizedTransaction[]): TimePatterns["rituals"] {
  const byCategory = new Map<Category, NormalizedTransaction[]>();
  for (const t of spendTx) {
    if (CATEGORY_KIND[t.category] !== "spend") continue;
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category)!.push(t);
  }

  const rituals: TimePatterns["rituals"] = [];
  for (const [category, txs] of byCategory.entries()) {
    const byWeekday = new Map<DayOfWeekSpend["day"], NormalizedTransaction[]>();
    for (const t of txs) {
      const wd = dayOfWeek(t.date);
      if (!byWeekday.has(wd)) byWeekday.set(wd, []);
      byWeekday.get(wd)!.push(t);
    }
    for (const [weekday, group] of byWeekday.entries()) {
      const weeks = new Set(group.map((t) => Math.floor((dayNumber(t.date) + 3) / 7))).size;
      if (group.length < RITUAL_MIN_OCCURRENCES || weeks < RITUAL_MIN_OCCURRENCES) continue;
      if (group.length / txs.length < RITUAL_MIN_SHARE) continue;
      rituals.push({
        weekday,
        category,
        count: group.length,
        weeks,
        medianAmount: Math.round(median(group.map((t) => t.amount))),
        total: Math.round(sum(group)),
      });
    }
  }
  return rituals.sort((a, b) => b.total - a.total).slice(0, 3);
}

export function computeTimePatterns(all: NormalizedTransaction[]): TimePatterns | null {
  const spendLike = all.filter(isSpendLike);
  const timed = spendLike.filter((t) => t.time);
  const hasTime = timed.length >= MIN_TIMED_COUNT && timed.length / Math.max(spendLike.length, 1) >= MIN_TIMED_SHARE;

  const rituals = computeRituals(spendLike);
  const deposits = all.filter((t) => t.direction === "out" && t.category === "Betting");

  let lateNight: TimePatterns["lateNight"] = null;
  let peakHour: TimePatterns["peakHour"] = null;
  let partsOfDay: TimePatterns["partsOfDay"] = null;
  if (hasTime) {
    const night = timed.filter((t) => isNight(hourOf(t.time!)));
    const spendTotal = sum(timed);
    lateNight = {
      count: night.length,
      total: Math.round(sum(night)),
      percentOfSpend: spendTotal > 0 ? (sum(night) / spendTotal) * 100 : 0,
      percentOfCount: (night.length / timed.length) * 100,
    };
    const byHour = new Map<number, number>();
    for (const t of timed) byHour.set(hourOf(t.time!), (byHour.get(hourOf(t.time!)) ?? 0) + 1);
    const [hour, count] = Array.from(byHour.entries()).sort((a, b) => b[1] - a[1])[0];
    peakHour = { hour, count };
    const part = (from: number, to: number) => Math.round(sum(timed.filter((t) => hourOf(t.time!) >= from && hourOf(t.time!) <= to)));
    partsOfDay = { morning: part(5, 11), afternoon: part(12, 16), evening: part(17, 21), night: Math.round(sum(night)) };
  }

  let betting: TimePatterns["betting"] = null;
  if (deposits.length >= 3) {
    const timedDeposits = deposits.filter((t) => t.time);
    betting = {
      depositCount: deposits.length,
      lateNightDeposits: timedDeposits.filter((t) => isNight(hourOf(t.time!))).length,
      sessions: computeBettingSessions(deposits),
    };
  }

  if (!hasTime && rituals.length === 0 && !betting?.sessions.count) return null;
  return { hasTime, lateNight, peakHour, partsOfDay, betting, rituals };
}

// ---------------------------------------------------------------------------
// 3. Who owes whom (net flow per person)
// ---------------------------------------------------------------------------

const LEDGER_EXCLUDED: Category[] = ["Transfers", "Savings", "Investments", "Refunds", "Betting", "Banking fees", "Cash", "Income"];
const LEDGER_MIN_TOTAL = 10_000;

export function computeLedger(all: NormalizedTransaction[]): LedgerEntry[] {
  const groups = new Map<string, NormalizedTransaction[]>();
  for (const t of all) {
    if (LEDGER_EXCLUDED.includes(t.category) || t.subtype === "own_account" || t.subtype === "wallet_pocket") continue;
    if (!isTransferRail(t.paymentMethod)) continue;
    const key = recipientKeyFor(t);
    if (!isStrongRecipientKey(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const entries: LedgerEntry[] = [];
  for (const [key, txs] of groups.entries()) {
    const sent = txs.filter((t) => t.direction === "out");
    const received = txs.filter((t) => t.direction === "in");
    if (sent.length === 0 || received.length === 0) continue; // one-way flows aren't a ledger
    if (sum(sent) + sum(received) < LEDGER_MIN_TOTAL) continue;

    const counts = new Map<Category, number>();
    for (const t of txs) if (t.category !== "Uncertain") counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
    const biggest = [...txs].sort((a, b) => b.amount - a.amount)[0];

    entries.push({
      key,
      name: biggest.merchant ?? key.replace(/^(phone|acct|name|desc):/, ""),
      sent: Math.round(sum(sent)),
      received: Math.round(sum(received)),
      net: Math.round(sum(received) - sum(sent)),
      sentCount: sent.length,
      receivedCount: received.length,
      lastDate: txs.map((t) => t.date).sort().at(-1)!,
      categories: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c),
    });
  }
  return entries.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 6);
}

// ---------------------------------------------------------------------------
// 4. Fee efficiency and price creep
// ---------------------------------------------------------------------------

const SMALL_TRANSFER = 2_000;
const PER_TRANSFER_FEE_MIN = 5;
const PER_TRANSFER_FEE_MAX = 100;

export function computeFeeEfficiency(
  outflowTx: NormalizedTransaction[],
  personTransfers: NormalizedTransaction[]
): FeeEfficiency | null {
  const fees = outflowTx.filter((t) => t.category === "Banking fees");
  if (fees.length < 5 || personTransfers.length < 5) return null;

  // Per-transfer charges (not stamp duty or SMS alerts) cluster at a few small amounts.
  const perTransfer = fees.filter(
    (t) => t.amount >= PER_TRANSFER_FEE_MIN && t.amount <= PER_TRANSFER_FEE_MAX && !/stamp|sms|alert|maintenance|vat/i.test(t.description)
  );
  const small = personTransfers.filter((t) => t.amount <= SMALL_TRANSFER);
  const medianFee = perTransfer.length >= 3 ? median(perTransfer.map((t) => t.amount)) : null;
  const medianSmall = small.length ? median(small.map((t) => t.amount)) : 0;

  return {
    totalFees: Math.round(sum(fees)),
    feeCount: fees.length,
    transferCount: personTransfers.length,
    smallTransfers: { count: small.length, total: Math.round(sum(small)), medianAmount: Math.round(medianSmall) },
    medianFee: medianFee === null ? null : Math.round(medianFee * 100) / 100,
    overheadPercentOnSmall: medianFee !== null && medianSmall > 0 ? (medianFee / medianSmall) * 100 : null,
    estimatedSmallTransferFees: medianFee !== null ? Math.round(medianFee * small.length) : null,
  };
}

const CREEP_CATEGORIES: Category[] = ["Data", "Subscriptions", "Bills"];
const CREEP_MIN_OCCURRENCES = 3;
const CREEP_MIN_CHANGE = 12; // percent

/** Strips reference numbers, phone numbers and dates so the same product groups together. */
function productKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/\b\d{4,}\w*/g, "")
    .replace(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g, "")
    .replace(/\s*\|\s*/g, "|")
    .replace(/(\|)+/g, "|")
    .replace(/\s+/g, " ")
    .replace(/^\||\|$/g, "")
    .trim();
}

export function computePriceCreep(spendTx: NormalizedTransaction[]): PriceCreepEntry[] {
  const groups = new Map<string, NormalizedTransaction[]>();
  for (const t of spendTx) {
    if (!CREEP_CATEGORIES.includes(t.category)) continue;
    const key = `${t.category}|${productKey(t.description)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const out: PriceCreepEntry[] = [];
  for (const group of groups.values()) {
    if (group.length < CREEP_MIN_OCCURRENCES) continue;
    const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
    if (new Set(sorted.map((t) => t.amount)).size < 2) continue;

    const third = Math.max(1, Math.floor(sorted.length / 3));
    const early = sorted.slice(0, third).reduce((s, t) => s + t.amount, 0) / third;
    const late = sorted.slice(-third).reduce((s, t) => s + t.amount, 0) / third;
    const changePercent = ((late - early) / early) * 100;
    if (changePercent < CREEP_MIN_CHANGE || daysBetween(sorted[0].date, sorted[sorted.length - 1].date) < 14) continue;

    const label = sorted[0].description
      .replace(/\b\d{4,}\w*/g, "")
      .replace(/\s*\|\s*/g, " · ")
      .replace(/(\s*·\s*)+/g, " · ")
      .replace(/^ · | · $/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    out.push({
      label: label || group[0].category,
      category: group[0].category,
      occurrences: sorted.length,
      firstDate: sorted[0].date,
      firstAmount: Math.round(early),
      lastDate: sorted[sorted.length - 1].date,
      lastAmount: Math.round(late),
      changePercent: Math.round(changePercent),
    });
  }
  return out.sort((a, b) => b.changePercent * b.occurrences - a.changePercent * a.occurrences).slice(0, 3);
}
