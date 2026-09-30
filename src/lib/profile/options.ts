/**
 * Single source of truth for every About You answer: the value stored, the label shown in
 * onboarding, and (through the derived types) what the server-side schema accepts. The LLM
 * layer reads labels from here too, so it sees "student accommodation", never a raw enum id.
 */

export const GENDER_OPTIONS = [
  { value: "male", label: "male" },
  { value: "female", label: "female" },
] as const;

export const AGE_OPTIONS = [
  { value: "under_18", label: "under 18" },
  { value: "18_21", label: "18–21" },
  { value: "22_25", label: "22–25" },
  { value: "26_30", label: "26–30" },
  { value: "31_40", label: "31–40" },
  { value: "41_plus", label: "41+" },
] as const;

export const SITUATION_OPTIONS = [
  { value: "student", label: "student" },
  { value: "employed", label: "employed" },
  { value: "self_employed", label: "self-employed" },
  { value: "business_owner", label: "business owner" },
  { value: "unemployed", label: "unemployed" },
  { value: "between_jobs", label: "between jobs" },
  { value: "other", label: "other" },
] as const;

export const LIVING_OPTIONS = [
  { value: "family", label: "with parents / family" },
  { value: "alone", label: "alone" },
  { value: "partner", label: "with partner" },
  { value: "roommates", label: "with roommates" },
  { value: "student_accommodation", label: "student accommodation" },
  { value: "other", label: "other" },
] as const;

export const INCOME_SOURCE_OPTIONS = [
  { value: "salary", label: "salary" },
  { value: "allowance", label: "allowance" },
  { value: "freelance", label: "freelance work" },
  { value: "business", label: "business" },
  { value: "side_hustle", label: "side hustles" },
  { value: "family_support", label: "family support" },
  { value: "gifts_support", label: "gifts / support" },
  { value: "commissions", label: "commissions" },
  { value: "investment", label: "investment income" },
  { value: "rental", label: "rental / property income" },
  { value: "other", label: "other" },
] as const;

export const MONTHLY_INCOME_OPTIONS = [
  { value: "0_50k", label: "₦0–₦50k" },
  { value: "50k_100k", label: "₦50k–₦100k" },
  { value: "100k_250k", label: "₦100k–₦250k" },
  { value: "250k_500k", label: "₦250k–₦500k" },
  { value: "500k_1m", label: "₦500k–₦1m" },
  { value: "1m_2m", label: "₦1m–₦2m" },
  { value: "2m_plus", label: "₦2m+" },
] as const;

export const GOAL_OPTIONS = [
  { value: "save_more", label: "save more" },
  { value: "stop_overspending", label: "stop overspending" },
  { value: "emergency_fund", label: "build emergency savings" },
  { value: "invest", label: "invest" },
  { value: "pay_off_debt", label: "pay off debt" },
  { value: "buy_something", label: "buy something specific" },
  { value: "grow_business", label: "start / grow a business" },
  { value: "travel", label: "travel" },
  { value: "understand_spending", label: "understand where my money goes" },
  { value: "other", label: "other" },
] as const;

export const EXPENSE_COVERED_OPTIONS = [
  { value: "rent", label: "rent" },
  { value: "electricity", label: "electricity" },
  { value: "internet_data", label: "internet / data" },
  { value: "tv_streaming", label: "TV / streaming" },
  { value: "groceries", label: "groceries" },
  { value: "transportation", label: "transportation" },
  { value: "school", label: "school / education" },
  { value: "family_expenses", label: "family expenses / support" },
  { value: "children", label: "children" },
  { value: "other", label: "other" },
  { value: "none", label: "none of these" },
] as const;

export const SUPPORT_OPTIONS = [
  { value: "parents_family", label: "parents / family" },
  { value: "partner", label: "partner" },
  { value: "children", label: "children" },
  { value: "friends", label: "friends" },
  { value: "employees", label: "employees / staff" },
  { value: "other", label: "other" },
  { value: "no_one", label: "no one" },
] as const;

export const FREQUENCY_OPTIONS = [
  { value: "never", label: "never" },
  { value: "sometimes", label: "sometimes" },
  { value: "often", label: "often" },
] as const;

