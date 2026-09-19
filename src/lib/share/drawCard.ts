import type { ShareCard } from "@/lib/types";
import { LOGO_MARK_PATH, SITE_DOMAIN } from "@/lib/brand";

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

/**
 * The share cards keep their own loud palette on purpose: they're made to be posted, so they
 * stand apart from the app's quiet design system. Each theme is a background, the text colour
 * on it, and one accent for the big number (and the logo mark).
 */
const THEMES: Record<ShareCard["theme"], { bg: string; ink: string; accent: string }> = {
  hot: { bg: "#D7263D", ink: "#FFF6EE", accent: "#FFD166" },
  win: { bg: "#22C55E", ink: "#04130A", accent: "#052E16" },
  signal: { bg: "#3B5BFF", ink: "#FFFFFF", accent: "#C8FF3D" },
  amber: { bg: "#FFB020", ink: "#1A1200", accent: "#3D2A00" },
  warm: { bg: "#FF6B4A", ink: "#1F0B04", accent: "#3A0E02" },
  ink: { bg: "#0E0E12", ink: "#F5F1E8", accent: "#C8FF3D" },
};

type Theme = (typeof THEMES)[ShareCard["theme"]];

// Layout, on the 4/8/12/16/24/32/48/64/96 scale (in card pixels).
const MARGIN = 96;
const CONTENT_WIDTH = CARD_WIDTH - MARGIN * 2;
const SECTION_GAP = 48;
const NAIRA = "₦";
const MASK = "₦•••••";

export const maskAmounts = (text: string) => text.replace(/₦[\d,]+(\.\d+)?/g, MASK);

