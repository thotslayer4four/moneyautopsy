import type { NormalizedTransaction } from "@/lib/types";

/** A single row of raw, loosely-typed data pulled out of a statement before normalization. */
export interface RawRow {
  [column: string]: string;
}

export interface AdapterResult {
  transactions: NormalizedTransaction[];
  warnings: string[];
}

/**
 * A BankStatementAdapter knows how to turn the rows of a specific bank/fintech's
 * statement export into normalized transactions. New banks are added by writing a
 * new adapter and registering it — the rest of the pipeline never changes.
 */
export interface BankStatementAdapter {
  id: string;
  name: string;
  /** Cheap heuristic check: does this adapter look like it can handle these rows/text? */
  matches(input: { headers?: string[]; sampleText?: string }): boolean;
  parseCsvRows(rows: RawRow[]): AdapterResult;
}

export interface PdfTextAdapter {
  id: string;
  name: string;
  matches(sampleText: string): boolean;
  parseText(text: string): AdapterResult;
}
