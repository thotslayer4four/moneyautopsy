"use client";

import { useId, useMemo, useState } from "react";
import { AnimatePresence, m } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { formatNaira } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CategoryBreakdownEntry } from "@/lib/types";
import { CategoryIcon } from "./icons";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Named slices before the rest fold into "Everything else". Donuts read at a glance up to ~6. */
const MAX_NAMED = 5;
const REST_ID = "__rest";

// Rank 1 (biggest) to 5 use one accent hue; the neutral is reserved for the folded tail.
// Class names are written out in full so Tailwind can see them.
const RAMP = [
  { color: "var(--chart-1)", swatch: "bg-chart-1" },
  { color: "var(--chart-2)", swatch: "bg-chart-2" },
  { color: "var(--chart-3)", swatch: "bg-chart-3" },
  { color: "var(--chart-4)", swatch: "bg-chart-4" },
  { color: "var(--chart-5)", swatch: "bg-chart-5" },
];
const REST = { color: "var(--chart-rest)", swatch: "bg-chart-rest" };

// Geometry in SVG units. The viewBox is scaled to 224px, so a 2-unit gap renders as ~2px.
const VIEWBOX = 200;
const CENTER = VIEWBOX / 2;
const RADIUS = 84;
const THICKNESS = 24;
const ACTIVE_THICKNESS = 28;
const SLICE_GAP = 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Segment {
  id: string;
  label: string;
  total: number;
  share: number;
  color: string;
  swatch: string;
  entries: CategoryBreakdownEntry[];
}

/** What the pointer or keyboard is on: a whole slice, or one category inside "Everything else". */
interface Focus {
  segmentId: string;
  category?: string;
}

const isSame = (a: Focus | null, b: Focus) => a?.segmentId === b.segmentId && a?.category === b.category;

/** Readout icon: "Other" is the ellipsis, "Income" is the wallet, used for the folded slice and the total. */
function ReadoutIcon({ category }: { category: string }) {
  return <CategoryIcon category={category} size={16} className="text-accent" aria-hidden />;
}

