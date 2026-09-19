import { randomUUID } from "crypto";
import type { ExtractionResult, NormalizedTransaction } from "@/lib/types";
import { cleanDescription, guessMerchant, isCashWithdrawalDescription, parseAmount, parseFlexibleDate, parseTimeOfDay } from "./normalize";

const DATE_SRC = "(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}|\\d{1,2}[-/][A-Za-z]{3,9}[-/]\\d{2,4}|\\d{1,2}[\\s-][A-Za-z]{3,9}[\\s-]\\d{2,4}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})";
const DATE_START = new RegExp(`^${DATE_SRC}`);
const TIME_START = /^\s*\d{1,2}:\d{2}:\d{2}/;

// Deliberately does NOT allow a bare "N"/"$" currency prefix here — those single letters
// collide with ordinary words ending in 'n' (e.g. "chicken 3,000.00"), which would eat
// part of the preceding word as if it were part of the number.
const NUMBER_SRC = "-?\\(?₦?\\s?[\\d][\\d,]*\\.\\d{2}\\)?(?:\\s?(?:DR|CR))?";

// A "cell" in a debit/credit/balance table is either a real amount or an explicit blank
// marker ("--") that some statements (OPay's in particular) print instead of just leaving
// the column empty. Capturing both lets us read direction straight off column position
// instead of guessing it from a running-balance delta — which, once wrong, throws off
// every transaction after it.
const CELL_TOKEN = new RegExp(`(${NUMBER_SRC})|(--+)`, "gi");

interface PageLine {
  text: string;
  y: number;
}

/** Groups pdf.js text items into lines using their vertical position. */
function groupIntoLines(items: { str: string; transform: number[] }[]): PageLine[] {
  const byY = new Map<number, string[]>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const y = Math.round(item.transform[5]);
    // Merge items within 2px of an existing line bucket (handles sub-pixel jitter).
    let bucket = y;
    for (const existingY of byY.keys()) {
      if (Math.abs(existingY - y) <= 2) {
        bucket = existingY;
        break;
      }
    }
    if (!byY.has(bucket)) byY.set(bucket, []);
    byY.get(bucket)!.push(item.str);
  }
  return Array.from(byY.entries())
    .sort((a, b) => b[0] - a[0]) // top of page first (higher y = higher on page)
    .map(([y, parts]) => ({ y, text: parts.join(" ") }));
}

/** Extracts raw text lines from every page of a text-based PDF. */
export async function extractPdfLines(buffer: Buffer): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;

  const lines: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageLines = groupIntoLines(
      content.items.filter((i): i is typeof i & { str: string } => "str" in i) as { str: string; transform: number[] }[]
    );
    for (const line of pageLines) lines.push(line.text);
  }
  return lines;
}

interface Cell {
  isDash: boolean;
  value: number | null;
}

interface AnchorLine {
  lineIndex: number;
  date: string;
  time: string | null;
  ownDescription: string;
  cells: Cell[];
  rawLine: string;
}

/** Strips a leading date, and — common on statements with both a timestamp and a
 * separate "value date" column — an optional following time and a second date. */
function stripLeadingDateTimeDate(line: string): { date: string; time: string | null; rest: string } | null {
  const dateMatch = line.match(DATE_START);
  if (!dateMatch) return null;
  const date = parseFlexibleDate(dateMatch[1]);
  if (!date) return null;

  let rest = line.slice(dateMatch[0].length);

  let time: string | null = null;
  const timeMatch = rest.match(TIME_START);
  if (timeMatch) {
    time = parseTimeOfDay(timeMatch[0]);
    rest = rest.slice(timeMatch[0].length);
  }

  const secondDateMatch = rest.match(new RegExp(`^\\s*${DATE_SRC}`));
  if (secondDateMatch) rest = rest.slice(secondDateMatch[0].length);

  return { date, time, rest };
}

/** A line is a transaction "anchor" if it starts with a date and contains at least one
 * amount/blank cell after that. Everything else is treated as a text fragment — usually
 * a wrapped continuation of a neighboring anchor's narration. */
