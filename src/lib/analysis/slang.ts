/**
 * Pidgin taglines for the loud numbers. They're deterministic (a given statement always
 * gets the same line), aim their joke at the bookie / the network / the bank rather than
 * the person, and only fire when the data clears a bar — a small figure gets a calm line,
 * never a roast.
 */

export type BettingTier = "ahead" | "even" | "light" | "heavy" | "severe";
export type DataTier = "light" | "heavy" | "severe";

const BETTING_LINES: Record<BettingTier, string[]> = {
  severe: ["Sporty want wound you.", "Odds dey eat you raw.", "Bookie don dey pay rent with your money.", "Na you dey feed Sporty now."],
  heavy: ["Bookie dey collect tithe from you.", "Small small, na so dem dey take am.", "Your odds dey pursue you."],
  light: ["E never reach wound level. Watch am.", "Small play. Keep am small."],
  even: ["You and the bookie draw this one."],
  ahead: ["You beat the odds this time. Withdraw and shine your eye.", "Bookie owe you one. Collect am."],
};

const DATA_LINES: Record<DataTier, string[]> = {
  severe: ["Network don become your landlord.", "You dey buy data like say na bread."],
  heavy: ["Your data dey finish faster than fuel.", "Data no dey last for you."],
  light: ["Data dey stay small. Respect."],
};

const FEE_LINES = ["Bank dey chop small small.", "Every transfer, bank dey collect gate fee."];
const RUNWAY_LINES = ["Salary dey run like Usain Bolt.", "Money land, money don go."];

function pick(lines: string[], seed: number): string {
  return lines[Math.abs(Math.round(seed)) % lines.length];
}

export function bettingTier(params: { netResult: number; depositCount: number; base: number }): BettingTier {
  const { netResult, depositCount, base } = params;
  if (netResult > 0) return "ahead";
  const cost = -netResult;
  if (cost === 0) return "even";
  const share = base > 0 ? cost / base : 0;
  if (cost >= 100_000 || share >= 0.25) return "severe";
  if (cost >= 30_000 || share >= 0.1 || depositCount >= 20) return "heavy";
  return "light";
}

export function bettingTagline(tier: BettingTier, seed: number): string {
  return pick(BETTING_LINES[tier], seed);
}

export function dataTier(params: { total: number; count: number; base: number }): DataTier {
  const share = params.base > 0 ? params.total / params.base : 0;
  if (share >= 0.2 || params.count >= 40) return "severe";
  if (share >= 0.1 || params.count >= 20) return "heavy";
  return "light";
}

export function dataTagline(tier: DataTier, seed: number): string {
  return pick(DATA_LINES[tier], seed);
}

export const feeTagline = (seed: number) => pick(FEE_LINES, seed);
export const runwayTagline = (seed: number) => pick(RUNWAY_LINES, seed);