function percent(share: number) {
  return share > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`;
}

function buildSegments(entries: CategoryBreakdownEntry[]): { segments: Segment[]; total: number } {
  const sorted = [...entries].sort((a, b) => b.total - a.total);
  const total = sorted.reduce((sum, e) => sum + e.total, 0);
  // A lone leftover category gets its own slice rather than a one-item "Everything else".
  const namedCount = sorted.length <= MAX_NAMED + 1 ? sorted.length : MAX_NAMED;

  const segments: Segment[] = sorted.slice(0, namedCount).map((e, i) => ({
    id: e.category,
    label: e.category,
    total: e.total,
    share: (e.total / total) * 100,
    ...(RAMP[i] ?? REST),
    entries: [e],
  }));

  const tail = sorted.slice(namedCount);
  if (tail.length > 0) {
    const tailTotal = tail.reduce((sum, e) => sum + e.total, 0);
    segments.push({
      id: REST_ID,
      label: "Everything else",
      total: tailTotal,
      share: (tailTotal / total) * 100,
      ...REST,
      entries: tail,
    });
  }
  return { segments, total };
}

export function SpendingDonut({ entries }: { entries: CategoryBreakdownEntry[] }) {
  const { segments, total } = useMemo(() => buildSegments(entries), [entries]);
  const [hover, setHover] = useState<Focus | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const restListId = useId();

  if (segments.length === 0 || total <= 0) return null;

  const focus = hover ?? pinned;
  const focusedSegment = segments.find((s) => s.id === focus?.segmentId);
  const focusedEntry = focus?.category ? focusedSegment?.entries.find((e) => e.category === focus.category) : undefined;

  const readout = focusedEntry
    ? { icon: <ReadoutIcon category={focusedEntry.category} />, label: focusedEntry.category, amount: focusedEntry.total, note: `${percent((focusedEntry.total / total) * 100)} of spent` }
    : focusedSegment
      ? { icon: <ReadoutIcon category={focusedSegment.id === REST_ID ? "Other" : focusedSegment.id} />, label: focusedSegment.label, amount: focusedSegment.total, note: `${percent(focusedSegment.share)} of spent` }
      : { icon: <ReadoutIcon category="Income" />, label: "Spent", amount: total, note: "Select a category" };
  const amountText = formatNaira(readout.amount);

  const gap = segments.length > 1 ? SLICE_GAP : 0;
  const starts = segments.reduce<number[]>((acc, seg, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + (segments[i - 1].share / 100) * CIRCUMFERENCE);
    return acc;
  }, []);

  function togglePin(target: Focus) {
    setPinned((current) => (isSame(current, target) ? null : target));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium text-foreground-secondary">Spent</p>

      <div className="grid grid-cols-1 items-center gap-8 sm:grid-cols-[auto_1fr]">
        <div className="relative mx-auto h-56 w-56 shrink-0">
          <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} aria-hidden className="h-full w-full">
            <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
              <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" strokeWidth={THICKNESS} className="stroke-border" />
              {segments.map((seg, i) => {
                const dash = Math.max((seg.share / 100) * CIRCUMFERENCE - gap, 0.01);
                const active = focus?.segmentId === seg.id;
                return (
                  <m.circle
                    key={seg.id}
                    cx={CENTER}
                    cy={CENTER}
                    r={RADIUS}
                    fill="none"
                    stroke={seg.color}
                    initial={{ strokeDasharray: `0 ${CIRCUMFERENCE}` }}
                    whileInView={{ strokeDasharray: `${dash} ${CIRCUMFERENCE - dash}` }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }}
                    style={{
                      strokeDashoffset: -starts[i],
                      strokeWidth: active ? ACTIVE_THICKNESS : THICKNESS,
                      opacity: focus && !active ? 0.4 : 1,
                      cursor: "pointer",
                    }}
                    className="transition-[stroke-width,opacity] duration-200"
                    onPointerEnter={() => setHover({ segmentId: seg.id })}
                    onPointerLeave={() => setHover(null)}
                    onClick={() => togglePin({ segmentId: seg.id })}
                  />
                );
              })}
            </g>
          </svg>

          <m.div
            key={focus ? `${focus.segmentId}|${focus.category ?? ""}` : "total"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            aria-hidden
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-8 text-center"
          >
            {readout.icon}
            <span className="line-clamp-2 text-xs text-foreground-muted">{readout.label}</span>
            <span className={cn("font-semibold tracking-tight tabular-nums", amountText.length > 10 ? "text-lg" : "text-xl")}>
              {amountText}
            </span>
            <span className="text-xs text-foreground-muted">{readout.note}</span>
          </m.div>
        </div>

        <ul className="flex flex-col gap-1">
          {segments.map((seg) => {
            const isRest = seg.id === REST_ID;
            const target: Focus = { segmentId: seg.id };
            return (
              <li key={seg.id}>
                <LegendRow
                  active={isSame(focus, target)}
                  pressed={isSame(pinned, target)}
                  expanded={isRest ? expanded : undefined}
                  controls={isRest ? restListId : undefined}
                  onFocusChange={(on) => setHover(on ? target : null)}
                  onClick={() => {
                    togglePin(target);
                    if (isRest) setExpanded((v) => !v);
                  }}
                >
                  <span aria-hidden className={cn("h-3 w-3 shrink-0 rounded-sm", seg.swatch)} />
                  <span className="min-w-0 flex-1 truncate font-medium">{seg.label}</span>
                  <span className="whitespace-nowrap tabular-nums text-foreground-muted">
                    {formatNaira(seg.total)} · {percent(seg.share)}
                  </span>
                  {isRest && (
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className={cn("shrink-0 text-foreground-muted transition-transform duration-200", expanded && "rotate-180")}
                    />
                  )}
                </LegendRow>

                {isRest && (
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <m.ul
                        id={restListId}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.35, ease: EASE }}
                        className="flex flex-col gap-1 overflow-hidden pl-8"
                      >
                        {seg.entries.map((e) => {
                          const nested: Focus = { segmentId: seg.id, category: e.category };
                          return (
                            <li key={e.category}>
                              <LegendRow
                                active={isSame(focus, nested)}
                                pressed={isSame(pinned, nested)}
                                onFocusChange={(on) => setHover(on ? nested : null)}
                                onClick={() => togglePin(nested)}
                              >
                                <span className="min-w-0 flex-1 truncate">{e.category}</span>
                                <span className="whitespace-nowrap tabular-nums text-foreground-muted">
                                  {formatNaira(e.total)} · {percent((e.total / total) * 100)}
                                </span>
                              </LegendRow>
                            </li>
                          );
                        })}
                      </m.ul>
                    )}
                  </AnimatePresence>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function LegendRow({
  active,
  pressed,
  expanded,
  controls,
  onFocusChange,
  onClick,
  children,
}: {
  active: boolean;
  pressed: boolean;
  expanded?: boolean;
  controls?: string;
  onFocusChange: (on: boolean) => void;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      onPointerEnter={() => onFocusChange(true)}
      onPointerLeave={() => onFocusChange(false)}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-colors duration-200",
        active ? "bg-accent-wash text-foreground" : "text-foreground-secondary hover:bg-foreground/[0.04]"
      )}
    >
      {children}
    </button>
  );
}
