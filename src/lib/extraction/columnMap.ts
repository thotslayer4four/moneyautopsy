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

/** Best-effort detection of which raw CSV header corresponds to each canonical field. */
export function detectColumns(headers: string[]): ColumnMap {
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

  return map as ColumnMap;
}

export function hasUsableColumns(map: ColumnMap): boolean {
  const hasDate = !!map.date;
  const hasDescription = !!map.description;
  const hasAmount = !!(map.amount || map.debit || map.credit);
  return hasDate && hasDescription && hasAmount;
}
