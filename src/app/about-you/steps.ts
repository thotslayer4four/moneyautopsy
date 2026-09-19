import type { UserProfile } from "@/lib/types";
import {
  AGE_OPTIONS,
  CASH_AMOUNT_OPTIONS,
  EXPENSE_COVERED_OPTIONS,
  FREQUENCY_OPTIONS,
  GENDER_OPTIONS,
  GOAL_OPTIONS,
  INCOME_SOURCE_OPTIONS,
  LIVING_OPTIONS,
  LOAN_AMOUNT_OPTIONS,
  MONTHLY_INCOME_OPTIONS,
  PERCEIVED_SPEND_OPTIONS,
  SITUATION_OPTIONS,
  SUPPORT_OPTIONS,
  YES_NO_OPTIONS,
} from "@/lib/profile/options";

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

export type Step = ChoiceStep | MultiStep;

const OFTEN = ["sometimes", "often"] as const;

/**
 * Only things a statement can't tell us. No question here asks how they pay, who they send
 * money to, or what they transfer for — the transactions answer those better than memory.
 * Conditional amounts are follow-ups on the same screen, so most people answer ~12 screens.
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
  },
  {
    key: "goal",
    type: "choice",
    question: "What are you mainly trying to do with your money right now?",
    options: GOAL_OPTIONS,
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
    key: "supports",
    type: "multi",
    question: "Do you regularly give money to or support anyone financially?",
    helper: "Pick all that apply.",
    options: SUPPORT_OPTIONS,
    exclusive: ["no_one"],
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
    key: "perceivedOverspending",
    type: "choice",
    question: "What do you think you spend too much on?",
    helper: "Be honest — we're going to check this against your statement.",
    options: PERCEIVED_SPEND_OPTIONS,
  },
];

/** Whether a step has a complete answer, including a follow-up its answer requires. */
export function isStepAnswered(step: Step, profile: Draft): boolean {
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
