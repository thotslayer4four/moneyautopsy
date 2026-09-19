import { Card } from "@/components/ui/card";
import { formatDate, formatNaira } from "@/lib/format";
import type { BalanceInsights } from "@/lib/types";

const WIDTH = 600;
const HEIGHT = 160;
const PAD = 8;

/** Closing balance per day, with the "running dry" line and the lowest point marked. */
export function BalanceChart({ balance }: { balance: BalanceInsights }) {
  const { series, floor, lowest } = balance;
  if (series.length < 3) return null;

  const max = Math.max(...series.map((p) => p.balance), floor * 2);
  const min = Math.min(0, ...series.map((p) => p.balance));
  const x = (i: number) => PAD + (i / (series.length - 1)) * (WIDTH - PAD * 2);
  const y = (v: number) => HEIGHT - PAD - ((v - min) / (max - min || 1)) * (HEIGHT - PAD * 2);

  const points = series.map((p, i) => `${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(" ");
  const lowIndex = series.findIndex((p) => p.date === lowest.date);
  const summary = `Balance from ${formatDate(series[0].date)} to ${formatDate(series[series.length - 1].date)}. Lowest ${formatNaira(lowest.balance)} on ${formatDate(lowest.date)}; under ${formatNaira(floor)} on ${balance.daysBelowFloor} of ${balance.daysTracked} days.`;

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold tracking-tight">Your balance over time</h3>
        <p className="max-w-prose text-sm leading-6 text-foreground-secondary">
          {balance.runway
            ? `After money arrives, most of it is gone in about ${balance.runway.medianDays} days.`
            : `Your balance averaged ${formatNaira(balance.averageClosing)}.`}{" "}
          The dashed line is {formatNaira(floor)} — under it, you&apos;re running dry.
        </p>
      </div>
      <svg role="img" aria-label={summary} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-40 w-full overflow-visible">
        <line
          x1={PAD}
          x2={WIDTH - PAD}
          y1={y(floor)}
          y2={y(floor)}
          className="stroke-foreground-muted"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <polyline points={points} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {lowIndex >= 0 && <circle cx={x(lowIndex)} cy={y(lowest.balance)} r={4} className="fill-accent" />}
      </svg>
      <div className="flex flex-wrap items-baseline justify-between gap-3 text-xs tabular-nums text-foreground-muted">
        <span>{formatDate(series[0].date)}</span>
        <span>
          Lowest {formatNaira(lowest.balance)} · {formatDate(lowest.date)}
        </span>
        <span>{formatDate(series[series.length - 1].date)}</span>
      </div>
    </Card>
  );
}
