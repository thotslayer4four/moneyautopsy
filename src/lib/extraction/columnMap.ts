import { parseAmount, parseFlexibleDate } from "./normalize";
import type { RawRow } from "./types";

export interface ColumnMap {
  date: string | null;
  description: string | null;
  debit: string | null;
  credit: string | null;
  amount: string | null;
  balance: string | null;
  typeIndicator: string | null;
}

const ALIASES: Record<keyof ColumnMap, string[]> = {
  date: ["date", "transaction date", "trans date", "value date", "posted date", "txn date"],
  description: [
    "narration", "description", "remarks", "details", "transaction details",
    "particulars", "memo", "transaction remarks", "narrative",
  ],
  debit: ["debit", "withdrawal", "debit amount", "money out", "amount debited", "withdrawals"],
  credit: ["credit", "deposit", "credit amount", "money in", "amount credited", "deposits"],
  amount: ["amount", "transaction amount", "value"],
  balance: ["balance", "running balance", "closing balance", "available balance"],
  typeIndicator: ["type", "dr/cr", "indicator", "cr/dr", "transaction type"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function byAliases(headers: string[]): Partial<ColumnMap> {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  const map: Partial<ColumnMap> = {};
  for (const field of Object.keys(ALIASES) as (keyof ColumnMap)[]) {
    const aliases = ALIASES[field];
    // exact match first
    let found = normalized.find((h) => aliases.includes(h.norm));
    // then "contains" match (e.g. "transaction narration")
    if (!found) {
      found = normalized.find((h) => aliases.some((a) => h.norm.includes(a)));
    }
    map[field] = found ? found.raw : null;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Content sniffing — a fallback for statements whose headers aren't in ALIASES at all
// (unfamiliar banks, headers stripped to codes, etc.). Only ever fills a gap the header
// pass left open; a header match always wins. Capped to a sample so a huge CSV stays fast.
// ---------------------------------------------------------------------------

const SAMPLE_SIZE = 40;
const MIN_FIELD_SCORE = 0.7; // share of sampled values that must fit the shape we're guessing
const MIN_FILL_RATE = 0.5; // share of sampled rows that must have a value at all
const SPARSE_FILL_MAX = 0.95; // a debit/credit column is rarely filled on every row
const MIN_DESCRIPTION_LENGTH = 8; // narrations read long; codes and amounts don't

function sample<T>(rows: T[], n: number): T[] {
  return rows.length <= n ? rows : rows.slice(0, n);
}

/** Share of non-empty sampled values in `col` for which `test` holds. Null fill rate means
 * the column was empty for every sampled row, so it can't be scored either way. */
function scoreColumn(rows: RawRow[], col: string, test: (value: string) => boolean): { fillRate: number; hitRate: number } {
  const values = rows.map((r) => String(r[col] ?? "").trim()).filter((v) => v !== "");
  const fillRate = rows.length > 0 ? values.length / rows.length : 0;
  const hits = values.filter(test).length;
  return { fillRate, hitRate: values.length > 0 ? hits / values.length : 0 };
}

const looksNumeric = (v: string) => parseAmount(v) !== null;
const looksLikeDate = (v: string) => parseFlexibleDate(v) !== null;

/**
 * Fills whatever the header pass couldn't find, by looking at what the columns actually
 * contain: the column that parses as a date most consistently, the numeric column(s) that
 * best fit a single signed amount vs. a separate debit/credit split, and — among what's
 * left — the longest, least numeric text as the narration. Never overrides a header match,
 * and never claims a column for two fields.
 */
function byContent(headers: string[], rows: RawRow[], partial: Partial<ColumnMap>): { map: Partial<ColumnMap>; sniffed: (keyof ColumnMap)[] } {
  const sniffed: (keyof ColumnMap)[] = [];
  const map = { ...partial };
  const sampled = sample(
    rows.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== "")),
    SAMPLE_SIZE
  );
  if (sampled.length === 0) return { map, sniffed: [] };

  const claimed = new Set(Object.values(map).filter((v): v is string => !!v));
  const available = () => headers.filter((h) => !claimed.has(h));
  const claim = (field: keyof ColumnMap, header: string) => {
    map[field] = header;
    claimed.add(header);
    sniffed.push(field);
  };

  if (!map.date) {
    const best = available()
      .map((h) => ({ h, ...scoreColumn(sampled, h, looksLikeDate) }))
      .filter((c) => c.fillRate >= MIN_FILL_RATE && c.hitRate >= MIN_FIELD_SCORE)
      .sort((a, b) => b.hitRate - a.hitRate)[0];
    if (best) claim("date", best.h);
  }

  if (!map.amount && !map.debit && !map.credit) {
    const numeric = available()
      .map((h) => ({ h, ...scoreColumn(sampled, h, looksNumeric) }))
      .filter((c) => c.hitRate >= MIN_FIELD_SCORE)
      .sort((a, b) => b.fillRate - a.fillRate);

    // Two numeric columns that are each filled on only some rows look like a debit/credit
    // split (one or the other is blank per row). A single, almost-always-filled numeric
    // column is one signed amount. Order follows the near-universal debit-then-credit
    // convention when we have nothing else to go on — it's a guess, which is why it's flagged.
    const sparse = numeric.filter((c) => c.fillRate < SPARSE_FILL_MAX);
    if (sparse.length >= 2) {
      claim("debit", sparse[0].h);
      claim("credit", sparse[1].h);
    } else if (numeric.length > 0) {
      claim("amount", numeric[0].h);
    }
  }

  if (!map.description) {
    const amountish = new Set([map.amount, map.debit, map.credit, map.balance].filter((v): v is string => !!v));
    const best = available()
      .filter((h) => !amountish.has(h))
      .map((h) => {
        const values = sampled.map((r) => String(r[h] ?? "").trim()).filter((v) => v !== "");
        const avgLength = values.length > 0 ? values.reduce((s, v) => s + v.length, 0) / values.length : 0;
        const numericShare = values.length > 0 ? values.filter(looksNumeric).length / values.length : 1;
        return { h, avgLength, numericShare, fillRate: values.length / sampled.length };
      })
      .filter((c) => c.fillRate >= MIN_FILL_RATE && c.avgLength >= MIN_DESCRIPTION_LENGTH && c.numericShare < 0.5)
      .sort((a, b) => b.avgLength - a.avgLength)[0];
    if (best) claim("description", best.h);
  }

  if (!map.balance) {
    const best = available()
      .map((h) => ({ h, ...scoreColumn(sampled, h, looksNumeric) }))
      .filter((c) => c.fillRate >= MIN_FIELD_SCORE && c.hitRate >= MIN_FIELD_SCORE)
      .sort((a, b) => b.fillRate - a.fillRate)[0];
    if (best) claim("balance", best.h);
  }

  return { map, sniffed };
}

/**
 * Detects which raw header corresponds to each canonical field, by name first. When `rows`
 * are given and the name-based match alone isn't enough to parse the statement, falls back
 * to guessing the remaining fields from what the columns actually contain — an unfamiliar
 * bank's export is still worth a try rather than an automatic "needs review". Which fields
 * (if any) were guessed this way is returned alongside the map, so callers can say so.
 */
export function detectColumns(headers: string[], rows: RawRow[] = []): { map: ColumnMap; sniffed: (keyof ColumnMap)[] } {
  const byName = byAliases(headers);
  if (hasUsableColumns(byName as ColumnMap) || rows.length === 0) {
    return { map: byName as ColumnMap, sniffed: [] };
  }
  const { map, sniffed } = byContent(headers, rows, byName);
  return { map: map as ColumnMap, sniffed };
}

export function hasUsableColumns(map: ColumnMap): boolean {
  const hasDate = !!map.date;
  const hasDescription = !!map.description;
  const hasAmount = !!(map.amount || map.debit || map.credit);
  return hasDate && hasDescription && hasAmount;
}
