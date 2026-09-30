import type { UserProfile } from "@/lib/types";
import {
  AGE_OPTIONS,
  CASH_AMOUNT_OPTIONS,
  DEBT_PAYOFF_OPTIONS,
  EXPENSE_COVERED_OPTIONS,
  FREQUENCY_OPTIONS,
  GENDER_OPTIONS,
  GOAL_OPTIONS,
  INCOME_SOURCE_OPTIONS,
  INCOME_TIMING_OPTIONS,
  LIVING_OPTIONS,
  LOAN_AMOUNT_OPTIONS,
  MONTHLY_INCOME_OPTIONS,
  PERCEIVED_SPEND_OPTIONS,
  REDUCE_AREA_OPTIONS,
  RENT_FREQUENCY_OPTIONS,
  SAVINGS_PREFERENCE_OPTIONS,
  SCHOOL_FREQUENCY_OPTIONS,
  SITUATION_OPTIONS,
  SUPPORT_OPTIONS,
  YES_NO_OPTIONS,
  valuesOf,
} from "@/lib/profile/options";
import { formatMonth } from "@/lib/plan/obligations";

export interface Option {
  value: string;
  label: string;
}

type ProfileKey = keyof UserProfile;
type Draft = Partial<UserProfile>;

interface StepBase {
  key: ProfileKey;
  question: string;
  helper?: string;
  /** Return true to leave this step out (e.g. nothing to choose between). */
  skip?: (profile: Draft) => boolean;
}

/** A follow-up question revealed on the same screen only when the first answer needs it. */
export interface FollowUp {
  key: ProfileKey;
  question: string;
  options: readonly Option[];
  showWhen: readonly string[];
}

export interface ChoiceStep extends StepBase {
  type: "choice";
  options: readonly Option[];
  /** Options derived from earlier answers (e.g. only the income sources already picked). */
  dynamicOptions?: (profile: Draft) => readonly Option[];
  followUp?: FollowUp;
}

export interface MultiStep extends StepBase {
  type: "multi";
  options: readonly Option[];
  /** Picking one of these clears every other selection, and vice versa ("none of these"). */
  exclusive?: readonly string[];
}

interface FieldBase {
  key: ProfileKey;
  /** Omitted for the screen's own question (a yes/no gate), which the heading already asks. */
  label?: string;
  required?: boolean;
  /** Shown only once earlier fields make it relevant; hidden fields are cleared. */
  showWhen?: (profile: Draft) => boolean;
}

export type DetailField =
  | (FieldBase & { type: "choice"; options: readonly Option[] })
  | (FieldBase & { type: "amount"; placeholder?: string })
  | (FieldBase & { type: "month" })
  | (FieldBase & { type: "text"; placeholder?: string; maxLength: number });

/**
 * A few related answers on one screen (rent: amount, how often, when next). Always skippable:
 * these only sharpen the Money Plan, and a guess is worse than leaving the plan to the statement.
 */
export interface DetailsStep extends StepBase {
  type: "details";
  fields: DetailField[];
  /** An answer that finishes the screen on its own, like "no" to "are you paying off debt?". */
  doneWhen?: (profile: Draft) => boolean;
}

export type Step = ChoiceStep | MultiStep | DetailsStep;

const MONTHS_AHEAD = 18;

/** This month and the next 17, as "YYYY-MM" values with "November 2026" labels. */
export function upcomingMonths(from: Date = new Date()): Option[] {
  return Array.from({ length: MONTHS_AHEAD }, (_, i) => {
    const value = new Date(Date.UTC(from.getFullYear(), from.getMonth() + i, 1)).toISOString().slice(0, 7);
    return { value, label: formatMonth(value) };
  });
}

const paysOften = (frequency: unknown) => !!frequency && frequency !== "monthly";

const OFTEN = ["sometimes", "often"] as const;

/**
 * Only things a statement can't tell us. No question here asks how they pay, who they send
 * money to, or what they transfer for — the transactions answer those better than memory, and
 * nothing asks what they spend on data, food or bills. What the Money Plan needs that a
 * statement can't show (how often rent is due, a debt, savings held elsewhere) comes as
 * follow-ups on existing screens or as skippable screens that only appear when they apply.
 */
