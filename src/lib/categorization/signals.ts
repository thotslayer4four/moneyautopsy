import type { Category, PaymentMethod, TransactionDirection } from "@/lib/types";

/**
 * The deterministic, first-pass evidence layer of classification: known merchants and
 * narration keywords, evaluated in priority order, direction-aware.
 *
 * Two structural rules keep this honest:
 *  - Direction matters. Spending categories only ever apply to money going OUT. Incoming
 *    money is never called Food or Transport — it is income, a gift, a loan, a
 *    reimbursement, a refund, a betting withdrawal… or, when nothing says which, Uncertain.
 *  - Rails are not purposes. Nothing here matches "NIP", "POS", "transfer", "USSD" etc. as
 *    a category; those are read separately as the payment method (see channels.ts).
 */

export interface SignalContext {
  direction: TransactionDirection;
  amount: number;
  method: PaymentMethod | null;
}

export interface SignalMatch {
  category: Category;
  confidence: number;
  label: string;
  fragment: string;
  subtype: string | null;
}

interface Rule {
  dir: TransactionDirection | "any";
  category: Category;
  pattern: RegExp;
  confidence: number;
  label: string;
  subtype?: string;
  guard?: (ctx: SignalContext, text: string) => boolean;
}

const out = (category: Category, pattern: RegExp, confidence: number, label: string, subtype?: string, guard?: Rule["guard"]): Rule =>
  ({ dir: "out", category, pattern, confidence, label, subtype, guard });
const inn = (category: Category, pattern: RegExp, confidence: number, label: string, subtype?: string, guard?: Rule["guard"]): Rule =>
  ({ dir: "in", category, pattern, confidence, label, subtype, guard });
const both = (category: Category, pattern: RegExp, confidence: number, label: string, subtype?: string, guard?: Rule["guard"]): Rule =>
  ({ dir: "any", category, pattern, confidence, label, subtype, guard });

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const BETTING_BRANDS =
  /sporty\s?bet|\bsporty\b|bet\s?9\s?ja|betano|stake\.com|stake\s?bet|1\s?x\s?bet|betway|bet\s?king|naira\s?bet|merry\s?bet|bet\s?bonanza|premier\s?bet|supa\s?bet|bet\s?winner|22\s?bet|parimatch|melbet|betfair|betpawa|bet365|accessbet|\blotto\b|baba ijebu|nlrc/i;
// OPay wallet pocket (OWealth); see the rule that uses it.
const OWEALTH = /o-?wealth/i;
const BETTING_WORDS = /\bbetting\b|\bwager\b|sportsbook|casino|bet\s?slip|jackpot|betting wallet|\bbets?\b/i;

const INVESTMENT_WORDS =
  /cowrywise|cowry\s?wise|\bbamboo\b|\bchaka\b|\btrove\b|risevest|rise\s?vest|mutual fund|treasury bills?|\bt-?bills?\b|fixed deposit|\bstocks?\b|\bbonds?\b|portfolio|investment plan|money market|commercial paper|\binvest(ment|ing|ed|s)?\b/i;
const SAVINGS_WORDS =
  /piggy\s?vest|o-?wealth|safelock|auto-?save|target savings|flexible savings|\bsavings?\b|\bsave[ds]?\s(to|into|for)\b|savings plan|spend and save|money ?box/i;

const LOAN_WORDS =
  /\bloans?\b|repayment|\brepay(ing|ed)?\b|disbursement|credit facility|\bborrow\w*|nano\s?loan|instal+ment|\bdebt\b|\blend(ing|s)?\b|\blent\b|micro\s?credit/i;

const RELATIVE_WORDS =
  /\b(?:to|from)\s+(?:my\s+)?(mum|mummy|mama|mom|mother|dad|daddy|papa|father|bro|brother|sis|sister|aunty|auntie|uncle|grandma|granny|grandpa)\b/i;

const REIMBURSEMENT_WORDS =
  /my share|my part|your share|share of|\bsplit\b|reimburs|pay\s?back|paying back|paid back|refund me|\bsettle(d|ment)?\b|\bowe[ds]?\b|balance for|bill split|contribution for/i;

// Words that, on an INCOMING transfer from a person, suggest they're paying you back for
// something they consumed with you — not that they're paying you for work.
const SHARED_SPEND_WORDS =
  /\b(food|dinner|lunch|breakfast|drinks?|bill|yesterday|last night|uber|bolt|ride|fuel|data|airtime|ticket|shawarma|suya|pizza|chicken|rice|party|outing)\b/i;