export const LOAN_AMOUNT_OPTIONS = [
  { value: "under_10k", label: "under ₦10k" },
  { value: "10k_50k", label: "₦10k–₦50k" },
  { value: "50k_100k", label: "₦50k–₦100k" },
  { value: "100k_250k", label: "₦100k–₦250k" },
  { value: "250k_500k", label: "₦250k–₦500k" },
  { value: "500k_plus", label: "₦500k+" },
] as const;

export const YES_NO_OPTIONS = [
  { value: "yes", label: "yes" },
  { value: "no", label: "no" },
] as const;

export const CASH_AMOUNT_OPTIONS = [
  { value: "1k_5k", label: "₦1k–₦5k" },
  { value: "5k_10k", label: "₦5k–₦10k" },
  { value: "10k_25k", label: "₦10k–₦25k" },
  { value: "25k_50k", label: "₦25k–₦50k" },
  { value: "50k_100k", label: "₦50k–₦100k" },
  { value: "100k_plus", label: "₦100k+" },
] as const;

export const PERCEIVED_SPEND_OPTIONS = [
  { value: "food", label: "food / eating out" },
  { value: "data_airtime", label: "data / airtime" },
  { value: "transport", label: "transportation" },
  { value: "shopping", label: "shopping" },
  { value: "betting", label: "betting" },
  { value: "entertainment", label: "entertainment / subscriptions" },
  { value: "helping_others", label: "helping other people" },
  { value: "nightlife", label: "nightlife" },
  { value: "online_purchases", label: "online purchases" },
  { value: "other", label: "something else" },
  { value: "dont_know", label: "honestly, i don't know" },
] as const;

// ---- Money Plan: what a statement can't show about timing and obligations ----

export const RENT_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "monthly" },
  { value: "quarterly", label: "every 3 months" },
  { value: "biannual", label: "every 6 months" },
  { value: "yearly", label: "yearly" },
  { value: "other", label: "other" },
] as const;

export const SCHOOL_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "monthly" },
  { value: "semester", label: "every semester" },
  { value: "yearly", label: "yearly" },
  { value: "other", label: "other" },
] as const;

/** Months between payments. "other" has no fixed cadence, so it can't be spread honestly. */
export const MONTHS_BETWEEN: Record<string, number | null> = {
  monthly: 1,
  quarterly: 3,
  biannual: 6,
  semester: 6,
  yearly: 12,
  other: null,
};

export const DEBT_PAYOFF_OPTIONS = [
  { value: "under_3m", label: "within 3 months" },
  { value: "3_6m", label: "3–6 months" },
  { value: "6_12m", label: "6–12 months" },
  { value: "over_1y", label: "more than a year" },
  { value: "not_sure", label: "not sure" },
] as const;

export const INCOME_TIMING_OPTIONS = [
  { value: "monthly", label: "once a month" },
  { value: "weekly", label: "every week" },
  { value: "several", label: "several times a month" },
  { value: "irregular", label: "irregularly" },
] as const;

export const SAVINGS_PREFERENCE_OPTIONS = [
  { value: "5", label: "5%" },
  { value: "10", label: "10%" },
  { value: "20", label: "20%" },
  { value: "30", label: "30% or more" },
  { value: "dont_know", label: "i don't know" },
] as const;

export const REDUCE_AREA_OPTIONS = [
  { value: "food", label: "food / eating out" },
  { value: "shopping", label: "shopping" },
  { value: "transport", label: "transportation" },
  { value: "data_airtime", label: "data / airtime" },
  { value: "subscriptions", label: "subscriptions" },
  { value: "cash", label: "cash withdrawals" },
  { value: "betting", label: "betting" },
  { value: "helping_others", label: "helping other people" },
  { value: "none", label: "none of these" },
  { value: "not_sure", label: "not sure yet" },
] as const;

type Options = readonly { value: string; label: string }[];

export function labelFor(options: Options, value: string | undefined | null): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? null;
}

export function valuesOf<T extends Options>(options: T): [T[number]["value"], ...T[number]["value"][]] {
  return options.map((o) => o.value) as [T[number]["value"], ...T[number]["value"][]];
}
