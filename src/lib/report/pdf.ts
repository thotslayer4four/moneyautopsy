import fs from "fs/promises";
import path from "path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Report } from "@/lib/types";
import { formatDate, formatNaira } from "@/lib/format";
import { topKnownCategory } from "@/lib/analysis/helpers";
import { LOGO_MARK_PATH, SITE_DOMAIN } from "@/lib/brand";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

// The design-system tokens (globals.css, light mode), as PDF colors.
const hex = (value: string) => {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const INK = hex("#0b0b0b");
const MUTED = hex("#706f69");
const RULE = hex("#e4e4e2");
const ACCENT = hex("#15803d");
const TRACK = hex("#dcf1e5");
const SURFACE = hex("#fcfcfb");
const NEUTRAL_BAR = hex("#b3b2ab");

const NAIRA = "₦";

const INFLOW_LABELS: Record<string, string> = {
  Income: "Looks like income",
  "Gifts & support": "Gifts & support",
  Loans: "Borrowed money",
  Reimbursements: "Friends paying you back",
  Refunds: "Refunds & reversals",
  Transfers: "Moved from your own accounts",
  Savings: "Back from savings",
  Investments: "Back from investments",
  Betting: "Betting withdrawals",
  Uncertain: "Not yet explained",
  Other: "Other",
};

async function loadFont(file: string): Promise<Buffer> {
  return fs.readFile(path.join(process.cwd(), "src", "assets", "fonts", file));
}

/**
 * A small top-to-bottom layout engine over pdf-lib. Neither Liberation Sans nor the standard
 * PDF fonts contain the naira sign, so ₦ is drawn by hand — an "N" with two strokes through
 * it — and measured like an N so wrapping stays correct.
 */
class Doc {
  private pdf!: PDFDocument;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private page!: PDFPage;
  private y = 0;
  private supported!: Set<number>;

  static async create(): Promise<Doc> {
    const doc = new Doc();
    doc.pdf = await PDFDocument.create();
    doc.pdf.registerFontkit(fontkit);
    doc.regular = await doc.pdf.embedFont(await loadFont("LiberationSans-Regular.ttf"), { subset: true });
    doc.bold = await doc.pdf.embedFont(await loadFont("LiberationSans-Bold.ttf"), { subset: true });
    doc.supported = new Set(doc.regular.getCharacterSet());
    doc.newPage();
    return doc;
  }

  get pages() {
    return this.pdf.getPages();
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 24) this.newPage();
  }

  space(amount: number) {
    this.y -= amount;
  }

  /** Replaces characters the font can't draw (e.g. exotic dashes, arrows, emoji). */
  private clean(text: string): string {
    return Array.from(text)
      .map((ch) => {
        const cp = ch.codePointAt(0)!;
        if (ch === "₦" || this.supported.has(cp) || ch === " ") return ch;
        if (ch === "‑" || ch === "‐") return "-";
        if (ch === "→") return "->";
        if (ch === "≈") return "~";
        return cp > 0x2000 ? "" : "?";
      })
      .join("");
  }

  private width(text: string, font: PDFFont, size: number): number {
    return text.split(NAIRA).reduce((sum, part, i) => sum + (i > 0 ? font.widthOfTextAtSize("N", size) : 0) + font.widthOfTextAtSize(part, size), 0);
  }

  private drawRun(text: string, x: number, y: number, font: PDFFont, size: number, color: RGB) {
    const parts = text.split(NAIRA);
    let cx = x;
    parts.forEach((part, i) => {
      if (i > 0) {
        const nWidth = font.widthOfTextAtSize("N", size);
        this.page.drawText("N", { x: cx, y, size, font, color });
        for (const rise of [0.27, 0.45]) {
          this.page.drawLine({
            start: { x: cx - size * 0.05, y: y + size * rise },
            end: { x: cx + nWidth + size * 0.05, y: y + size * rise },
            thickness: Math.max(0.6, size * 0.06),
            color,
          });
        }
        cx += nWidth;
      }
      if (part) {
        this.page.drawText(part, { x: cx, y, size, font, color });
        cx += font.widthOfTextAtSize(part, size);
      }
    });
  }

  private wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of this.clean(text).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (this.width(test, font, size) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** Draws wrapped text at the cursor and moves down. */
  text(
    text: string,
    opts: { size?: number; bold?: boolean; color?: RGB; indent?: number; gap?: number; width?: number } = {}
  ) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.regular;
    const x = MARGIN + (opts.indent ?? 0);
    const lineHeight = size * 1.45;
    const lines = this.wrap(text, font, size, (opts.width ?? CONTENT_W) - (opts.indent ?? 0));
    for (const line of lines) {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      this.drawRun(line, x, this.y + size * 0.28, font, size, opts.color ?? INK);
    }
    this.y -= opts.gap ?? 0;
  }

  /** The wordmark and domain, top of the first page. */
  brand() {
    this.y -= 12;
    // drawSvgPath treats (x, y) as the top-left of the 64-unit grid; the mark itself spans 6–58.
    const markScale = 0.28;
    this.page.drawSvgPath(LOGO_MARK_PATH, { x: MARGIN - 6 * markScale, y: this.y + 4 + 32 * markScale, scale: markScale, color: ACCENT });
    this.page.drawText("Money autopsy", { x: MARGIN + 21, y: this.y, size: 11, font: this.bold, color: INK });
    const width = this.bold.widthOfTextAtSize(SITE_DOMAIN, 10);
    this.page.drawText(SITE_DOMAIN, { x: PAGE_W - MARGIN - width, y: this.y, size: 10, font: this.bold, color: ACCENT });
    this.y -= 16;
  }

  heading(index: string, title: string) {
    this.ensure(70);
    this.space(28);
    this.text(index, { size: 9, color: ACCENT, bold: true });
    this.text(title, { size: 17, bold: true, gap: 6 });
    this.rule();
    this.space(6);
  }

  rule() {
    this.ensure(6);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.6, color: RULE });
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + 32, y: this.y }, thickness: 1.8, color: ACCENT });
  }

  /** Label on the left, value on the right, with an optional proportional bar underneath. */
  row(label: string, value: string, fraction?: number, muted = false) {
    this.ensure(fraction === undefined ? 20 : 30);
    this.y -= 16;
    const size = 10.5;
    this.drawRun(this.clean(label), MARGIN, this.y, this.regular, size, INK);
    const w = this.width(this.clean(value), this.regular, size);
    this.drawRun(this.clean(value), PAGE_W - MARGIN - w, this.y, this.regular, size, MUTED);
    if (fraction !== undefined) {
      this.y -= 9;
      this.page.drawRectangle({ x: MARGIN, y: this.y, width: CONTENT_W, height: 4, color: TRACK });
      this.page.drawRectangle({ x: MARGIN, y: this.y, width: Math.max(2, CONTENT_W * Math.min(1, fraction)), height: 4, color: muted ? NEUTRAL_BAR : ACCENT });
      this.y -= 5;
    }
  }

  /** Big figures side by side, each in its own tile. */
  stats(items: { label: string; value: string }[]) {
    this.space(6);
    const gap = 8;
    const height = 58;
    this.ensure(height + 8);
    const colW = (CONTENT_W - gap * (items.length - 1)) / items.length;
    const top = this.y;
    items.forEach((item, i) => {
      const x = MARGIN + i * (colW + gap);
      this.page.drawRectangle({ x, y: top - height, width: colW, height, color: SURFACE, borderColor: RULE, borderWidth: 0.8 });
      this.drawRun(this.clean(item.label), x + 12, top - 18, this.regular, 8.5, MUTED);
      this.drawRun(this.clean(item.value), x + 12, top - 42, this.bold, 15, INK);
    });
    this.y = top - height - 8;
  }

  /** A quiet chart of closing balances with the "running dry" line. */
  sparkline(series: { balance: number }[], floor: number) {
    if (series.length < 3) return;
    const height = 70;
    this.ensure(height + 16);
    const bottom = this.y - height;
    const max = Math.max(...series.map((p) => p.balance), floor * 2);
    const min = Math.min(0, ...series.map((p) => p.balance));
    const px = (i: number) => MARGIN + (i / (series.length - 1)) * CONTENT_W;
    const py = (v: number) => bottom + ((v - min) / (max - min || 1)) * height;
    this.page.drawLine({ start: { x: MARGIN, y: py(floor) }, end: { x: PAGE_W - MARGIN, y: py(floor) }, thickness: 0.6, color: MUTED, dashArray: [3, 3] });
    for (let i = 1; i < series.length; i++) {
      this.page.drawLine({ start: { x: px(i - 1), y: py(series[i - 1].balance) }, end: { x: px(i), y: py(series[i].balance) }, thickness: 1.4, color: ACCENT });
    }
    this.y = bottom - 10;
  }

  footer() {
    const pages = this.pages;
    pages.forEach((page, i) => {
      page.drawLine({ start: { x: MARGIN, y: 42 }, end: { x: PAGE_W - MARGIN, y: 42 }, thickness: 0.6, color: RULE });
      page.drawText(SITE_DOMAIN, { x: MARGIN, y: 28, size: 8.5, font: this.bold, color: ACCENT });
      const domainWidth = this.bold.widthOfTextAtSize(SITE_DOMAIN, 8.5);
      page.drawText(`  ·  Page ${i + 1} of ${pages.length}`, { x: MARGIN + domainWidth, y: 28, size: 8, font: this.regular, color: MUTED });
      const note = "Educational insights from your statement — not financial advice.";
      page.drawText(note, { x: PAGE_W - MARGIN - this.regular.widthOfTextAtSize(note, 8), y: 28, size: 8, font: this.regular, color: MUTED });
    });
  }

  async save(): Promise<Uint8Array> {
    this.footer();
    return this.pdf.save();
  }
}

