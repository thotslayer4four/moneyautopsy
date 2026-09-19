import { randomUUID } from "crypto";
import type { NormalizedTransaction } from "@/lib/types";
import type { ColumnMap } from "./columnMap";
import type { RawRow } from "./types";
import { cleanDescription, guessMerchant, isCashWithdrawalDescription, parseAmount, parseFlexibleDate, parseTimeOfDay } from "./normalize";

/**
 * Converts one raw CSV row into a normalized transaction using a detected column map.
 * Returns null if the row is unparseable (missing date/amount) so callers can flag it
 * rather than silently fabricating a transaction.
 */
export function rowToTransaction(row: RawRow, map: ColumnMap): NormalizedTransaction | null {
  const dateRaw = map.date ? row[map.date] : "";
  const date = parseFlexibleDate(dateRaw ?? "");
  if (!date) return null;

  const rawDescription = map.description ? (row[map.description] ?? "") : "";
  const description = cleanDescription(rawDescription) || "(no description)";

  let amount: number | null = null;
  let type: NormalizedTransaction["type"] = "unknown";

  if (map.debit && row[map.debit] && parseAmount(row[map.debit]) !== null && parseAmount(row[map.debit]) !== 0) {
    amount = Math.abs(parseAmount(row[map.debit])!);
    type = "expense";
  } else if (map.credit && row[map.credit] && parseAmount(row[map.credit]) !== null && parseAmount(row[map.credit]) !== 0) {
    amount = Math.abs(parseAmount(row[map.credit])!);
    type = "income";
  } else if (map.amount && row[map.amount]) {
    const parsed = parseAmount(row[map.amount]);
    if (parsed !== null) {
      amount = Math.abs(parsed);
      const indicator = map.typeIndicator ? row[map.typeIndicator] : "";
      if (/^cr/i.test(indicator ?? "") || parsed > 0) type = "income";
      else type = "expense";
    }
  }

  if (amount === null || Number.isNaN(amount)) return null;

  const balanceRaw = map.balance ? row[map.balance] : null;
  const balance = balanceRaw ? parseAmount(balanceRaw) : null;

  if (/transfer|trf|nip/i.test(description) && type === "expense") type = "transfer";
  if (isCashWithdrawalDescription(description) && type === "expense") type = "withdrawal";

  return {
    id: randomUUID(),
    date,
    time: parseTimeOfDay(dateRaw ?? ""),
    direction: type === "income" ? "in" : "out",
    description,
    rawDescription: rawDescription || description,
    amount,
    type,
    balance,
    merchant: guessMerchant(rawDescription || description),
    paymentMethod: null,
    paymentProcessor: null,
    category: "Uncertain",
    categoryConfidence: 0,
    categoryReason: "not yet categorized",
  };
}
