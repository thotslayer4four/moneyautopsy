import type { PaymentMethod } from "@/lib/types";

/**
 * Payment rails and processors describe HOW money moved, never what it was for. This module
 * reads them off a narration so the category logic can ignore them — "NIP TRANSFER TO ABC
 * RESTAURANT" must end up as method=nip, merchant=ABC RESTAURANT, category=Food, not as a
 * "transfer" category; and "PAYSTACK*ABC RESTAURANT" as processor=Paystack, merchant=ABC
 * RESTAURANT, never merchant=Paystack.
 */

// Order matters: the most specific / least ambiguous rail first. A narration can mention
// more than one ("POS purchase ... via NIP"), and POS/ATM say more than the generic transfer.
const METHOD_PATTERNS: { method: PaymentMethod; pattern: RegExp }[] = [
  { method: "atm", pattern: /\batm\b|cash withdrawal|cash wdl/i },
  { method: "pos", pattern: /\bpos\b/i },
  { method: "ussd", pattern: /\bussd\b|\*737\*|\*894\*|\*966\*|\*901\*|\*822\*/i },
  { method: "direct_debit", pattern: /direct debit|debit order|\bnibss direct\b/i },
  { method: "cash_deposit", pattern: /cash deposit/i },
  { method: "teller", pattern: /bank teller|\bteller\b|over the counter/i },
  { method: "web", pattern: /\bweb\b|internet banking|online banking|\bibank\b/i },
  { method: "card", pattern: /\bcard\b(?!\s*(fee|charge|maintenance|issuance|replacement|request))/i },
  { method: "nip", pattern: /\bnip\b|\bnibss\b|instant transfer|instant payment/i },
  {
    method: "transfer",
    pattern: /transfer|\btrf\b|\bft\b|interbank|intra\s?bank|credit transfer|debit transfer/i,
  },
  { method: "echannel", pattern: /e-?channel/i },
  { method: "third_party", pattern: /third party/i },
  { method: "mobile", pattern: /mobile( banking)?|\bapp\b/i },
];

export function detectPaymentMethod(raw: string): PaymentMethod | null {
  for (const { method, pattern } of METHOD_PATTERNS) {
    if (pattern.test(raw)) return method;
  }
  return null;
}

/** True when money moved by bank transfer (the mechanism), whatever it was for. */
export function isTransferRail(method: PaymentMethod | null): boolean {
  return method === "nip" || method === "transfer";
}

// Genuine payment service providers, matched anywhere in the narration.
const PROCESSOR_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "Paystack", pattern: /paystack|\bpstk\b|\bpaystk\b/i },
  { name: "Flutterwave", pattern: /flutterwave|\bflw\b/i },
  { name: "Interswitch", pattern: /interswitch|quickteller|\bisw\b/i },
  { name: "Remita", pattern: /\bremita\b|\brrr\b/i },
  { name: "Monnify", pattern: /monnify/i },
  { name: "Paga", pattern: /\bpaga\b/i },
  { name: "Nomba", pattern: /\bnomba\b/i },
];

// Wallet/MFB brands double as PSPs (Moniepoint/OPay POS terminals) but ALSO appear as the
// destination bank in ordinary transfers ("Transfer to JANE | Moniepoint | 812…"). They
// only count as a processor when the narration reads like a terminal/merchant payment.
const WALLET_PROCESSORS: { name: string; word: string }[] = [
  { name: "Moniepoint", word: "moniepoint" },
  { name: "OPay", word: "opay" },
  { name: "PalmPay", word: "palmpay" },
];

export function detectPaymentProcessor(raw: string): string | null {
  for (const { name, pattern } of PROCESSOR_PATTERNS) {
    if (pattern.test(raw)) return name;
  }
  for (const { name, word } of WALLET_PROCESSORS) {
    const terminalStyle = new RegExp(
      `(\\b(pos|web|terminal|merchant|settlement|payment|purchase)\\b[^|]*\\b${word}\\b|\\b${word}\\s*(pos|terminal|pay|merchant)\\b)`,
      "i"
    );
    if (terminalStyle.test(raw)) return name;
  }
  return null;
}

const PROCESSOR_WORDS = "paystack|pstk|paystk|flutterwave|flw|interswitch|quickteller|isw|remita|monnify|paga|nomba";
const MERCHANT_AFTER_PROCESSOR = new RegExp(
  `(?:${PROCESSOR_WORDS})\\s*[*\\-:/]+\\s*([A-Za-z0-9][A-Za-z0-9 .&'\\-]{1,40})`,
  "i"
);
const MERCHANT_VIA_PROCESSOR = new RegExp(
  `(?:via|through|using)\\s+(?:${PROCESSOR_WORDS})\\s+(?:to|for|at)\\s+([A-Za-z0-9][A-Za-z0-9 .&'\\-]{1,40})`,
  "i"
);

const RAIL_ONLY = /^(pos|web|nip|ussd|atm|card|transfer|payment|purchase|mobile|app|trf|ft|rrr|transfer to|transfer from)$/i;
const PROCESSOR_ONLY = new RegExp(`^(${PROCESSOR_WORDS})$`, "i");

/**
 * Best merchant name for a narration, given what the generic parser already guessed. The key
 * job is refusing to let a payment rail or processor become the "merchant" — otherwise every
 * Paystack payment collapses into one recipient and recipient memory would wrongly give
 * unrelated purchases the same category.
 */
export function resolveMerchant(raw: string, guessed: string | null): string | null {
  const viaProcessor = raw.match(MERCHANT_VIA_PROCESSOR) ?? raw.match(MERCHANT_AFTER_PROCESSOR);
  if (viaProcessor) {
    const candidate = viaProcessor[1]
      .replace(/\s+\d{6,}.*$/, "")
      // Trailing payment words belong to the narration, not the merchant's name.
      .replace(/\s+(order|payment|deposit|purchase|funding|top-?up|invoice|ref\w*)\b.*$/i, "")
      .replace(new RegExp(`\\s+(${PROCESSOR_WORDS})\\b.*$`, "i"), "")
      .trim();
    if (candidate.length >= 2 && !RAIL_ONLY.test(candidate) && !PROCESSOR_ONLY.test(candidate)) {
      return candidate.slice(0, 60);
    }
  }

  if (!guessed) return null;
  const cleaned = guessed.trim();
  if (RAIL_ONLY.test(cleaned) || PROCESSOR_ONLY.test(cleaned)) return null;
  return cleaned;
}