/** Renders the full (paid) report as a PDF. Only ever called for an unlocked session. */
export async function generateReportPdf(report: Report): Promise<Uint8Array> {
  const doc = await Doc.create();
  const n = formatNaira;
  let section = 0;
  const next = () => String(++section).padStart(2, "0");

  doc.brand();
  doc.space(20);
  doc.text(`${formatDate(report.overview.periodStart)} — ${formatDate(report.overview.periodEnd)}`, { size: 10, color: MUTED });
  doc.text("Your money autopsy", { size: 26, bold: true, gap: 4 });

  // 01 — the damage
  doc.heading(next(), "The damage");
  doc.stats([
    { label: "Money in", value: n(report.overview.totalInflow) },
    { label: "Money out", value: n(report.overview.totalOutflow) },
    { label: "Actually spent", value: n(report.overview.spent) },
  ]);
  doc.text("Money out includes savings, loans and transfers between your own accounts. Only the “actually spent” figure counts as consumption.", { size: 9, color: MUTED, gap: 8 });
  if (report.inflowBreakdown.length > 0) {
    doc.text("What the money coming in actually was", { bold: true, gap: 2 });
    for (const e of report.inflowBreakdown) doc.row(INFLOW_LABELS[e.category] ?? e.category, `${n(e.total)} · ${Math.round(e.percentOfInflow)}%`);
    doc.space(6);
    doc.text(`${n(report.overview.totalInflow)} was credited, but only ${n(report.overview.earnedIncome)} has evidence of being earnings.`, { size: 9, color: MUTED, gap: 6 });
  }
  if (report.highlights.length > 0) {
    doc.text("Numbers worth knowing", { bold: true, gap: 2 });
    for (const h of report.highlights) {
      doc.row(h.label, h.value);
      doc.text(h.note, { size: 8.5, color: MUTED, gap: h.tagline ? 0 : 2 });
      if (h.tagline) doc.text(h.tagline, { size: 9.5, bold: true, color: ACCENT, gap: 4 });
    }
  }
  if (report.balance) {
    doc.space(10);
    doc.text("Your balance over time", { bold: true, gap: 4 });
    doc.sparkline(report.balance.series, report.balance.floor);
    doc.text(
      `Lowest ${n(report.balance.lowest.balance)} on ${formatDate(report.balance.lowest.date)}; under ${n(report.balance.floor)} on ${report.balance.daysBelowFloor} of ${report.balance.daysTracked} days.` +
        (report.balance.runway ? ` After money arrives, most of it is gone in about ${report.balance.runway.medianDays} days.` : ""),
      { size: 9, color: MUTED }
    );
  }

  // 02 — categories
  doc.heading(next(), "Where your money actually went");
  const max = report.categoryBreakdown[0]?.total ?? 0;
  const groups: [string, typeof report.categoryBreakdown][] = [
    ["Spent", report.categoryBreakdown.filter((c) => c.kind === "spend" || c.kind === "support")],
    ["Moved, not spent", report.categoryBreakdown.filter((c) => c.kind === "moved")],
    ["Not yet explained", report.categoryBreakdown.filter((c) => c.kind === "uncertain")],
  ];
  for (const [title, entries] of groups) {
    if (entries.length === 0) continue;
    doc.space(4);
    doc.text(title, { bold: true, gap: 2 });
    for (const e of entries) doc.row(e.category, `${n(e.total)} · ${Math.round(e.percentOfOutflow)}%`, max > 0 ? e.total / max : 0, title !== "Spent");
  }

  // 03 — findings
  const findings = report.freeFinding ? [report.freeFinding, ...report.lockedFindings] : report.lockedFindings;
  if (findings.length > 0) {
    doc.heading(next(), "What we found");
    for (const f of findings) {
      doc.ensure(70);
      doc.text(f.title, { size: 12.5, bold: true, gap: 2 });
      doc.text(f.summary, { color: MUTED, gap: 2 });
      doc.text(f.detail, { gap: 12 });
    }
  }

  // 04 — biggest leak
  const top = topKnownCategory(report.categoryBreakdown);
  if (top) {
    doc.heading(next(), "Your biggest leak");
    doc.text(top.category, { size: 12, bold: true });
    doc.text(n(top.total), { size: 24, bold: true, gap: 2 });
    doc.text(`${Math.round(top.percentOfOutflow)}% of everything that left your account, across ${top.transactionCount} transactions.`, { color: MUTED });
  }

  // 05 — belief
  doc.heading(next(), "You told us...");
  doc.text("You thought", { size: 9, color: MUTED });
  doc.text(`“${report.userBeliefComparison.whatTheyThought}”`, { bold: true, gap: 6 });
  doc.text("The data shows", { size: 9, color: MUTED });
  doc.text(report.userBeliefComparison.whatDataShows, { gap: 6 });
  doc.text(report.userBeliefComparison.explanation, { bold: true });

  // 06 — behavior
  doc.heading(next(), "Your spending behavior");
  doc.text(report.moneyPersonality.name, { size: 13, bold: true, gap: 2 });
  doc.text(report.moneyPersonality.description, { color: MUTED, gap: 8 });
  for (const p of report.patterns) doc.text(`${p.description} ${p.evidence}`, { gap: 4 });

  // 07 — recommendations
  if (report.recommendations.length > 0) {
    doc.heading(next(), "What you could change");
    for (const r of report.recommendations) {
      doc.ensure(50);
      doc.text(r.estimatedMonthlyImpact > 0 ? `${r.title}  (~${n(r.estimatedMonthlyImpact)}/mo)` : r.title, { bold: true, gap: 2 });
      doc.text(r.description, { color: MUTED, gap: 10 });
    }
  }

  // 08 — reset
  if (report.thirtyDayReset.length > 0) {
    doc.heading(next(), "Your 30-day money reset");
    report.thirtyDayReset.forEach((step, i) => doc.text(`${i + 1}.  ${step}`, { indent: 4, gap: 4 }));
  }

  return doc.save();
}