// ---------------------------------------------------------------------------
// OUTGOING and shared rules, highest priority first
// ---------------------------------------------------------------------------

const OUT_AND_SHARED_RULES: Rule[] = [
  // Reversals / refunds — must be spotted before anything else so the original purchase's
  // category isn't wrongly applied to the money coming back.
  both("Refunds", /reversal|reversed|failed (transaction|transfer|txn|trx)|chargeback|\brev\s*[-/:]|\brev\s+(cr|dr)\b|\btxn rev\b/i, 0.85, "reversal", "reversal"),
  both("Refunds", /\brefund(ed|s)?\b/i, 0.8, "refund", "refund"),

  // Betting is first-class, and is matched on brand name anywhere in the narration — so a
  // deposit routed through Paystack/Flutterwave is still betting, not "Paystack".
  both("Betting", BETTING_BRANDS, 0.93, "betting platform"),
  both("Betting", BETTING_WORDS, 0.85, "betting wording"),

  // Bank charges. Deliberately specific phrases; the generic fee/charge/VAT catch-all lives
  // in the low-confidence fallback (see isLikelyBankFee).
  out(
    "Banking fees",
    /transfer (fee|charge)|(cash withdrawal|withdrawal|atm) (fee|charge)|nip (fee|charge)|transaction (fee|charge)|bank charge|bank service charge|account maintenance|maintenance (fee|charge)|sms alert|alert (fee|charge)|atm (fee|charge)|card (fee|charge|maintenance)|commission (charge|on turnover)|e-?channel charge|ussd charge|vat on|stamp duty|processing fee|banking charge|\bemtl\b|electronic money transfer levy|\bcot\b|(cbn|government|stamp) levy/i,
    0.92,
    "bank charge"
  ),


  // OPay's OWealth is a pocket inside the same wallet: OPay sweeps money in ("Auto-save") and
  // pays out of it ("OWealth Withdrawal") automatically. That's shuffling between the person's
  // own pockets — not saving — whichever way it moves.
  both("Transfers", OWEALTH, 0.92, "OPay OWealth pocket — money moved between your own wallet and its pocket, not saving", "wallet_pocket"),

  // Savings and investments — money moved, never consumption. Investments before Savings so
  // "PiggyVest investment" isn't flattened into plain savings.
  both("Investments", INVESTMENT_WORDS, 0.88, "investment platform/wording", "investment"),
  both("Savings", SAVINGS_WORDS, 0.88, "savings product", "savings"),

  both("Loans", LOAN_WORDS, 0.82, "loan wording"),
  out("Loans", /\binterest\b/i, 0.6, "interest charge", "repayment"),

  // Cash — only when the narration EXPLICITLY says so. POS alone is never a cash-out.
  out("Cash", /\batm\b|cash withdrawal|cash wdl/i, 0.95, "ATM/cash withdrawal", undefined),
  out(
    "Cash",
    /withdrawal at/i,
    0.85,
    "withdrawal",
    undefined,
    (_ctx, text) => !/\bpos\b/i.test(text)
  ),

  // Delivery apps that share a name with ride-hailing brands
  out("Food", /uber\s?eats|bolt\s?food|chowdeck|jumia\s?food|glovo|foodcourt/i, 0.92, "food delivery"),

  // Fuel counts as transport. Strong fuel words first, then station brands (weaker: they
  // also sell other things, and some brand names are ordinary words).
  out("Transport", /\bfuel\b|petrol|\bpms\b|diesel|filling station|service station|fuel station|gas station|petroleum|oil\s*(&|and)\s*gas/i, 0.86, "fuel (transport)", "fuel"),
  out(
    "Transport",
    /\bnnpc\b|total\s?energies|total (station|filling|nigeria)|mrs (oil|fuel|station|petrol|filling)|conoil|\boando\b|\ba\.?\s?a\.?\s?rano\b|\barano\b|\bnipco\b|\benyo\b|\bovh\b|mobil (station|oil|filling)/i,
    0.66,
    "fuel-station brand (likely fuel, which counts as transport — these stations also sell other things)",
    "fuel"
  ),

  // Data / internet — a first-class category. Checked before airtime so "MTN DATA" isn't
  // mistaken for airtime just because it mentions MTN.
  out(
    "Data",
    /\bdata\b|data (plan|bundle|purchase|subscription|sub)|\bbundle\b|mobile data|internet (bundle|data|subscription|plan)|\b\d+(\.\d+)?\s?(gb|mb)\b|starlink|spectranet|\bsmile\b|\bipnx\b|swift networks|broadband|fib(re|er)\b|\bwi-?fi\b/i,
    0.86,
    "data / internet"
  ),
  out(
    "Airtime",
    /airtime|\brecharge\b|recharge card|\bvtu\b|virtual top\s?up|mobile recharge|talk\s?time|\btop\s?-?up\b(?!\s*(my\s*)?(wallet|account|card|piggy|kuda|opay|palmpay))/i,
    0.88,
    "airtime"
  ),
  // A bare telecom provider tells us it's a telecom purchase, not which kind.
  out(
    "Airtime",
    /\bmtn\b|\bglo\b|globacom|\bairtel\b|9\s?mobile|etisalat/i,
    0.55,
    "telecom provider (no data/airtime keyword — could be airtime, data or another service)"
  ),

  // Utilities / TV
  out(
    "Bills",
    /electricity|\belectric\b|prepaid|\bmeter\b|power (bill|token|purchase|payment)|\bphcn\b|\bnepa\b|\baedc\b|abuja electricity|\bjed\b|jos electricity|\bekedc\b|eko electricity|\bikedc\b|ikeja electric|\bibedc\b|\beedc\b|\bkaedco\b|\bkedco\b|\bphed\b|\bbedc\b|\byedc\b|kano electric/i,
    0.88,
    "electricity / power",
    "electricity"
  ),
  out("Bills", /\bdstv\b|\bgotv\b|multichoice|star\s?times/i, 0.9, "TV subscription", "tv"),
  out("Bills", /water corporation|waste management|lawma|water bill/i, 0.85, "utility", "utility"),

  // Digital services. Recurring-vs-one-off is decided later by the recurrence analysis, not here.
  out(
    "Subscriptions",
    /netflix|spotify|showmax|amazon prime|apple\.com\/bill|apple (music|tv|one|icloud|services)|itunes|\bicloud\b|google (play|one|youtube|cloud|workspace|storage)|youtube\s?(premium|music)|disney\s?\+?|\bhbo\b|audible|playstation plus|\bpsn\b|xbox game pass|\bcanva\b|\bnotion\b|chatgpt|openai|\bclaude\b|anthropic|microsoft|\bmsft\b|office 365|adobe|\bzoom\b|figma|dropbox|linkedin premium|\bsubscription\b|monthly plan renewal|annual plan renewal|premium plan/i,
    0.85,
    "digital service / subscription",
    "digital"
  ),
  out(
    "Subscriptions",
    /\baws\b|amazon web services|\bvercel\b|github|namecheap|hostinger|godaddy|digital\s?ocean|\bdomain( registration)?\b|\bhosting\b|\bcloud\b|\bsoftware\b|\bsaas\b/i,
    0.8,
    "developer / business software or hosting",
    "dev_business"
  ),

  // Transport
  out("Transport", /\buber\b(?!\s?eats)|\bbolt\b|taxify|\bindrive\b|\brida\b|\btaxi\b|\bcab\b|rideshare|\bride\b|transport|\bbus\b|parking|car\s?wash|\btoll\b|toll gate|\blcc\b|\bkeke\b|\bokada\b|danfo|\bbrt\b|park fee/i, 0.86, "transport"),

  // Groceries before Food ("foodstuff", "supermarket"), then eating out.
  out("Groceries", /groceries|grocery|provisions|foodstuff|market money|supermarket|supermart|\bmart\b|shoprite|\bs\/?mkt\b|\bsmkt\b|super\s?mkt|\bspar\b|justrite|ebeano|hyper\s?market|\bmarket\b/i, 0.8, "groceries"),
  out(
    "Food",
    /chicken republic|\bkfc\b|domino'?s|dodo pizza|sweet sensation|tantalizers|kilimanjaro|mr\.? ?bigg'?s|cold stone|bukka|krispy kreme|mega chicken|\bfood\b|\blunch\b|\bdinner\b|\bsupper\b|\bbrunch\b|\bbreakfast\b|\bmeals?\b|\beat(s|ing)?\b|chicken|\bfried\b|\bpap\b|\bogi\b|\brice\b|\bbeans\b|\byam\b|\bsuya\b|shawarma|burger|pizza|noodles|indomie|spaghetti|pasta|\bdrinks?\b|restaurant|\bcafe\b|coffee|\btea\b|\beatery\b|\bsnacks?\b|\bchow\b|pop\s?corn|\bchips?\b|plantain|\bdodo\b|puff\s?puff|chin\s?chin|\bakara\b|moi\s?moi|\bmoin\b|\begusi\b|ofada|ewedu|gbegiri|\btuwo\b|\bfufu\b|pounded yam|\bgarri\b|\bbread\b|\bpie\b|sausage|doughnut|donut|ice\s?cream|\bjuice\b|smoothie|yog(h)?urt|\bzobo\b|\bkunu\b|\bmalt\b|\bfanta\b|\bcoke\b|\bsprite\b|\bsoda\b|\bponmo\b|\bkpomo\b|isi ?ewu|nkwobi|catfish|\bkilishi\b|\babacha\b|\bokpa\b|\bmeat\b|\bfish\b|amala|pepper soup|jollof|\beba\b|swallow|small chops|\basun\b|bakery|\bbakes\b|\bcakes?\b|cupcake|kitchen|\bgrill\b|\bbbq\b|roast(ed)?|confectionery|\bcanteen\b|\bfoodcourt\b/i,
    0.78,
    "food"
  ),

  // Government / official
  out(
    "Government",
    /\bfirs\b|\btax\b|tax payment|\btin\b|\bcac\b|\bnysc\b|\bnimc\b|immigration|passport|\bfrsc\b|\bgovernment\b|\bministry\b|official payment|\bcourt\b|visa (fee|application|appointment|payment)|\blasg\b|lagos state|\blasrra\b|driver'?s licen[sc]e|vehicle licen[sc]e/i,
    0.8,
    "government / official payment"
  ),
  out("Education", /school fees|tuition|\bwaec\b|\bjamb\b|\bneco\b|university|polytechnic|textbooks|exam fee|lesson fee|academy|institute|nursery school|\bschool\b|coursera|udemy/i, 0.84, "education"),
  out("Health", /pharmacy|hospital|clinic|medplus|healthplus|diagnostic|\bdrugs?\b|medication|\bdoctor\b|dental|optical|physio|medicals|\bhmo\b|health insurance/i, 0.84, "health"),
  out("Travel", /\bairline\b|air peace|arik air|ibom air|dana air|flight|\bhotel\b|booking\.com|airbnb|\bresort\b|\bsuites\b|guest\s?house|\blodge\b|\btravel\b/i, 0.82, "travel"),
  out("Housing", /\brent(al)?\b|rent payment|house rent|estate levy|service charge|landlord|agent fee|caution fee|tenancy|\bapartments?\b|\bestate\b/i, 0.84, "rent / housing"),
  out("Entertainment", /cinema|movie|\bclub\b|nightclub|lounge|concert|event ticket|\bgames?\b|\bnightlife\b|\b(beer|wine|liquor|whisky|whiskey|cocktails?)\b/i, 0.78, "entertainment"),
  out(
    "Shopping",
    /jumia|konga|\bslot\b|aliexpress|amazon|\btemu\b|\bshein\b|payporte|boutique|fashion|clothing|clothes|\bshoes\b|sneakers|electronics|accessories|\bmall\b|online (purchase|order)|\bshop(ping)?\b|\bstore\b|\bphone\b|gadget|furniture|couture|\bwears?\b/i,
    0.7,
    "shopping"
  ),

  out("Personal expenses", /personal\s+(expenses?|use|spending|stuff|things|needs)|for myself|my personal|\bpersonal\b(?!\s*(loan|account|banking|current|savings))/i, 0.7, "marked personal", "personal"),

  // Gifts / support (relative names are strong evidence of family support)
  out("Gifts & support", RELATIVE_WORDS, 0.66, "recipient is a family member", "family_support"),
  out("Gifts & support", /\bgifts?\b|birthday|\bhbd\b|congrat|wedding|\bsupport\b|upkeep|pocket money|\bblessing|\bdonation|\btithe|\boffering|\bcharity\b|\bbilling\b|billed me/i, 0.66, "gift / support wording", "gift"),

  // Reimbursement wording (only after real category words had their chance, so "my share
  // for dinner" resolves as Food — the person's own consumption — not as a reimbursement).
  out("Reimbursements", REIMBURSEMENT_WORDS, 0.58, "settling up / sharing a cost", "settling_up"),
  out("Gifts & support", /\bthanks\b|thank you|appreciation/i, 0.5, "thank-you wording (may be a gift or support)", "gift"),
];

