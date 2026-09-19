"use client";

import { useEffect, useRef, useState } from "react";
import { Download, EyeOff, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SITE_DOMAIN } from "@/lib/brand";
import { Callout } from "@/components/ui/callout";
import { canvasToBlob, CARD_HEIGHT, CARD_WIDTH, drawShareCard } from "@/lib/share/drawCard";
import type { ShareCard } from "@/lib/types";

const SHARE_TEXT = `My money autopsy — get yours at ${SITE_DOMAIN}`;

export function ShareCards({ cards }: { cards: ShareCard[] }) {
  const [hideAmounts, setHideAmounts] = useState(false);
  // Rendered only after the report has loaded in the browser, so reading navigator here is safe.
  const [canShare] = useState(
    () => typeof navigator !== "undefined" && typeof File !== "undefined" && !!navigator.canShare?.({ files: [new File([], "probe.png", { type: "image/png" })] })
  );
  const canvases = useRef(new Map<string, HTMLCanvasElement>());

  useEffect(() => {
    let cancelled = false;
    // Wait for the app's fonts so the cards use them, not a fallback.
    document.fonts.ready.then(() => {
      if (cancelled) return;
      for (const card of cards) {
        const canvas = canvases.current.get(card.id);
        if (canvas) drawShareCard(canvas, card, { hideAmounts });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [cards, hideAmounts]);

  async function download(card: ShareCard) {
    const canvas = canvases.current.get(card.id);
    const blob = canvas ? await canvasToBlob(canvas) : null;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `money-autopsy-${card.id}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function share(card: ShareCard) {
    const canvas = canvases.current.get(card.id);
    const blob = canvas ? await canvasToBlob(canvas) : null;
    if (!blob) return;
    const file = new File([blob], `money-autopsy-${card.id}.png`, { type: "image/png" });
    try {
      await navigator.share({ files: [file], text: SHARE_TEXT });
    } catch {
      // Dismissing the share sheet throws; nothing to do.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Callout icon={<EyeOff size={16} className="shrink-0 text-accent" aria-hidden />}>
        Cards show numbers and counts only — never names, merchants or account details, and each one carries {SITE_DOMAIN}.
        Hide the naira amounts if you&apos;d rather share the story than the figures.
      </Callout>

      <Button
        variant="secondary"
        aria-pressed={hideAmounts}
        onClick={() => setHideAmounts((v) => !v)}
        className="self-start"
      >
        <EyeOff size={18} aria-hidden />
        {hideAmounts ? "Amounts hidden" : "Hide amounts"}
      </Button>

      <ul className="-mx-4 flex snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0">
        {cards.map((card) => (
          <li key={card.id} className="flex w-72 shrink-0 snap-center flex-col gap-4 sm:w-auto">
            <canvas
              ref={(el) => {
                if (el) canvases.current.set(card.id, el);
                else canvases.current.delete(card.id);
              }}
              width={CARD_WIDTH}
              height={CARD_HEIGHT}
              role="img"
              aria-label={`${card.kicker}: ${card.big} ${card.label}`}
              className="aspect-[4/5] w-full rounded-3xl border border-border-strong"
            />
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => download(card)}>
                <Download size={18} aria-hidden />
                Download
              </Button>
              {canShare && (
                <Button variant="ghost" onClick={() => share(card)}>
                  <Share2 size={18} aria-hidden />
                  Share
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
