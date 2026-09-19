import type { Category, CategoryKind } from "@/lib/types";

/**
 * How each category counts. This is where "money moved is not money spent" lives: savings,
 * investments, loans, transfers between own accounts, reimbursements and refunds are all
 * real movements of money, but none of them is consumption.
 */
export const CATEGORY_KIND: Record<Category, CategoryKind> = {
  Food: "spend",
  Groceries: "spend",
  Transport: "spend",
  Shopping: "spend",
  "Personal expenses": "spend",
  Bills: "spend",
  Airtime: "spend",
  Data: "spend",
  Housing: "spend",
  Entertainment: "spend",
  Betting: "spend",
  Health: "spend",
  Education: "spend",
  Government: "spend",
  Travel: "spend",
  Subscriptions: "spend",
  "Banking fees": "spend",
  Cash: "spend",
  Other: "spend",
  "Gifts & support": "support",
  Transfers: "moved",
  Savings: "moved",
  Investments: "moved",
  Loans: "moved",
  Reimbursements: "moved",
  Refunds: "moved",
  Income: "income",
  Uncertain: "uncertain",
};

export function kindOf(category: Category): CategoryKind {
  return CATEGORY_KIND[category];
}

/** Categories someone can pick when correcting where money they SENT actually went. */
export const OUTFLOW_EDITABLE_CATEGORIES: Category[] = [
  "Food", "Groceries", "Transport", "Shopping", "Personal expenses", "Bills", "Airtime", "Data",
  "Housing", "Entertainment", "Betting", "Health", "Education", "Government", "Travel",
  "Subscriptions", "Gifts & support", "Loans", "Savings", "Investments", "Reimbursements",
  "Transfers", "Cash", "Banking fees", "Other",
];

/** Categories someone can pick when explaining money they RECEIVED. A transfer from a
 * person is never assumed to be income — this is how they tell us what it really was. */
export const INFLOW_EDITABLE_CATEGORIES: Category[] = [
  "Income", "Gifts & support", "Loans", "Reimbursements", "Refunds", "Transfers", "Savings", "Betting", "Other",
];

/** What a category is called when someone is choosing it. "Reimbursements" reads
 * differently by direction: money you fronted for someone, or money someone paid back. */
export function optionLabel(category: Category, direction: "in" | "out"): string {
  if (category === "Reimbursements") return direction === "out" ? "Paid for someone (getting it back)" : "Someone paying me back";
  if (category === "Transfers") return "Between my own accounts";
  if (category === "Loans") return direction === "out" ? "Loan (lent or repaid)" : "Loan (borrowed)";
  return category;
}
