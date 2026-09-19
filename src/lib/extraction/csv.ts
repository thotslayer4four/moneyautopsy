import Papa from "papaparse";
import type { ExtractionResult } from "@/lib/types";
import { pickCsvAdapter } from "./adapters";
import type { RawRow } from "./types";

export function extractFromCsv(fileText: string): ExtractionResult {
  const parsed = Papa.parse<RawRow>(fileText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const rows = parsed.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim() !== ""));
  const headers = parsed.meta.fields ?? [];
  const adapter = pickCsvAdapter(headers);
  const { transactions, warnings } = adapter.parseCsvRows(rows);

  const issues: ExtractionResult["issues"] = warnings.map((w) => ({ level: "warning", message: w }));
  if (parsed.errors.length > 0) {
    issues.push({
      level: "warning",
      message: `CSV parser reported ${parsed.errors.length} row-level issue(s).`,
    });
  }
  if (transactions.length === 0) {
    issues.push({ level: "error", message: "No transactions could be extracted from this CSV." });
  }

  return {
    transactions,
    sourceFormat: "csv",
    adapterUsed: adapter.id,
    issues,
    needsReview: transactions.length === 0,
  };
}