// ---------------------------------------------------------------------------
// INCOMING rules
// ---------------------------------------------------------------------------

const IN_RULES: Rule[] = [
  both("Refunds", /reversal|reversed|failed (transaction|transfer|txn|trx)|chargeback|\brev\s*[-/:]|\brev\s+(cr|dr)\b|\btxn rev\b/i, 0.85, "reversal", "reversal"),
  both("Refunds", /\brefund(ed|s)?\b/i, 0.8, "refund", "refund"),

  // Betting winnings/withdrawals are NOT income.
  both("Betting", BETTING_BRANDS, 0.93, "betting platform"),
  both("Betting", BETTING_WORDS, 0.85, "betting wording"),

  // Returns from a savings/investment product: interest is income, principal coming back isn't.
  inn("Income", /\b(interest|dividend|profit|returns)\b/i, 0.7, "investment interest / returns", "investment_income", (_c, t) =>
    SAVINGS_WORDS.test(t) || INVESTMENT_WORDS.test(t) || /\binterest\b|dividend/i.test(t)
  ),
  both("Transfers", OWEALTH, 0.92, "OPay OWealth pocket — money moved between your own wallet and its pocket, not saving", "wallet_pocket"),
  both("Investments", INVESTMENT_WORDS, 0.86, "investment platform/wording", "investment"),
  both("Savings", SAVINGS_WORDS, 0.86, "savings product", "savings"),

  both("Loans", LOAN_WORDS, 0.8, "loan wording"),

  // Payment-processor settlements are business receipts.
  inn("Income", /(paystack|flutterwave|moniepoint|monnify|pos|merchant)\b.*\b(settlement|payout)|\b(settlement|payout)\b.*(paystack|flutterwave|moniepoint|monnify|pos|merchant)/i, 0.8, "payment-processor settlement (business receipts)", "business"),

  inn("Income", /\bsalary\b|payroll|\bwages?\b|stipend|remuneration|pay\s?slip|\bbonus\b/i, 0.92, "salary / wages", "salary"),
  inn("Income", /\ballowance\b/i, 0.82, "allowance", "allowance"),
  inn("Income", /freelance|\binvoice\b|\bclient\b|consult|contract payment|\bproject\b|\bsales\b|\bcustomer\b|proceeds|\bcommission\b/i, 0.74, "work / business payment", "work"),
  inn("Income", /\brent(al)?\b|tenant/i, 0.62, "rental / property income", "rental"),

  // Gifts / support
  inn("Gifts & support", RELATIVE_WORDS, 0.66, "sender is a family member", "family_support"),
  inn("Gifts & support", /\bgifts?\b|birthday|\bhbd\b|congrat|wedding|\bsupport\b|upkeep|pocket money|\bblessing|\bdonation|\bbilling\b/i, 0.66, "gift / support wording", "gift"),

  // Reimbursement wording, then weaker signals
  inn("Reimbursements", REIMBURSEMENT_WORDS, 0.62, "paying back a shared cost", "shared_cost"),
  inn("Gifts & support", /\bthanks\b|thank you|appreciation/i, 0.5, "thank-you wording (may be a gift or support)", "gift"),
  inn("Reimbursements", SHARED_SPEND_WORDS, 0.52, "remark about a shared cost", "shared_cost"),
];

