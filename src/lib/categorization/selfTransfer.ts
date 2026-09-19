/**
 * Detects transfers to/from the statement's own account holder — money moving between
 * the person's own accounts (main wallet <-> savings pocket, different bank, etc.) rather
 * than to someone else. Nigerian statements often reorder name parts inconsistently
 * ("FWANGSHAK JARED EMMANUEL" vs "EMMANUEL FWANGSHAK JARED"), so this compares by word
 * overlap rather than exact string equality.
 */
export function isSelfTransfer(description: string, accountHolderName: string | null | undefined): boolean {
  if (!accountHolderName) return false;

  const ownWords = accountHolderName
    .toUpperCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (ownWords.length < 2) return false;

  const descUpper = description.toUpperCase();
  const matchedWords = ownWords.filter((w) => descUpper.includes(w));

  // Require most of the name to appear — a single shared word (e.g. a common first name)
  // isn't enough to call it a self-transfer.
  return matchedWords.length >= Math.min(2, ownWords.length) && matchedWords.length / ownWords.length >= 0.66;
}
