export function formatNaira(amount: number): string {
  const rounded = Math.round(amount);
  return `₦${rounded.toLocaleString("en-NG")}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "food / eating out" → "Food / eating out"; standalone "i" → "I". Stored labels stay
 * lowercase (they're data, and read naturally mid-sentence); UI capitalizes at render. */
export function sentenceCase(text: string): string {
  if (!text) return text;
  return (text.charAt(0).toUpperCase() + text.slice(1)).replace(/\bi\b/g, "I");
}
