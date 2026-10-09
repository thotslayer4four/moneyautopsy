import type { BankStatementAdapter, RawRow } from "../types";
import { detectColumns, hasUsableColumns } from "../columnMap";
import { rowToTransaction } from "../rowToTransaction";

/**
 * Factory for a bank-specific CSV adapter. Most Nigerian bank/fintech CSV exports differ
 * only in header naming and a few quirks, so specific banks are defined by header
 * signatures rather than bespoke parsers. Add a new bank by adding a new config here.
 */
export function makeCsvAdapter(config: {
  id: string;
  name: string;
  /** Header substrings that, if seen together, strongly indicate this bank's export. */
  signature: string[];
}): BankStatementAdapter {
  return {
    id: config.id,
    name: config.name,
    matches({ headers }) {
      if (!headers || headers.length === 0) return false;
      const normalized = headers.map((h) => h.trim().toLowerCase());
      return config.signature.every((sig) =>
        normalized.some((h) => h.includes(sig))
      );
    },
    parseCsvRows(rows: RawRow[]) {
      const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
      const { map, sniffed } = detectColumns(headers, rows);
      const warnings: string[] = [];
      if (!hasUsableColumns(map)) {
        warnings.push(`${config.name} adapter could not confidently identify date/amount columns.`);
      } else if (sniffed.length > 0) {
        warnings.push(`${config.name} adapter guessed the ${sniffed.join("/")} column(s) from their contents, not their header — worth a glance.`);
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
}