function search(rules: Rule[], ctx: SignalContext, text: string): SignalMatch | null {
  for (const rule of rules) {
    if (rule.dir !== "any" && rule.dir !== ctx.direction) continue;
    const m = rule.pattern.exec(text);
    if (!m) continue;
    if (rule.guard && !rule.guard(ctx, text)) continue;
    return {
      category: rule.category,
      confidence: rule.confidence,
      label: rule.label,
      fragment: m[0].trim(),
      subtype: rule.subtype ?? null,
    };
  }
  return null;
}

/** First matching rule for this transaction's direction, or null when nothing is recognized. */
export function matchSignal(text: string, ctx: SignalContext): SignalMatch | null {
  return search(ctx.direction === "in" ? IN_RULES : OUT_AND_SHARED_RULES, ctx, text);
}

/**
 * Generic fee/charge/VAT wording with no specific phrase behind it. Bank fees are small, so
 * this only counts when the amount is small and the line isn't a transfer to a person —
 * otherwise "school fees" or a ₦400,000 "service charge" would be called bank charges.
 */
export function isLikelyBankFee(text: string, ctx: SignalContext): boolean {
  if (ctx.direction !== "out") return false;
  if (ctx.amount > 10_000) return false;
  if (/(transfer|trf|nip)\s*(to|from)\s+[A-Za-z]{3,}/i.test(text)) return false;
  return /\b(charge|charges|fee|fees|vat|levy|commission|maintenance)\b/i.test(text);
}

export { RELATIVE_WORDS };