function classifyAnchor(line: string, lineIndex: number): AnchorLine | null {
  const stripped = stripLeadingDateTimeDate(line);
  if (!stripped) return null;
  const { date, time, rest } = stripped;

  const cellMatches = Array.from(rest.matchAll(CELL_TOKEN));
  if (cellMatches.length === 0) return null;

  const firstCellIndex = cellMatches[0].index ?? rest.length;
  const ownDescription = cleanDescription(rest.slice(0, firstCellIndex));

  const cells: Cell[] = cellMatches.map((m) => {
    const isDash = m[2] !== undefined;
    return { isDash, value: isDash ? null : parseAmount(m[1]) };
  });

  return { lineIndex, date, time, ownDescription, cells, rawLine: line };
}

interface Resolved {
  amount: number;
  type: "income" | "expense";
  balance: number | null;
}

/** Reads direction and amount straight off column position for a 3-cell
 * [debit, credit, balance] row, using the explicit blank marker rather than a guess. */
function resolveFromCells(cells: Cell[]): Resolved | null {
  if (cells.length < 3) return null;
  const [debit, credit, bal] = cells.slice(-3);
  const balance = bal.isDash ? null : bal.value;
  const debitReal = !debit.isDash && !!debit.value && Math.abs(debit.value) > 0;
  const creditReal = !credit.isDash && !!credit.value && Math.abs(credit.value) > 0;

  if (debitReal && !creditReal) return { amount: Math.abs(debit.value!), type: "expense", balance };
  if (creditReal && !debitReal) return { amount: Math.abs(credit.value!), type: "income", balance };
  if (debitReal && creditReal) {
    // Both populated is unusual — treat the larger figure as the real movement.
    return Math.abs(debit.value!) >= Math.abs(credit.value!)
      ? { amount: Math.abs(debit.value!), type: "expense", balance }
      : { amount: Math.abs(credit.value!), type: "income", balance };
  }
  return null;
}

/** Fallback for simpler two-column [amount, balance] statements (no explicit debit/credit
 * split) — infers direction from how the running balance moved. */
function resolveFromDelta(cells: Cell[], previousBalance: number | null, description: string): Resolved | null {
  if (cells.length !== 2) return null;
  const [amt, bal] = cells;
  if (amt.isDash || amt.value === null || amt.value === 0) return null;
  const balance = bal.isDash ? null : bal.value;

  if (previousBalance !== null && balance !== null) {
    return {
      amount: Math.abs(balance - previousBalance) || Math.abs(amt.value),
      type: balance >= previousBalance ? "income" : "expense",
      balance,
    };
  }
  return {
    amount: Math.abs(amt.value),
    type: /credit|deposit|salary|inflow/i.test(description) ? "income" : "expense",
    balance,
  };
}

