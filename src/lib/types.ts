// Core domain types shared across extraction, categorization, analysis, llm and report layers.
import type {
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

/** Which way the money moved relative to the account holder. Set at extraction from the
 * statement's own debit/credit columns and never changed afterward. */
export type TransactionDirection = "in" | "out";

/** What kind of movement this turned out to be, derived after categorization. */
export type TransactionType =
  | "income"
  | "expense"
  | "transfer"
  | "withdrawal"
  | "fee"
  | "savings"
  | "investment"
  | "loan"
  | "reimbursement"
  | "refund"
  | "reversal"
  | "unknown";

/** How the money moved (the rail) — deliberately separate from what it was FOR (category). */
export type PaymentMethod =
  | "nip"
  | "transfer"
  | "pos"
  | "atm"
  | "web"
  | "ussd"
  | "card"
  | "mobile"
  | "direct_debit"
  | "teller"
  | "cash_deposit"
  | "third_party"
  | "echannel";

export type Category =
  | "Food"
  | "Groceries"
  | "Transport"
  | "Shopping"
  | "Personal expenses"
  | "Bills"
  | "Airtime"
  | "Data"
  | "Housing"
  | "Entertainment"
  | "Betting"
  | "Health"
  | "Education"
  | "Government"
  | "Travel"
  | "Subscriptions"
  | "Banking fees"
  | "Cash"
  | "Transfers"
  | "Savings"
  | "Investments"
  | "Loans"
  | "Gifts & support"
  | "Reimbursements"
  | "Refunds"
  | "Income"
  | "Other"
  | "Uncertain";

/** The single normalized transaction shape every extraction adapter must produce. */
export interface NormalizedTransaction {
  id: string;
  date: string; // ISO 8601 date, e.g. 2024-03-14
  time?: string | null; // 24h "HH:MM" when the statement records a time of day
  direction: TransactionDirection;
  description: string; // cleaned, human-readable description
  rawDescription: string; // untouched original line/field from the statement
  amount: number; // always positive magnitude
  type: TransactionType;
  balance: number | null; // running balance after this transaction, if known
  merchant: string | null; // best-guess counterparty name (never a payment rail or processor)
  paymentMethod: PaymentMethod | null; // how the money moved — NOT what it was for
  paymentProcessor: string | null; // e.g. Paystack, Flutterwave — never the spending category
  category: Category;
  categoryConfidence: number; // 0..1
  categoryReason: string;
  /** Finer-grained purpose within a category, e.g. "repayment" vs "lent" under Loans,
   * "family_support" vs "gift" under Gifts & support. */
  subtype?: string | null;
  /** The transaction this one is paired with — a reversal's original debit, or the
   * expense a group of reimbursements are paying back. */
  relatedTransactionId?: string | null;
}

export interface ExtractionIssue {
  level: "info" | "warning" | "error";
  message: string;
}

export interface ExtractionResult {
  transactions: NormalizedTransaction[];
  sourceFormat: "pdf" | "csv";
  adapterUsed: string;
  issues: ExtractionIssue[];
  /** Whether the extraction is trustworthy enough to run a full analysis on. */
  needsReview: boolean;
  /** The statement's account holder name, when it could be read off the document —
   * lets categorization recognize self-transfers between the person's own accounts. */
  accountHolderName?: string | null;
}

// ---------------------------------------------------------------------------
// User profile (About You)
// ---------------------------------------------------------------------------

type Value<T extends readonly { value: string }[]> = T[number]["value"];

export type Gender = Value<typeof GENDER_OPTIONS>;
export type AgeRange = Value<typeof AGE_OPTIONS>;
export type LifeSituation = Value<typeof SITUATION_OPTIONS>;
export type LivingSituation = Value<typeof LIVING_OPTIONS>;
export type IncomeSource = Value<typeof INCOME_SOURCE_OPTIONS>;
export type IncomeRange = Value<typeof MONTHLY_INCOME_OPTIONS>;
export type FinancialGoal = Value<typeof GOAL_OPTIONS>;
export type ExpenseCovered = Value<typeof EXPENSE_COVERED_OPTIONS>;
export type SupportRecipient = Value<typeof SUPPORT_OPTIONS>;
export type Frequency = Value<typeof FREQUENCY_OPTIONS>;
export type LoanAmount = Value<typeof LOAN_AMOUNT_OPTIONS>;
export type YesNo = Value<typeof YES_NO_OPTIONS>;
export type CashAmount = Value<typeof CASH_AMOUNT_OPTIONS>;
export type PerceivedSpend = Value<typeof PERCEIVED_SPEND_OPTIONS>;

/**
 * Context that can't be read off a statement. It informs interpretation and tone — it is
 * never evidence. Transaction data always wins over anything here, and `gender` in
 * particular must never be used to infer behavior.
 */
export interface UserProfile {
  gender: Gender;
  ageRange: AgeRange;
  situation: LifeSituation;
  livingWith: LivingSituation;
  incomeSources: IncomeSource[];
  primaryIncomeSource: IncomeSource;
  income: IncomeRange;
  goal: FinancialGoal;
  expensesCovered: ExpenseCovered[];
  supports: SupportRecipient[];
  borrowing: Frequency;
  borrowingAmount?: LoanAmount;
  lending: Frequency;
  lendingAmount?: LoanAmount;
  paysForOthers: Frequency;
  withdrawsCash: YesNo;
  cashMonthly?: CashAmount;
  perceivedOverspending: PerceivedSpend;
}

// ---------------------------------------------------------------------------
// Deterministic analysis
// ---------------------------------------------------------------------------

/** How a category should be counted: real spending, money given to people, money merely
 * moved (transfers, savings, loans…), or unexplained. Money moved is not money spent. */
export type CategoryKind = "spend" | "support" | "moved" | "income" | "uncertain";

export interface CategoryBreakdownEntry {
  category: Category;
  kind: CategoryKind;
  total: number;
  percentOfOutflow: number;
  transactionCount: number;
}

export interface RecurringExpense {
  merchant: string;
  category: Category;
  averageAmount: number;
  occurrences: number;
  cadenceDays: number | null;
  likelySubscription: boolean;
  /** Date of the most recent payment — lets the plan see what is due next. */
  lastDate?: string;
}

export interface TopCounterparty {
  /** Stable grouping key (phone/account number or name) — use this, not `name`, to match
   * transactions back up (e.g. when correcting a category), since `name` is just a label. */
  key: string;
  name: string;
  totalAmount: number;
  transactionCount: number;
  direction: "sent" | "received";
  firstDate: string;
  lastDate: string;
  /** A few of the individual transactions (largest first, shown oldest first), so someone
   * can recognize who this is from dates, amounts and the narration itself. */
  samples: { date: string; amount: number; description: string }[];
}

/** One specific unexplained transaction, offered to the person to identify. */
export interface UncertainQuestion {
  transactionId: string;
  direction: "in" | "out";
  name: string;
  date: string;
  amount: number;
  description: string;
  /** Other unexplained transactions with the same recipient/sender identity — they will
   * follow the answer to this one (at lower confidence), so they needn't be asked. */
  followers: number;
  /** Why this one is worth answering, in plain words. */
  why: string;
  /** Percent of that side's unexplained money this recipient/sender accounts for. */
  shareOfUnexplained: number;
}

/** A heavy credit worth asking about — is this your income? Answering "yes" moves the plan. */
export interface IncomeQuestion extends UncertainQuestion {
  /** Every transaction the answer will apply to: this one, and the others that follow it. */
  coversTransactionIds: string[];
  /** Credits the answer covers, and what they add up to. */
  count: number;
  total: number;
  /** Percent of the money that came in (excluding what merely moved) that this accounts for. */
  sharePercent: number;
  /** What the plan works from each month now, and if this were confirmed as income. Null when
   * the statement is too short for a monthly figure to mean anything. */
  monthlyBefore: number | null;
  monthlyAfter: number | null;
}

export interface IncomeCheck {
  /** Money in that could be earnings: everything except money merely moved and betting winnings. */
  realInflow: number;
  /** Spending is well above the income we can confirm, so smaller credits are asked about too. */
  overspending: boolean;
  questions: IncomeQuestion[];
}

export interface UnusualTransaction {
  transactionId: string;
  reason: string;
  amount: number;
  date: string;
  description: string;
}

export interface DayOfWeekSpend {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  total: number;
  count: number;
}

export interface InflowBreakdownEntry {
  category: Category;
  total: number;
  count: number;
  percentOfInflow: number;
}

export interface BettingSummary {
  deposited: number;
  withdrawn: number;
  /** deposits minus withdrawals, floored at 0 — what betting actually cost. */
  netOutflow: number;
  /** withdrawn minus deposited: positive means they came out ahead, negative means net loss. */
  netResult: number;
  /** How heavy the betting is, judged against what they earn/spend — not just the raw amount. */
  tier: "ahead" | "even" | "light" | "heavy" | "severe";
  /** A Pidgin one-liner for this tier (calm for small figures, sharper for big ones). */
  tagline: string;
  depositCount: number;
  withdrawalCount: number;
  averageDeposit: number;
  largestDeposit: number;
  /** Distinct days with at least one deposit. */
  activeDays: number;
  depositsPerActiveDay: number;
}

export interface DataAirtimeSummary {
  dataTotal: number;
  dataCount: number;
  airtimeTotal: number;
  airtimeCount: number;
  averagePurchase: number;
  /** Combined data + airtime spend per calendar month, oldest first. */
  byMonth: { month: string; total: number; count: number }[];
  largestPurchase: number;
  tier: "light" | "heavy" | "severe";
  tagline: string;
}

export interface MonthlyTrendEntry {
  month: string; // YYYY-MM
  inflow: number;
  outflow: number;
  spent: number;
}

export interface MostExpensiveDay {
  date: string;
  weekday: DayOfWeekSpend["day"];
  spent: number;
  /** The typical (median) day's spend, for scale. */
  typicalDay: number;
  topCategory: Category | null;
  transactionCount: number;
}

export interface BalanceInsights {
  /** The balance below which the account counts as running dry. */
  floor: number;
  daysTracked: number;
  daysBelowFloor: number;
  lowest: { date: string; balance: number };
  highest: { date: string; balance: number };
  averageClosing: number;
  /** After money arrives (evidenced income or support), how long until most of it is gone. */
  runway: {
    medianDays: number;
    events: number;
    example: { date: string; amount: number; days: number };
  } | null;
  /** Closing balance per day with activity, thinned to a chartable size. */
  series: { date: string; balance: number }[];
}

export interface TimePatterns {
  /** Whether the statement records a time of day for enough transactions. */
  hasTime: boolean;
  lateNight: { count: number; total: number; percentOfSpend: number; percentOfCount: number } | null;
  peakHour: { hour: number; count: number } | null;
  partsOfDay: { morning: number; afternoon: number; evening: number; night: number } | null;
  betting: {
    depositCount: number;
    lateNightDeposits: number;
    /** Runs of 3+ deposits close together (within an hour, or on one day when times are unknown). */
    sessions: {
      count: number;
      largest: { date: string; deposits: number; total: number; spanMinutes: number | null } | null;
    };
  } | null;
  /** The same kind of spending on the same weekday, week after week. */
  rituals: { weekday: DayOfWeekSpend["day"]; category: Category; count: number; weeks: number; medianAmount: number; total: number }[];
}

/** Net money flow with one person — not a claim that anything is a loan. */
export interface LedgerEntry {
  key: string;
  name: string;
  sent: number;
  received: number;
  /** received minus sent: negative means you have sent them more than they sent back. */
  net: number;
  sentCount: number;
  receivedCount: number;
  lastDate: string;
  categories: Category[];
}

export interface FeeEfficiency {
  totalFees: number;
  feeCount: number;
  transferCount: number;
  smallTransfers: { count: number; total: number; medianAmount: number };
  /** Typical fee on a single transfer, when it can be read off the statement. */
  medianFee: number | null;
  /** That fee as a share of the typical small transfer. */
  overheadPercentOnSmall: number | null;
  /** Typical fee times the number of small transfers — a rough cost of moving small amounts. */
  estimatedSmallTransferFees: number | null;
}

export interface PriceCreepEntry {
  label: string;
  category: Category;
  occurrences: number;
  firstDate: string;
  firstAmount: number;
  lastDate: string;
  lastAmount: number;
  changePercent: number;
}

export interface FinancialAnalysis {
  periodStart: string | null;
  periodEnd: string | null;
  /** Every naira credited to the account, whatever it was — matches the statement's own
   * "total credit". NOT the same as income: inflows include transfers between the
   * person's own accounts, loans, reimbursements, refunds and betting withdrawals. */
  totalInflow: number;
  totalOutflow: number;
  netCashFlow: number;
  /** Inflow we have actual evidence is earnings (salary, business receipts, allowance…). */
  earnedIncome: number;
  incomeEvents: number;
  inflowBreakdown: InflowBreakdownEntry[];
  /** Where the outflow went, by nature: consumed, given to people, merely moved, or
   * unexplained. `spent` counts betting net of winnings withdrawn. */
  outflowSplit: { spent: number; support: number; moved: number; uncertain: number };
  transactionCount: number;
  categoryBreakdown: CategoryBreakdownEntry[];
  largestExpenses: NormalizedTransaction[];
  recurringExpenses: RecurringExpense[];
  bankCharges: number;
  bankChargeCount: number;
  cashWithdrawals: number;
  cashWithdrawalCount: number;
  /** Outflow that moved by transfer to another person/account — the rail, not the purpose. */
  peopleTransfers: { total: number; count: number; explained: number; explainedPercent: number };
  /** POS payments the statement gives no merchant for. Never treated as cash-outs. */
  ambiguousPos: { total: number; count: number };
  spendingByDayOfWeek: DayOfWeekSpend[];
  weekendSpend: number;
  weekdaySpend: number;
  spendingAfterIncome72h: number;
  topRecipients: TopCounterparty[];
  unusualTransactions: UnusualTransaction[];
  potentialSubscriptions: RecurringExpense[];
  savingsOpportunities: { description: string; estimatedMonthlyImpact: number }[];
  patterns: DetectedPattern[];
  betting: BettingSummary | null;
  dataAirtime: DataAirtimeSummary | null;
  /** `savedOut`/`withdrawnBack` are gross flows — wallet pockets like OPay's OWealth move money
   * in and out on nearly every payment, so gross is mostly churn. `netSaved` is what
   * actually stayed (negative means savings were drawn down). */
  /** Money shuffled between the person's own wallet and an automatic pocket inside it (e.g.
   * OPay's OWealth). Not saving, not spending, not income — just movement. */
  walletPockets: { movedIn: number; movedOut: number; count: number };
  savings: { savedOut: number; investedOut: number; withdrawnBack: number; netSaved: number; savedCount: number };
  support: {
    sent: number;
    sentCount: number;
    receivedGifts: number;
    receivedCount: number;
  };
  loans: {
    borrowed: number;
    borrowedCount: number;
    /** Money you sent to repay what you owed. */
    repaid: number;
    /** Money you sent to someone as a loan. */
    lent: number;
    /** Money someone paid back to you. */
    receivedBack: number;
    outCount: number;
  };
  reimbursements: {
    received: number;
    receivedCount: number;
    /** Expenses that friends appear to have paid part of back. */
    sharedExpenses: number;
    sharedExpenseTotal: number;
    /** What those expenses actually cost the person after being paid back. */
    netBurden: number;
  };
  balance: BalanceInsights | null;
  timePatterns: TimePatterns | null;
  ledger: LedgerEntry[];
  feeEfficiency: FeeEfficiency | null;
  priceCreep: PriceCreepEntry[];
  mostExpensiveDay: MostExpensiveDay | null;
  monthlyTrend: MonthlyTrendEntry[];
  /** Outflow that landed in the "Uncertain" bucket — personal transfers/expenses we
   * couldn't confidently categorize. Tracked separately because it's an honesty signal,
   * not a spending category, and should never be reported as someone's "top category." */
  uncertainOutflow: { total: number; percentOfOutflow: number };
  /** Incoming money from people we couldn't explain — not assumed to be income. */
  uncertainInflow: { total: number; percentOfInflow: number };
  /** What's actually inside the Uncertain bucket, so the person can identify it
   * themselves instead of just seeing an unexplained percentage. */
  uncertainBreakdown: {
    /** The specific transactions worth asking the person about — the biggest and most
     * unusual unexplained ones, one per recipient, never several merged into one. */
    questions: UncertainQuestion[];
    /** How much unexplained money we are NOT asking about, and why that's fine. */
    notAsked: { out: { count: number; total: number }; in: { count: number; total: number } };
    /** Percent of each side's unexplained money the questions above would resolve. */
    coverage: { out: number; in: number };
    topRecipients: TopCounterparty[];
    incomingSenders: TopCounterparty[];
    largestTransactions: { date: string; description: string; amount: number }[];
  };
  perceivedVsActual: {
    /** Plain-language label of what they said, e.g. "food / eating out". */
    perceivedLabel: string | null;
    matchedCategories: Category[];
    perceivedAmount: number | null;
    /** Rank (1 = biggest) of the best-ranked matched category among real spending. */
    perceivedRank: number | null;
    actualTopCategory: Category | null;
    actualTopCategoryAmount: number;
  };
}

export type PatternType =
  | "spending_spike"
  | "repeated_small_purchases"
  | "end_of_month_squeeze"
  | "post_payday_spending"
  | "weekend_spending"
  | "frequent_transfers"
  | "lifestyle_inflation"
  | "disproportionate_category";

export interface DetectedPattern {
  type: PatternType;
  description: string;
  evidence: string;
  magnitude: number; // relative strength/impact, unit depends on pattern
}

// ---------------------------------------------------------------------------
// LLM output
// ---------------------------------------------------------------------------

export interface MoneyPersonality {
  name: string;
  description: string;
}

export interface Finding {
  id: string;
  title: string;
  summary: string;
  detail: string;
  category: string;
  importance: number; // 1-5
  dataPoints: string[];
  confidence: number; // 0..1
}

export interface Recommendation {
  title: string;
  description: string;
  estimatedMonthlyImpact: number;
}

export interface UserBeliefComparison {
  whatTheyThought: string;
  whatDataShows: string;
  explanation: string;
}

export interface LLMInsights {
  financialPersonality: MoneyPersonality;
  findings: Finding[];
  recommendations: Recommendation[];
  userBeliefComparison: UserBeliefComparison;
  thirtyDayReset: string[];
}

// ---------------------------------------------------------------------------
// Report (what the frontend ultimately consumes)
// ---------------------------------------------------------------------------

export type ReportStatus = "free" | "unlocked";

export interface ReportOverview {
  totalInflow: number;
  totalOutflow: number;
  netCashFlow: number;
  earnedIncome: number;
  /** Outflow that was genuinely consumed/spent — excludes money merely moved. */
  spent: number;
  transactionCount: number;
  periodStart: string | null;
  periodEnd: string | null;
}

/** A specific, evidence-backed number worth showing on its own ("₦42,600 on data"). */
export interface Highlight {
  id: string;
  label: string;
  value: string;
  note: string;
  /** A Pidgin one-liner for the loud numbers (betting, data). Only set when the figure earns one. */
  tagline?: string;
}

/** One shareable "wrapped" card: a single loud number, safe to post (no names or merchants). */
export interface ShareCard {
  id: string;
  theme: "hot" | "win" | "signal" | "amber" | "warm" | "ink";
  kicker: string;
  big: string;
  /** Shown instead of `big` when the person hides naira amounts before sharing. */
  bigMasked?: string;
  label: string;
  lines: string[];
  tagline?: string;
  period: string | null;
}

// ---------------------------------------------------------------------------
// Money Plan — what to do next, built from the autopsy
// ---------------------------------------------------------------------------

/** The five kinds of money in a plan. Essentials are needs, goals are money pointed at
 * something on purpose, everyday is ordinary discretionary spending, fun is spending the
 * person is explicitly allowed to enjoy, and the buffer is money deliberately left alone. */
export type PlanBucket = "essentials" | "goals" | "everyday" | "fun" | "buffer";

export interface PlanIncome {
  /** Expected income in a typical month — what every other figure is sized against. */
  monthly: number;
  /** "statement": evidenced in the transactions. "stated": the range they gave us, because
   * the statement showed no earnings we could confirm. */
  basis: "statement" | "stated";
  regularity: "steady" | "irregular";
  /** The weakest full month we could compare, when there was more than one. */
  lowestMonth: number | null;
  /** Money that arrived each month but isn't counted as income (support we weren't told to
   * rely on, loans, unexplained transfers, betting withdrawals). May be what covers a shortfall. */
  otherInflow: number;
  streams: { label: string; monthly: number; reliability: "steady" | "irregular" }[];
}

/** What a typical month looks like before any change is chosen. */
export interface PlanBaseline {
  essentials: number;
  everyday: number;
  fun: number;
  /** What they already move toward goals in a typical month (net savings + debt repayment). */
  saving: number;
  /** Money deliberately left unallocated. Sized from their own everyday spending. */
  buffer: number;
  /** Share of what is left after everything else that is pointed at the goal; the rest is theirs. */
  goalShare: number;
}

export interface PlanStat {
  label: string;
  value: string;
}

/** One thing worth changing, found in the person's own data. */
export interface PlanChange {
  id: string;
  /** Short lowercase label: "food", "bank charges". */
  label: string;
  category: Category;
  /** Which bucket the money comes out of. */
  bucket: PlanBucket;
  /** "cut" moves money out of a habit; "limit" gives it a deliberate ceiling without asking for less. */
  nature: "cut" | "limit";
  monthlyNow: number;
  monthlyTarget: number;
  /** monthlyNow minus monthlyTarget. Zero for a limit. */
  monthlySaving: number;
  /** Only ever a suggestion they can decline — never pre-selected. */
  optional: boolean;
  /** What happened, from the numbers. Never reworded by the model. */
  fact: string;
  /** The swap we'd suggest. The model may reword it. */
  proposal: string;
  /** Why it matters for this person, in a sentence. The model may reword it. */
  why: string;
  rule: string;
  reset: string;
  stats: PlanStat[];
  /** Monthly amount to weigh against the money going to goals (betting deposits). */
  vsGoalAmount: number | null;
  /** Whether "if you cut this by X%" is a fair question to ask about it. */
  scenario: boolean;
}

export interface SafeToSpend {
  daily: number;
  /** Flexible money left until the period ends. Zero when the plan is already used up. */
  remaining: number;
  /** How far past the plan they already are, when they are. */
  over: number;
  daysLeft: number;
  /** The statement's last day — the balance is as of then. */
  asOf: string;
  /** When the period ends: the next regular payday, or the last day of the month. */
  periodEnd: string;
  endsAtPayday: boolean;
  /** What they usually spend per day on everyday and fun things, for comparison. */
  usualDaily: number;
  /** The working, so it can be shown rather than trusted. */
  working: { label: string; amount: number }[];
}

export interface MoneyPlan {
  income: PlanIncome;
  baseline: PlanBaseline;
  /** Their stated goal, in their own words, or null when not meaningful ("other"). */
  goalLabel: string | null;
  changes: PlanChange[];
  /** Change ids pre-selected when the plan first opens. */
  defaultSelected: string[];
  /** Change ids worth asking "what if I cut this by X%" about. */
  scenarioIds: string[];
  /** Rules that stand on their own evidence, whichever changes are chosen. */
  extraRules: { id: string; text: string }[];
  /** Rule and reset wording for the payday transfer. Amounts are filled in from the chosen plan. */
  paydayRule: string;
  paydayReset: string;
  safeToSpend: SafeToSpend | null;
  /** Why there is no safe-to-spend figure, when there isn't one. */
  safeToSpendNote: string | null;
  intro: string;
  /** How the plan was worked out and what it leaned on. */
  assumptions: string[];
}

/** Wording the model writes over the deterministic defaults, keyed by text slot. Never numbers. */
export interface PlanNarrative {
  intro?: string;
  /** Change ids, most relevant to this person first. */
  priority?: string[];
  texts: Record<string, string>;
}

export interface Report {
  id: string;
  status: ReportStatus;
  overview: ReportOverview;
  teaserBullets: string[];
  freeFinding: Finding | null;
  lockedFindings: Finding[];
  categoryBreakdown: CategoryBreakdownEntry[];
  inflowBreakdown: InflowBreakdownEntry[];
  outflowSplit: FinancialAnalysis["outflowSplit"];
  highlights: Highlight[];
  savings: FinancialAnalysis["savings"];
  balance: BalanceInsights | null;
  shareCards: ShareCard[];
  walletPockets: FinancialAnalysis["walletPockets"];
  moneyPersonality: MoneyPersonality;
  userBeliefComparison: UserBeliefComparison;
  recommendations: Recommendation[];
  thirtyDayReset: string[];
  unusualTransactions: UnusualTransaction[];
  recurringExpenses: RecurringExpense[];
  topRecipients: TopCounterparty[];
  patterns: DetectedPattern[];
  uncertainBreakdown: FinancialAnalysis["uncertainBreakdown"];
  /** Null when there wasn't enough to plan on honestly (a very short statement, say). */
  moneyPlan: MoneyPlan | null;
  /** Heavy credits we couldn't confidently call income. Null when there's nothing to ask. */
  incomeCheck: IncomeCheck | null;
}

/** Shape of the report actually sent to the client — locked fields are masked server-side. */
export type ClientReport =
  | (Omit<Report, "overview" | "lockedFindings" | "recommendations" | "thirtyDayReset" | "categoryBreakdown" | "unusualTransactions" | "recurringExpenses" | "topRecipients" | "userBeliefComparison" | "patterns" | "uncertainBreakdown" | "inflowBreakdown" | "outflowSplit" | "highlights" | "savings" | "walletPockets" | "balance" | "shareCards" | "moneyPlan" | "incomeCheck"> & {
      status: "free";
      /** Headline numbers only — what was actually spent and what counts as earned income
       * are part of the paid report, so they are not sent to a free-status client. */
      overview: Omit<ReportOverview, "spent" | "earnedIncome">;
      lockedFindingsCount: number;
      lockedFindingTitles: { id: string; title: string; category: string }[];
      userBeliefComparisonLocked: true;
      categoryBreakdownLocked: true;
      topCategoryName: Category | null;
    })
  | (Report & { status: "unlocked" });
