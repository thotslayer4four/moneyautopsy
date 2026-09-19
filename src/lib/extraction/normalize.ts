/** Shared low-level parsing helpers used by every adapter. Kept dependency-free and pure. */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parses a wide variety of date formats seen on Nigerian bank statements into ISO (YYYY-MM-DD). */
export function parseFlexibleDate(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // 2024-03-14 or 2024/03/14
  let m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return toIso(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // 14-Mar-2024 / 14 Mar 2024 / 14-Mar-24
  m = raw.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-](\d{2,4})/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) return toIso(normalizeYear(m[3]), mon, Number(m[1]));
  }

  // Mar 14, 2024 / March 14 2024
  m = raw.match(/^([A-Za-z]{3,})[\s.]+(\d{1,2}),?\s+(\d{2,4})/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon !== undefined) return toIso(normalizeYear(m[3]), mon, Number(m[2]));
  }

  // 14/03/2024 or 03/14/2024 — default to DD/MM/YYYY, the dominant Nigerian statement convention.
  m = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = normalizeYear(m[3]);
    return toIso(year, month - 1, day);
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) {
    return toIso(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  }
  return null;
}

/** Pulls a time of day (as 24h "HH:MM") out of a date/time cell or line, when there is one. */
export function parseTimeOfDay(input: string): string | null {
  const m = input.match(/(?:^|[\sT])(\d{1,2}):(\d{2})(?::\d{2})?\s?(AM|PM)?\b/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeYear(y: string): number {
  const n = Number(y);
  if (n < 100) return n + 2000;
  return n;
}

function toIso(year: number, monthIndex: number, day: number): string | null {
  if (
    Number.isNaN(year) || Number.isNaN(monthIndex) || Number.isNaN(day) ||
    monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31
  ) {
    return null;
  }
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Parses a monetary string into a signed number. Handles ₦/NGN prefixes, thousands
 * separators, trailing/leading Dr/Cr markers and parenthesized negatives.
 * Returns null if the string has no discernible numeric value.
 */
export function parseAmount(input: string): number | null {
  if (input === null || input === undefined) return null;
  let raw = String(input).trim();
  if (!raw) return null;

  let sign = 1;
  if (/^\(.*\)$/.test(raw)) {
    sign = -1;
    raw = raw.slice(1, -1);
  }
  if (/\bDR\b/i.test(raw) || raw.trim().toUpperCase().endsWith("DR")) sign = -1;
  if (/\bCR\b/i.test(raw) || raw.trim().toUpperCase().endsWith("CR")) sign = sign === -1 ? sign : 1;
  if (raw.trim().startsWith("-")) sign = -1;

  const numeric = raw.replace(/[^0-9.]/g, "");
  if (!numeric) return null;
  const value = parseFloat(numeric);
  if (Number.isNaN(value)) return null;
  return value * sign;
}

/** Strips repeated whitespace/newlines and common bank boilerplate tokens from a narration. */
export function cleanDescription(input: string): string {
  return input
    .replace(/\s+/g, " ")
    .replace(/^-+|-+$/g, "")
    .trim();
}

const TRANSFER_NAME_PATTERNS = [
  /(?:transfer|trf)\s*(?:to|from)\s*[:\-]?\s*([A-Za-z0-9 .'\-]{2,40})/i,
  /(?:nip|neft)\s*[:\-]?\s*([A-Za-z0-9 .'\-]{2,40})/i,
];

/** Best-effort guess at the counterparty name embedded in a raw narration. */
export function guessMerchant(rawDescription: string): string | null {
  for (const pattern of TRANSFER_NAME_PATTERNS) {
    const m = rawDescription.match(pattern);
    if (m) return cleanDescription(m[1]).slice(0, 60);
  }
  // POS / card purchases often read "POS PURCHASE AT <merchant> ..."
  const posMatch = rawDescription.match(/(?:POS|CARD)\s*(?:PURCHASE)?\s*(?:AT|-)?\s*([A-Za-z0-9 .'\-]{2,40})/i);
  if (posMatch) return cleanDescription(posMatch[1]).slice(0, 60);
  return null;
}

/** Given description text, infer whether the entry represents a bank fee/charge line. */
export function isBankChargeDescription(desc: string): boolean {
  return /(charge|fee|vat|stamp duty|maintenance|sms alert|commission|levy)/i.test(desc);
}

export function isCashWithdrawalDescription(desc: string): boolean {
  // \b around "atm" matters: without it, this matches inside ordinary names/words that
  // happen to contain the substring "atm" (e.g. a recipient surname like "KATMAK").
  if (/(\batm\b|cash withdrawal|cash wdl)/i.test(desc)) return true;
  // A bare "withdrawal at …" counts, but a POS payment never does: POS says how a payment
  // was made, not that cash changed hands, so it must not be inferred as a cash-out.
  return /withdrawal at/i.test(desc) && !/\bpos\b/i.test(desc);
}