function fontStack(): string {
  if (typeof document === "undefined") return "sans-serif";
  return getComputedStyle(document.body).fontFamily || "sans-serif";
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Text helper that draws the naira sign by hand. Geist has no ₦ glyph, so the canvas would fall
 * back to a different system font on every phone; an N with two bars through it looks the same
 * everywhere and is measured like an N so wrapping stays right.
 */
class Painter {
  private size = 16;
  private weight = 400;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private family: string
  ) {}

  font(weight: number, size: number) {
    this.weight = weight;
    this.size = size;
    this.ctx.font = `${weight} ${size}px ${this.family}`;
  }

  /** Horizontal room the sign takes: an N, a little overhang each side for the bars, and a hair of tracking. */
  private nairaAdvance(): number {
    return this.ctx.measureText("N").width + this.size * 0.12;
  }

  width(text: string): number {
    return text.split(NAIRA).reduce((sum, part, i) => sum + (i > 0 ? this.nairaAdvance() : 0) + this.ctx.measureText(part).width, 0);
  }

  text(text: string, x: number, baseline: number) {
    const { ctx, size } = this;
    let cx = x;
    text.split(NAIRA).forEach((part, i) => {
      if (i > 0) {
        const nWidth = ctx.measureText("N").width;
        const overhang = size * 0.05;
        const thickness = Math.max(2, size * (this.weight >= 600 ? 0.05 : 0.04));
        ctx.fillText("N", cx + overhang, baseline);
        for (const rise of [0.27, 0.43]) {
          ctx.fillRect(cx, baseline - size * rise - thickness / 2, nWidth + overhang * 2, thickness);
        }
        cx += this.nairaAdvance();
      }
      if (part) {
        ctx.fillText(part, cx, baseline);
        cx += ctx.measureText(part).width;
      }
    });
  }

  /** Splits text over two lines as evenly as possible, so a quip never strands one short word. */
  balanceInTwo(text: string, maxWidth: number): string[] | null {
    const words = text.split(/\s+/).filter(Boolean);
    let best: { lines: string[]; widest: number } | null = null;
    for (let i = 1; i < words.length; i++) {
      const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
      const widest = Math.max(this.width(lines[0]), this.width(lines[1]));
      if (widest <= maxWidth && (!best || widest < best.widest)) best = { lines, widest };
    }
    return best?.lines ?? null;
  }

  wrap(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (this.width(test) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground(ctx: CanvasRenderingContext2D, theme: Theme) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // A large soft circle for depth — one shape, no gradient.
  ctx.fillStyle = withAlpha(theme.ink, 0.1);
  ctx.beginPath();
  ctx.arc(CARD_WIDTH - 40, 120, 340, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws one share card onto a canvas at full 1080×1350 resolution. */
export function drawShareCard(canvas: HTMLCanvasElement, card: ShareCard, options: { hideAmounts: boolean }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;

  const theme = THEMES[card.theme];
  const muted = withAlpha(theme.ink, 0.8);
  const p = new Painter(ctx, fontStack());
  const hide = options.hideAmounts;
  const text = (s: string) => (hide ? maskAmounts(s) : s);

  drawBackground(ctx, theme);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // ---- Header: brand on the left, period on the right ----
  const headerBaseline = MARGIN + 32;
  // The logo mark occupies 6–58 of its 64-unit grid, so shift by 6 to sit its edge on the margin.
  const markSize = 34;
  const markScale = markSize / 52;
  ctx.save();
  ctx.translate(MARGIN - 6 * markScale, headerBaseline - 29 - 6 * markScale);
  ctx.scale(markScale, markScale);
  ctx.fillStyle = theme.accent;
  ctx.fill(new Path2D(LOGO_MARK_PATH));
  ctx.restore();
  ctx.fillStyle = theme.ink;
  p.font(600, 36);
  p.text("Money autopsy", MARGIN + markSize + 12, headerBaseline);
  if (card.period) {
    ctx.fillStyle = muted;
    p.font(500, 30);
    p.text(card.period, CARD_WIDTH - MARGIN - p.width(card.period), headerBaseline);
  }

  // ---- Footer: the domain, always visible, even when amounts are hidden ----
  const footerBaseline = CARD_HEIGHT - MARGIN;
  ctx.fillStyle = withAlpha(theme.ink, 0.18);
  ctx.fillRect(MARGIN, footerBaseline - 72, CONTENT_WIDTH, 2);
  ctx.fillStyle = theme.ink;
  p.font(700, 44);
  p.text(SITE_DOMAIN, MARGIN, footerBaseline);
  ctx.fillStyle = muted;
  p.font(500, 30);
  const cta = "Get yours";
  p.text(cta, CARD_WIDTH - MARGIN - p.width(cta), footerBaseline);

  // ---- Measure the middle so nothing can collide, then centre it in the space between ----
  const big = hide && card.bigMasked ? card.bigMasked : text(card.big);
  let bigSize = 240;
  p.font(700, bigSize);
  while (p.width(big) > CONTENT_WIDTH && bigSize > 80) {
    bigSize -= 8;
    p.font(700, bigSize);
  }
  p.font(600, 60);
  const labelLines = p.wrap(text(card.label), CONTENT_WIDTH);
  p.font(500, 40);
  const detailLines = card.lines.flatMap((raw) => p.wrap(text(raw), CONTENT_WIDTH));

  const PILL_HEIGHT = 72;
  const LABEL_LEADING = 72;
  const DETAIL_LEADING = 56;
  const BIG_TO_LABEL = 48; // clears the comma's descender
  const bigHeight = Math.round(bigSize * 0.72);
  const heroHeight =
    PILL_HEIGHT + SECTION_GAP + bigHeight + BIG_TO_LABEL + labelLines.length * LABEL_LEADING + (detailLines.length ? 24 + detailLines.length * DETAIL_LEADING : 0);

  // The quip is the shareable line: the biggest size that keeps it on one line, else the
  // biggest that fits two evenly balanced lines.
  const taglineWidth = CONTENT_WIDTH - 96;
  let taglineSize = 52;
  let taglineLines: string[] = [];
  if (card.tagline) {
    const sizes = [80, 72, 64, 56, 52];
    const single = sizes.find((size) => {
      p.font(700, size);
      return p.width(card.tagline!) <= taglineWidth;
    });
    if (single) {
      taglineSize = single;
      taglineLines = [card.tagline];
    } else {
      const twoLine = sizes.find((size) => {
        p.font(700, size);
        return p.balanceInTwo(card.tagline!, taglineWidth) !== null;
      });
      taglineSize = twoLine ?? 52;
      p.font(700, taglineSize);
      taglineLines = (twoLine && p.balanceInTwo(card.tagline, taglineWidth)) || p.wrap(card.tagline, taglineWidth);
    }
  }
  const taglineLeading = Math.round(taglineSize * 1.27);
  const panelHeight = taglineLines.length ? taglineLines.length * taglineLeading + 64 : 0;

  const top = headerBaseline + SECTION_GAP;
  const footerRule = footerBaseline - 72;
  const panelTop = footerRule - SECTION_GAP - panelHeight;
  const regionBottom = (panelHeight ? panelTop : footerRule) - SECTION_GAP;
  let y = top + Math.max(0, (regionBottom - top - heroHeight) * 0.45);

  // Kicker pill
  p.font(600, 32);
  const pillWidth = p.width(card.kicker) + 64;
  roundedRect(ctx, MARGIN, y, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2);
  ctx.fillStyle = withAlpha(theme.ink, 0.1);
  ctx.fill();
  ctx.strokeStyle = withAlpha(theme.ink, 0.22);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = theme.ink;
  p.text(card.kicker, MARGIN + 32, y + 47);
  y += PILL_HEIGHT + SECTION_GAP;

  // The big number
  ctx.fillStyle = theme.accent;
  p.font(700, bigSize);
  y += bigHeight;
  p.text(big, MARGIN, y);
  y += BIG_TO_LABEL;

  // Label
  ctx.fillStyle = theme.ink;
  p.font(600, 60);
  for (const line of labelLines) {
    y += LABEL_LEADING;
    p.text(line, MARGIN, y - 16);
  }

  // Supporting lines
  if (detailLines.length) {
    ctx.fillStyle = muted;
    p.font(500, 40);
    y += 24;
    for (const line of detailLines) {
      y += DETAIL_LEADING;
      p.text(line, MARGIN, y - 12);
    }
  }

  // The quip, as the loud block, pinned above the footer
  if (taglineLines.length) {
    roundedRect(ctx, MARGIN, panelTop, CONTENT_WIDTH, panelHeight, 48);
    ctx.fillStyle = theme.ink;
    ctx.fill();
    ctx.fillStyle = theme.bg;
    p.font(700, taglineSize);
    taglineLines.forEach((line, i) => p.text(line, MARGIN + 48, panelTop + 32 + taglineLeading * (i + 1) - Math.round(taglineSize * 0.3)));
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}
