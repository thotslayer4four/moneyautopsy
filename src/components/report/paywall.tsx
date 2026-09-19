"use client";

import { useState } from "react";
import { LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { LockedFinding } from "./locked-finding";
import { AUTOPSY_PRICE_NGN } from "@/lib/payments/pricing";
import { formatNaira } from "@/lib/format";
import type { ClientReport } from "@/lib/types";

export function Paywall({
  reportId,
  lockedFindingTitles,
  seenCount,
  onUnlocked,
}: {
  reportId: string;
  lockedFindingTitles: { id: string; title: string; category: string }[];
  seenCount: number;
  onUnlocked: (report: ClientReport) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalFound = seenCount + lockedFindingTitles.length;

  async function handleUnlock() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payment/checkout/${reportId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Payment failed to start.");

      if (json.mode === "unlocked") {
        onUnlocked(json.report as ClientReport);
      } else if (json.mode === "redirect" && json.url) {
        window.location.href = json.url;
      } else {
        throw new Error("Payment could not be started.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-8 border-t border-border pt-12">
      <div className="flex flex-col gap-4">
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Your money has more to say.
        </h2>
        <p className="text-pretty text-base leading-7 text-foreground-secondary">
          We found {totalFound} things worth showing you. You&apos;ve seen {seenCount}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {lockedFindingTitles.map((f) => (
          <LockedFinding key={f.id} title={f.title} category={f.category} />
        ))}
        <LockedFinding title="You were wrong about your biggest expense" category="Reality check" />
        <LockedFinding title="Your personal money plan" category="Plan" />
        <LockedFinding title="Shareable cards and a PDF to keep" category="Share" />
      </div>

      <Card className="flex flex-col items-center gap-4 text-center">
        <IconTile icon={LockOpen} />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground-secondary">Unlock your full money autopsy</p>
          <p className="text-xl font-semibold tracking-tight tabular-nums">{formatNaira(AUTOPSY_PRICE_NGN)}</p>
        </div>
        <Button size="lg" arrow glow onClick={handleUnlock} disabled={loading} className="w-full sm:w-auto">
          {loading ? "Unlocking..." : "See the full autopsy"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-foreground-muted">One-time payment · No subscription</p>
      </Card>
    </section>
  );
}
