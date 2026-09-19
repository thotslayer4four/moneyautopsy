/**
 * Derives a stable-ish identity key for the counterparty of a transaction, so repeated
 * transactions to/from the same person/account can be linked even when the narration
 * wording varies slightly. Falls back to the guessed merchant name, then null.
 */
export function extractRecipientKey(rawDescription: string, merchant: string | null): string | null {
  const phone = rawDescription.match(/0\d{10}/);
  if (phone) return `phone:${phone[0]}`;

  const account = rawDescription.match(/\b\d{10}\b/);
  if (account) return `acct:${account[0]}`;

  if (merchant) return `name:${merchant.toLowerCase().trim()}`;

  return null;
}
