/** Small numeric helpers shared by the plan. Plan figures are rounded to amounts a person
 * would actually say out loud (₦100,000, not ₦99,412) — but only ever after the arithmetic. */

export const DAYS_PER_MONTH = 30;
export const WEEKS_PER_MONTH = 4.345;

export const roundTo = (value: number, step: number) => Math.round(value / step) * step;
export const floorTo = (value: number, step: number) => Math.floor(value / step) * step;

/** How coarse a rounded target should be: ₦1k steps for small amounts, ₦10k for large ones. */
export function niceStep(value: number): number {
  if (value < 20_000) return 1_000;
  if (value < 100_000) return 5_000;
  return 10_000;
}

/** A target after cutting `fraction` from `now`, rounded to a sayable amount and always
 * strictly below `now` — so a "cut" never rounds back up to where it started. */
export function niceTarget(now: number, fraction: number): number {
  const step = niceStep(now);
  const target = roundTo(now * (1 - fraction), step);
  return Math.max(0, target >= now ? floorTo(now - 1, step) : target);
}

/** A limit near what someone already does, in a sayable amount (never zero for a real amount). */
export function niceAmount(value: number): number {
  return Math.max(niceStep(value), roundTo(value, niceStep(value)));
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const cap = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** Percentages that add up to exactly 100 (largest-remainder), for parts of one whole. */
export function percentsOf(amounts: number[]): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total <= 0) return amounts.map(() => 0);
  const raw = amounts.map((a) => (a / total) * 100);
  const floors = raw.map(Math.floor);
  let leftover = 100 - floors.reduce((s, f) => s + f, 0);
  const order = raw.map((r, i) => ({ i, rem: r - floors[i] })).sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] += 1;
    leftover -= 1;
  }
  return floors;
}

/** "NETFLIX.COM SUBSCRIPTION" → "Netflix". Statement descriptors are shouty and full of noise. */
export function tidyName(raw: string): string {
  const cleaned = raw
    .replace(/\.(com|ng|co)\b/gi, "")
    .replace(/\b(subscription|payment|purchase|debit|pos|web)\b/gi, "")
    .replace(/[^A-Za-z0-9&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return raw;
  return cleaned === cleaned.toUpperCase() ? cleaned.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : cleaned;
}