export function parseStatementLines(lines: string[]): { transactions: NormalizedTransaction[]; skipped: number } {
  const debug = !!process.env.DEBUG_PDF_EXTRACTION;

  // Pass 1: classify every line as a transaction anchor or a plain-text fragment.
  type Segment =
    | { kind: "anchor"; anchor: AnchorLine }
    | { kind: "fragment"; text: string };

  const segments: Segment[] = lines.map((line) => {
    const anchor = classifyAnchor(line, 0);
    return anchor ? { kind: "anchor" as const, anchor } : { kind: "fragment" as const, text: cleanDescription(line) };
  });
  // Re-assign line indices now that we know the real order (classifyAnchor above was
  // called with a placeholder index).
  let idx = 0;
  for (const s of segments) if (s.kind === "anchor") s.anchor.lineIndex = idx++;

  // Pass 2: attach fragment runs to whichever neighboring anchor is missing a
  // description, splitting a run between both neighbors when they both need one.
  // This recovers narrations that wrap onto their own line(s) around a transaction's
  // numeric row rather than sitting inline with it.
  const descriptionParts = new Map<number, { head: string[]; tail: string[] }>();
  for (const s of segments) if (s.kind === "anchor") descriptionParts.set(s.anchor.lineIndex, { head: [], tail: [] });

  let prevAnchor: AnchorLine | null = null;
  for (let i = 0; i < segments.length; ) {
    const seg = segments[i];
    if (seg.kind === "anchor") {
      prevAnchor = seg.anchor;
      i++;
      continue;
    }

    const run: string[] = [];
    while (i < segments.length && segments[i].kind === "fragment") {
      const text = (segments[i] as Extract<Segment, { kind: "fragment" }>).text;
      if (text) run.push(text);
      i++;
    }
    const nextAnchor = i < segments.length ? (segments[i] as Extract<Segment, { kind: "anchor" }>).anchor : null;
    if (run.length === 0) continue;

    const prevNeedsIt = !!prevAnchor && !prevAnchor.ownDescription;
    const nextNeedsIt = !!nextAnchor && !nextAnchor.ownDescription;

    if (prevNeedsIt && nextNeedsIt) {
      const splitPoint = Math.ceil(run.length / 2);
      descriptionParts.get(prevAnchor!.lineIndex)!.tail.push(...run.slice(0, splitPoint));
      descriptionParts.get(nextAnchor!.lineIndex)!.head.push(...run.slice(splitPoint));
    } else if (prevNeedsIt) {
      descriptionParts.get(prevAnchor!.lineIndex)!.tail.push(...run);
    } else if (nextNeedsIt) {
      descriptionParts.get(nextAnchor!.lineIndex)!.head.push(...run);
    }
    // Otherwise this run has no needy neighbor — it's dropped as unattributable noise.
  }

  // Pass 3: resolve each anchor's amount/direction/balance and build the transaction.
  const transactions: NormalizedTransaction[] = [];
  let previousBalance: number | null = null;
  let skipped = 0;
  let debugCount = 0;

  for (const s of segments) {
    if (s.kind !== "anchor") continue;
    const a = s.anchor;
    const parts = descriptionParts.get(a.lineIndex)!;
    const fullDescription =
      cleanDescription([...parts.head, a.ownDescription, ...parts.tail].filter(Boolean).join(" ")) || "(no description)";

    const resolved: Resolved | null = resolveFromCells(a.cells) ?? resolveFromDelta(a.cells, previousBalance, fullDescription);

    if (!resolved || resolved.amount === 0) {
      skipped++;
      if (debug) console.log(`[skipped] line="${a.rawLine}" cells=${JSON.stringify(a.cells)}`);
      continue;
    }
    if (resolved.balance !== null) previousBalance = resolved.balance;

    let type: NormalizedTransaction["type"] = resolved.type;
    if (/transfer|trf|nip/i.test(fullDescription) && type === "expense") type = "transfer";
    if (isCashWithdrawalDescription(fullDescription) && type === "expense") type = "withdrawal";

    const tx: NormalizedTransaction = {
      id: randomUUID(),
      date: a.date,
      time: a.time,
      direction: resolved.type === "income" ? "in" : "out",
      description: fullDescription,
      rawDescription: [...parts.head, a.rawLine, ...parts.tail].join(" | "),
      amount: resolved.amount,
      type,
      balance: resolved.balance,
      merchant: guessMerchant(fullDescription),
      paymentMethod: null,
      paymentProcessor: null,
      category: "Uncertain",
      categoryConfidence: 0,
      categoryReason: "not yet categorized",
    };
    transactions.push(tx);

    if (debug) {
      debugCount++;
      console.log(`[parsed ${debugCount}] date=${tx.date} amount=${tx.amount} type=${tx.type} balance=${tx.balance} desc="${tx.description}"`);
    }
  }

  return { transactions, skipped };
}

// Some statements (OPay's in particular) concatenate multiple account sections into one
// PDF — e.g. a main "Wallet Account" followed by a "Savings Account"/OWealth pocket, each
// with its own "Debit Count / Total Debit / Opening Balance" summary table. The second
// account's entries are usually just the other side of the same internal transfers the
// first account already recorded (money moving into/out of the pocket), so including both
// double-counts every one of those movements. We keep only the first account section.
const ACCOUNT_SECTION_HEADER = /debit count.*total debit.*opening balance/i;

