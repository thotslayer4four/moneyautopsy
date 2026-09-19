import type { UserProfile } from "@/lib/types";
import {
  AGE_OPTIONS,
  CASH_AMOUNT_OPTIONS,
  EXPENSE_COVERED_OPTIONS,
  GOAL_OPTIONS,
  INCOME_SOURCE_OPTIONS,
  LIVING_OPTIONS,
  LOAN_AMOUNT_OPTIONS,
  MONTHLY_INCOME_OPTIONS,
  PERCEIVED_SPEND_OPTIONS,
  SITUATION_OPTIONS,
  SUPPORT_OPTIONS,
  labelFor,
} from "./options";

/**
 * The profile as the LLM sees it: human labels, and only what materially helps interpret a
 * statement. Everything here is context the person told us — never evidence about what
 * they actually did.
 */
export function describeProfileForLlm(profile: UserProfile) {
  const labels = <T extends readonly { value: string; label: string }[]>(options: T, values: string[]) =>
    values.map((v) => labelFor(options, v) ?? v);

  return {
    gender: profile.gender,
    age: labelFor(AGE_OPTIONS, profile.ageRange),
    situation: labelFor(SITUATION_OPTIONS, profile.situation),
    livingWith: labelFor(LIVING_OPTIONS, profile.livingWith),
    incomeSources: labels(INCOME_SOURCE_OPTIONS, profile.incomeSources),
    primaryIncomeSource: labelFor(INCOME_SOURCE_OPTIONS, profile.primaryIncomeSource),
    statedMonthlyIncome: labelFor(MONTHLY_INCOME_OPTIONS, profile.income),
    mainGoal: labelFor(GOAL_OPTIONS, profile.goal),
    expensesTheyPersonallyCover: labels(EXPENSE_COVERED_OPTIONS, profile.expensesCovered),
    peopleTheySupport: labels(SUPPORT_OPTIONS, profile.supports),
    borrowsMoney: profile.borrowing,
    typicalBorrowedAmount: labelFor(LOAN_AMOUNT_OPTIONS, profile.borrowingAmount),
    lendsMoney: profile.lending,
    typicalLentAmount: labelFor(LOAN_AMOUNT_OPTIONS, profile.lendingAmount),
    paysForOthersAndGetsPaidBack: profile.paysForOthers,
    keepsCashInHand: profile.withdrawsCash === "yes",
    statedMonthlyCashWithdrawals: labelFor(CASH_AMOUNT_OPTIONS, profile.cashMonthly),
    whatTheyThinkTheyOverspendOn: labelFor(PERCEIVED_SPEND_OPTIONS, profile.perceivedOverspending),
  };
}
