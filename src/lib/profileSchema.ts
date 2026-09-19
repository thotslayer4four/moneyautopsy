import { z } from "zod";
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
  valuesOf,
} from "@/lib/profile/options";

const incomeSource = z.enum(valuesOf(INCOME_SOURCE_OPTIONS));

export const userProfileSchema = z
  .object({
    gender: z.enum(valuesOf(GENDER_OPTIONS)),
    ageRange: z.enum(valuesOf(AGE_OPTIONS)),
    situation: z.enum(valuesOf(SITUATION_OPTIONS)),
    livingWith: z.enum(valuesOf(LIVING_OPTIONS)),
    incomeSources: z.array(incomeSource).min(1).max(INCOME_SOURCE_OPTIONS.length),
    primaryIncomeSource: incomeSource,
    income: z.enum(valuesOf(MONTHLY_INCOME_OPTIONS)),
    goal: z.enum(valuesOf(GOAL_OPTIONS)),
    expensesCovered: z.array(z.enum(valuesOf(EXPENSE_COVERED_OPTIONS))).min(1),
    supports: z.array(z.enum(valuesOf(SUPPORT_OPTIONS))).min(1),
    borrowing: z.enum(valuesOf(FREQUENCY_OPTIONS)),
    borrowingAmount: z.enum(valuesOf(LOAN_AMOUNT_OPTIONS)).optional(),
    lending: z.enum(valuesOf(FREQUENCY_OPTIONS)),
    lendingAmount: z.enum(valuesOf(LOAN_AMOUNT_OPTIONS)).optional(),
    paysForOthers: z.enum(valuesOf(FREQUENCY_OPTIONS)),
    withdrawsCash: z.enum(valuesOf(YES_NO_OPTIONS)),
    cashMonthly: z.enum(valuesOf(CASH_AMOUNT_OPTIONS)).optional(),
    perceivedOverspending: z.enum(valuesOf(PERCEIVED_SPEND_OPTIONS)),
  })
  .refine((p) => p.incomeSources.includes(p.primaryIncomeSource), {
    message: "primary income source must be one of the selected sources",
    path: ["primaryIncomeSource"],
  })
  .refine((p) => p.borrowing === "never" || !!p.borrowingAmount, { message: "borrowing amount is required", path: ["borrowingAmount"] })
  .refine((p) => p.lending === "never" || !!p.lendingAmount, { message: "lending amount is required", path: ["lendingAmount"] })
  .refine((p) => p.withdrawsCash === "no" || !!p.cashMonthly, { message: "cash amount is required", path: ["cashMonthly"] });