function isolatePrimaryAccountSection(lines: string[]): { lines: string[]; truncated: boolean } {
  const sectionStarts = lines.reduce<number[]>((acc, line, i) => {
    if (ACCOUNT_SECTION_HEADER.test(line)) acc.push(i);
    return acc;
  }, []);
  if (sectionStarts.length < 2) return { lines, truncated: false };
  return { lines: lines.slice(0, sectionStarts[1]), truncated: true };
}

// Looks for a header line naming the "Account Name" column, then reads the name off the
// line right after it (statements typically print "<account number> <ACCOUNT HOLDER NAME>"
// there). Knowing this lets categorization recognize transfers to/from the person's own
// name — self-transfers between their own accounts — instead of leaving them Uncertain.
const ACCOUNT_NAME_HEADER = /account\s*name/i;

function extractAccountHolderName(lines: string[]): string | null {
  const headerIndex = lines.findIndex((l) => ACCOUNT_NAME_HEADER.test(l));
  if (headerIndex === -1 || headerIndex + 1 >= lines.length) return null;

  const candidate = lines[headerIndex + 1];
  // Strip a leading account/phone number, keeping just the name portion.
  const nameOnly = candidate.replace(/^\d{6,}\s+/, "").trim();
  // A plausible person/business name: mostly letters and spaces, 2+ words, not too long.
  if (/^[A-Za-z][A-Za-z .'-]{3,60}$/.test(nameOnly) && nameOnly.split(/\s+/).length >= 2) {
    return nameOnly;
  }
  return null;
}

export async function extractFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  const issues: ExtractionResult["issues"] = [];
  let lines: string[] = [];

  try {
    lines = await extractPdfLines(buffer);
  } catch (err) {
    console.error("PDF text extraction failed:", err);
    const name = err instanceof Error ? err.name : "";
    const message =
      name === "PasswordException"
        ? "This PDF is password-protected. Remove the password (most PDF/bank apps let you export or print-to-PDF an unlocked copy) and upload it again, or upload a CSV instead."
        : name === "InvalidPDFException"
          ? "This file doesn't look like a valid PDF. Please check the file and try again."
          : "Could not read this PDF. It may be a scanned image rather than a text-based statement.";
    return {
      transactions: [],
      sourceFormat: "pdf",
      adapterUsed: "pdf-text-generic",
      issues: [{ level: "error", message }],
      needsReview: true,
    };
  }

  if (process.env.DEBUG_PDF_EXTRACTION) {
    console.log(`\n--- DEBUG_PDF_EXTRACTION: ${lines.length} raw line(s) grouped from PDF ---`);
    lines.slice(0, 60).forEach((line, i) => console.log(`[${i}] ${line}`));
    console.log("--- end raw lines ---\n");
  }

  if (lines.length === 0) {
    return {
      transactions: [],
      sourceFormat: "pdf",
      adapterUsed: "pdf-text-generic",
      issues: [{
        level: "error",
        message: "No extractable text found in this PDF — it may be a scanned image.",
      }],
      needsReview: true,
    };
  }

  const { lines: primaryLines, truncated } = isolatePrimaryAccountSection(lines);
  if (truncated) {
    issues.push({
      level: "info",
      message: "This statement includes more than one account section (e.g. a main wallet and a separate savings pocket). Only the first account was analyzed, since the others are usually just the other side of the same internal transfers and would double-count them.",
    });
  }

  const accountHolderName = extractAccountHolderName(lines);

  const { transactions, skipped } = parseStatementLines(primaryLines);

  if (skipped > 0) {
    issues.push({ level: "warning", message: `${skipped} line(s) looked like transactions but could not be parsed.` });
  }
  if (transactions.length === 0) {
    issues.push({ level: "error", message: "No transactions could be extracted from this PDF." });
  }

  return {
    transactions,
    sourceFormat: "pdf",
    adapterUsed: "pdf-text-generic",
    issues,
    needsReview: transactions.length === 0,
    accountHolderName,
  };
}
