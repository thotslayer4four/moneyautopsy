import {
  ArrowLeftRight,
  Banknote,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChartPie,
  CircleHelp,
  Clapperboard,
  Coins,
  Car,
  Dices,
  Ellipsis,
  Gift,
  GraduationCap,
  HandCoins,
  HandHeart,
  HeartPulse,
  Hourglass,
  House,
  Landmark,
  Moon,
  Percent,
  PiggyBank,
  Plane,
  Receipt,
  Repeat,
  RotateCcw,
  Scale,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Undo2,
  UserRound,
  Users,
  Utensils,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { Category, PatternType } from "@/lib/types";

const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  Food: Utensils,
  Groceries: ShoppingCart,
  Transport: Car,
  Shopping: ShoppingBag,
  "Personal expenses": UserRound,
  Bills: Receipt,
  Airtime: Smartphone,
  Data: Wifi,
  Housing: House,
  Entertainment: Clapperboard,
  Betting: Dices,
  Health: HeartPulse,
  Education: GraduationCap,
  Government: Landmark,
  Travel: Plane,
  Subscriptions: Repeat,
  "Banking fees": Percent,
  Cash: Banknote,
  Transfers: ArrowLeftRight,
  Savings: PiggyBank,
  Investments: TrendingUp,
  Loans: HandCoins,
  "Gifts & support": Gift,
  Reimbursements: Undo2,
  Refunds: RotateCcw,
  Income: Wallet,
  Other: Ellipsis,
  Uncertain: CircleHelp,
};

// Finding categories are mostly spending categories, plus a couple of report-only labels.
const EXTRA_ICONS: Record<string, LucideIcon> = {
  "Reality check": Scale,
  Plan: CalendarCheck,
  Share: Share2,
};

export function CategoryIcon({ category, ...props }: { category: string } & LucideProps) {
  const Icon = CATEGORY_ICONS[category as Category] ?? EXTRA_ICONS[category] ?? Sparkles;
  return <Icon {...props} />;
}

export const PATTERN_ICONS: Record<PatternType, LucideIcon> = {
  spending_spike: Zap,
  repeated_small_purchases: Coins,
  end_of_month_squeeze: CalendarClock,
  post_payday_spending: TrendingDown,
  weekend_spending: CalendarDays,
  frequent_transfers: ArrowLeftRight,
  lifestyle_inflation: TrendingUp,
  disproportionate_category: ChartPie,
};

const HIGHLIGHT_ICONS: Record<string, LucideIcon> = {
  betting: Dices,
  "data-airtime": Smartphone,
  "bank-charges": Percent,
  people: Users,
  "gifts-in": Gift,
  "support-out": HandHeart,
  savings: PiggyBank,
  cash: Banknote,
  runway: Hourglass,
  "low-balance": TrendingDown,
  "late-night": Moon,
  ledger: ArrowLeftRight,
};

export function HighlightIcon({ id, ...props }: { id: string } & LucideProps) {
  const Icon = HIGHLIGHT_ICONS[id] ?? Sparkles;
  return <Icon {...props} />;
}