export const steps: Step[] = [
  {
    key: "gender",
    type: "choice",
    question: "What's your gender?",
    helper: "Just context — it never changes how we read your transactions.",
    options: GENDER_OPTIONS,
  },
  { key: "ageRange", type: "choice", question: "What age range are you in?", options: AGE_OPTIONS },
  { key: "situation", type: "choice", question: "What's your current situation?", options: SITUATION_OPTIONS },
  { key: "livingWith", type: "choice", question: "Where do you live right now?", options: LIVING_OPTIONS },
  {
    key: "incomeSources",
    type: "multi",
    question: "Where does your money come from?",
    helper: "Pick everything that applies — most people have more than one.",
    options: INCOME_SOURCE_OPTIONS,
  },
  {
    key: "primaryIncomeSource",
    type: "choice",
    question: "Which one is your primary source of income?",
    options: INCOME_SOURCE_OPTIONS,
    dynamicOptions: (p) => INCOME_SOURCE_OPTIONS.filter((o) => p.incomeSources?.includes(o.value)),
    skip: (p) => (p.incomeSources?.length ?? 0) <= 1,
  },
  {
    key: "income",
    type: "choice",
    question: "Roughly how much do you usually make in a month, in total?",
    options: MONTHLY_INCOME_OPTIONS,
    followUp: {
      key: "incomeTiming",
      question: "And how does it usually arrive?",
      options: INCOME_TIMING_OPTIONS,
      showWhen: valuesOf(MONTHLY_INCOME_OPTIONS),
    },
  },
  {
    key: "goal",
    type: "choice",
    question: "What are you mainly trying to do with your money right now?",
    options: GOAL_OPTIONS,
    followUp: {
      key: "savingsPreference",
      question: "When money comes in, how much of it would you ideally save?",
      options: SAVINGS_PREFERENCE_OPTIONS,
      showWhen: valuesOf(GOAL_OPTIONS),
    },
  },
  {
    key: "expensesCovered",
    type: "multi",
    question: "Which of these do you personally pay for?",
    helper: "Pick all that apply.",
    options: EXPENSE_COVERED_OPTIONS,
    exclusive: ["none"],
  },
  {
    key: "rentAmount",
    type: "details",
    question: "Tell us about your rent",
    helper: "A statement shows rent leaving, not how often it's due. This lets us spread it out properly.",
    skip: (p) => !p.expensesCovered?.includes("rent"),
    fields: [
      { key: "rentAmount", type: "amount", label: "How much is it each time?", required: true, placeholder: "e.g. 1,200,000" },
      { key: "rentFrequency", type: "choice", label: "How often do you pay it?", required: true, options: RENT_FREQUENCY_OPTIONS },
      { key: "rentNextDue", type: "month", label: "When is it next due?", showWhen: (p) => paysOften(p.rentFrequency) },
    ],
  },
  {
    key: "schoolAmount",
    type: "details",
    question: "Tell us about your school fees",
    helper: "Fees usually land in big lumps, so we'll set a little aside each month instead.",
    skip: (p) => !p.expensesCovered?.includes("school"),
    fields: [
      { key: "schoolAmount", type: "amount", label: "How much is it usually?", required: true, placeholder: "e.g. 250,000" },
      { key: "schoolFrequency", type: "choice", label: "How often do you pay it?", required: true, options: SCHOOL_FREQUENCY_OPTIONS },
      { key: "schoolNextDue", type: "month", label: "When is the next payment due?", showWhen: (p) => paysOften(p.schoolFrequency) },
    ],
  },
  {
    key: "supports",
    type: "multi",
    question: "Do you regularly give money to or support anyone financially?",
    helper: "Pick all that apply.",
    options: SUPPORT_OPTIONS,
    exclusive: ["no_one"],
  },
  {
    key: "supportMonthly",
    type: "details",
    question: "Roughly how much do you usually set aside to support people each month?",
    helper: "Some of it goes as cash or from other accounts, so your statement may not show all of it.",
    skip: (p) => !p.supports?.length || p.supports.includes("no_one"),
    fields: [{ key: "supportMonthly", type: "amount", required: true, placeholder: "e.g. 30,000" }],
  },
  {
    key: "hasDebt",
    type: "details",
    question: "Are you paying off any debt right now?",
    helper: "A loan, a loan app, a credit card, pay-later — anything with a repayment.",
    doneWhen: (p) => p.hasDebt === "no",
    fields: [
      { key: "hasDebt", type: "choice", required: true, options: YES_NO_OPTIONS },
      { key: "debtMonthly", type: "amount", label: "Roughly how much do you repay each month?", required: true, placeholder: "e.g. 25,000", showWhen: (p) => p.hasDebt === "yes" },
      { key: "debtPayoff", type: "choice", label: "When do you expect to finish paying it off?", required: true, options: DEBT_PAYOFF_OPTIONS, showWhen: (p) => p.hasDebt === "yes" },
    ],
  },
  {
    key: "borrowing",
    type: "choice",
    question: "Do you often borrow money from people?",
    options: FREQUENCY_OPTIONS,
    followUp: {
      key: "borrowingAmount",
      question: "Roughly how much is usually involved?",
      options: LOAN_AMOUNT_OPTIONS,
      showWhen: OFTEN,
    },
  },
  {
    key: "lending",
    type: "choice",
    question: "Do you often lend money to people?",
    options: FREQUENCY_OPTIONS,
    followUp: {
      key: "lendingAmount",
      question: "Roughly how much is usually involved?",
      options: LOAN_AMOUNT_OPTIONS,
      showWhen: OFTEN,
    },
  },
  {
    key: "paysForOthers",
    type: "choice",
    question: "When you go out with other people, do you sometimes pay for everyone and get paid back later?",
    options: FREQUENCY_OPTIONS,
  },
  {
    key: "withdrawsCash",
    type: "choice",
    question: "Do you regularly withdraw cash to keep in hand?",
    options: YES_NO_OPTIONS,
    followUp: {
      key: "cashMonthly",
      question: "Roughly how much do you withdraw in a typical month?",
      options: CASH_AMOUNT_OPTIONS,
      showWhen: ["yes"],
    },
  },
  {
    key: "savingsBalance",
    type: "details",
    question: "Roughly how much do you have saved that you could get to if you needed it?",
    helper: "Savings accounts, wallets, cash at home. We never count it as spending money. 0 is a fine answer.",
    fields: [{ key: "savingsBalance", type: "amount", required: true, placeholder: "e.g. 150,000" }],
  },
  {
    key: "hasUpcomingExpense",
    type: "details",
    question: "Is there a big expense coming up?",
    helper: "A laptop, a wedding, a move, a trip — anything you'll need money ready for.",
    doneWhen: (p) => p.hasUpcomingExpense === "no",
    fields: [
      { key: "hasUpcomingExpense", type: "choice", required: true, options: YES_NO_OPTIONS },
      { key: "upcomingWhat", type: "text", label: "What is it?", required: true, placeholder: "e.g. a new laptop", maxLength: 60, showWhen: (p) => p.hasUpcomingExpense === "yes" },
      { key: "upcomingAmount", type: "amount", label: "Roughly how much will it cost?", required: true, placeholder: "e.g. 300,000", showWhen: (p) => p.hasUpcomingExpense === "yes" },
      { key: "upcomingDue", type: "month", label: "When do you need the money?", showWhen: (p) => p.hasUpcomingExpense === "yes" },
    ],
  },
  {
    key: "perceivedOverspending",
    type: "choice",
    question: "What do you think you spend too much on?",
    helper: "Be honest — we're going to check this against your statement.",
    options: PERCEIVED_SPEND_OPTIONS,
  },
  {
    key: "willingToReduce",
    type: "multi",
    question: "Which of these would you genuinely be happy to spend less on?",
    helper: "Your plan leads with what you pick, and won't push cuts anywhere else.",
    options: REDUCE_AREA_OPTIONS,
    exclusive: ["none", "not_sure"],
  },
];

export function visibleFields(step: DetailsStep, profile: Draft): DetailField[] {
  return step.fields.filter((f) => !f.showWhen || f.showWhen(profile));
}

const hasValue = (value: unknown) => value !== undefined && value !== null && value !== "";

/** Whether every field the screen currently shows and needs has an answer. */
export function detailsComplete(step: DetailsStep, profile: Draft): boolean {
  return visibleFields(step, profile).every((f) => !f.required || hasValue(f.type === "text" ? String(profile[f.key] ?? "").trim() : profile[f.key]));
}

/** Whether a step has a complete answer, including a follow-up its answer requires. */
export function isStepAnswered(step: Step, profile: Draft): boolean {
  // Details screens can always be skipped, so they never hold up finishing.
  if (step.type === "details") return true;
  const value = profile[step.key];
  if (step.type === "multi") return Array.isArray(value) && value.length > 0;
  if (!value) return false;
  if (step.followUp?.showWhen.includes(value as string)) return !!profile[step.followUp.key];
  return true;
}

/** Index (among the steps that apply to this profile) of the first unanswered one, or -1. */
export function firstUnansweredIndex(profile: Draft): number {
  return steps.filter((s) => !s.skip?.(profile)).findIndex((s) => !isStepAnswered(s, profile));
}
