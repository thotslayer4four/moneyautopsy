import { Fingerprint } from "lucide-react";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { PATTERN_ICONS } from "./icons";
import type { ClientReport } from "@/lib/types";

type UnlockedReport = Extract<ClientReport, { status: "unlocked" }>;

/**
 * The one inverted card in the report: near-black in light mode, off-white in dark, with an
 * accent glow. It's the personality reveal, so it should read differently from everything else.
 */
export function SpendingBehavior({
  personality,
  patterns,
}: {
  personality: UnlockedReport["moneyPersonality"];
  patterns: UnlockedReport["patterns"];
}) {
  return (
    <Card className="relative flex flex-col gap-8 border-transparent bg-foreground text-background">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/40 blur-3xl"
      />

      <div className="relative flex flex-col items-start gap-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-background/20 bg-background/10 px-4 py-2 text-xs font-medium text-background/80">
          <Fingerprint size={14} className="text-accent" aria-hidden />
          Your money personality
        </span>
        <div className="flex flex-col gap-4">
          <p className="text-balance text-4xl font-semibold tracking-tight">{personality.name}</p>
          <p className="max-w-prose text-base leading-7 text-background/70">{personality.description}</p>
        </div>
      </div>

      {patterns.length > 0 && (
        <ul className="relative flex flex-col gap-6 border-t border-background/15 pt-8">
          {patterns.map((p, i) => (
            <li key={i} className="flex max-w-prose items-start gap-4">
              <IconTile icon={PATTERN_ICONS[p.type]} className="bg-background/10" />
              <p className="min-w-0 pt-1 text-sm leading-6 text-background/70">
                <span className="block text-base font-medium text-background">{p.description}</span>
                {p.evidence}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
