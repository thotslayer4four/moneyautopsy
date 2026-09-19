import type { ExtractionResult } from "@/lib/types";
import { extractFromCsv } from "./csv";
import { extractFromPdf } from "./pdf";
import { validateExtraction } from "./validate";

export interface StatementFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Single entry point for turning an uploaded statement into normalized, validated
 * transactions. Everything downstream (categorization, analysis, LLM, report) only
 * ever depends on this function's output — the extraction internals can change freely.
 */
export async function extractStatement(file: StatementFile): Promise<ExtractionResult> {
  const isCsv = file.mimeType.includes("csv") || file.filename.toLowerCase().endsWith(".csv");
  const isPdf = file.mimeType.includes("pdf") || file.filename.toLowerCase().endsWith(".pdf");

  let result: ExtractionResult;

  if (isCsv) {
    result = extractFromCsv(file.buffer.toString("utf-8"));
  } else if (isPdf) {
    result = await extractFromPdf(file.buffer);
  } else {
    result = {
      transactions: [],
      sourceFormat: "csv",
      adapterUsed: "none",
      issues: [{ level: "error", message: "Unsupported file type. Please upload a PDF or CSV bank statement." }],
      needsReview: true,
    };
  }

  return validateExtraction(result);
}

export * from "./types";
