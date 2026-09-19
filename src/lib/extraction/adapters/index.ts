import type { BankStatementAdapter, RawRow } from "../types";
import { makeCsvAdapter } from "./genericCsv";
import { detectColumns, hasUsableColumns } from "../columnMap";
import { rowToTransaction } from "../rowToTransaction";

// Bank-specific adapters. Each is defined by the header substrings that appear in that
// institution's CSV export. Add a new bank by registering another config below — nothing
// else in the pipeline needs to change.
export const gtBankAdapter = makeCsvAdapter({
  id: "gtbank",
  name: "GTBank",
  signature: ["value date", "narration"],
});

export const accessBankAdapter = makeCsvAdapter({
  id: "access",
  name: "Access Bank",
  signature: ["trans date", "remarks"],
});

export const firstBankAdapter = makeCsvAdapter({
  id: "firstbank",
  name: "First Bank",
  signature: ["transaction date", "details"],
});

export const opayAdapter = makeCsvAdapter({
  id: "opay",
  name: "OPay",
  signature: ["date", "transaction type", "amount"],
});

export const palmPayAdapter = makeCsvAdapter({
  id: "palmpay",
  name: "PalmPay",
  signature: ["date", "description", "status"],
});

/** Last-resort adapter: runs generic column detection and accepts anything usable. */
export const genericFallbackAdapter: BankStatementAdapter = {
  id: "generic",
  name: "Generic statement",
  matches() {
    return true;
  },
  parseCsvRows(rows: RawRow[]) {
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const map = detectColumns(headers);
    const warnings: string[] = [];
    if (!hasUsableColumns(map)) {
      warnings.push("Could not confidently identify the date/amount columns in this file.");
    }
    const transactions = [];
    let skipped = 0;
    for (const row of rows) {
      const tx = rowToTransaction(row, map);
      if (tx) transactions.push(tx);
      else skipped++;
    }
    if (skipped > 0) warnings.push(`${skipped} row(s) could not be parsed and were skipped.`);
    return { transactions, warnings };
  },
};

export const CSV_ADAPTERS: BankStatementAdapter[] = [
  gtBankAdapter,
  accessBankAdapter,
  firstBankAdapter,
  opayAdapter,
  palmPayAdapter,
];

export function pickCsvAdapter(headers: string[]): BankStatementAdapter {
  return CSV_ADAPTERS.find((a) => a.matches({ headers })) ?? genericFallbackAdapter;
}
