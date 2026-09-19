"use client";

import { useRef, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Button } from "@/components/ui/button";

/** `blurb` is what the previous tab's "Up next" footer says this one is about. */
export const REPORT_TABS = [
  { id: "summary", label: "Summary", blurb: "The short version" },
  { id: "money", label: "Money", blurb: "Where your money went, and where it came from" },
  { id: "insights", label: "Insights", blurb: "What we found, and what it says about you" },
  { id: "plan", label: "Plan", blurb: "What to do about it" },
  { id: "share", label: "Share", blurb: "Post it, or take it with you" },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]["id"];

export const isReportTab = (value: string): value is ReportTab => REPORT_TABS.some((t) => t.id === value);

/**
 * The report is split into five groups so only one is on screen at a time. A panel is built the
 * first time it's opened (so a phone isn't drawing charts and share cards nobody has asked for),
 * and after that it stays mounted, just hidden, so nothing loses its state when you switch tabs.
 */
export function ReportTabs({
  value,
  onValueChange,
  panels,
}: {
  value: ReportTab;
  onValueChange: (tab: ReportTab) => void;
  panels: Record<ReportTab, React.ReactNode>;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState<ReadonlySet<ReportTab>>(() => new Set([value]));
  // Adjusting state while rendering is the supported way to react to a prop changing (for example
  // a #plan link opening straight onto that tab).
  if (!opened.has(value)) setOpened(new Set(opened).add(value));

  function change(next: ReportTab) {
    onValueChange(next);
    // Once the tab bar has stuck to the top, a new panel should start at its top, not mid-page.
    const top = anchor.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollTo({ top: window.scrollY + top, behavior: "smooth" });
  }

  return (
    <Tabs.Root value={value} onValueChange={(next) => change(next as ReportTab)} className="flex flex-col">
      <div ref={anchor} />
      <Tabs.List className="sticky top-0 z-20 flex gap-6 border-b border-border bg-background/90 backdrop-blur">
        {REPORT_TABS.map((tab) => (
          <Tabs.Tab
            key={tab.id}
            value={tab.id}
            className="relative flex min-h-12 shrink-0 cursor-pointer items-center text-sm font-medium text-foreground-secondary transition-colors duration-200 hover:text-foreground data-[active]:text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent after:opacity-0 after:transition-opacity after:duration-200 data-[active]:after:opacity-100"
          >
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {REPORT_TABS.map((tab, i) => {
        const next = REPORT_TABS[i + 1];
        return (
          <Tabs.Panel key={tab.id} value={tab.id} keepMounted className="flex flex-col gap-16 pt-12">
            {opened.has(tab.id) ? panels[tab.id] : null}
            {/* Most people won't go looking for the next tab, so each one ends by handing them on. */}
            <div className="flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
              {next ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-foreground-muted">Up next</span>
                    <span className="text-base font-medium">{next.blurb}</span>
                  </div>
                  <Button size="lg" arrow glow onClick={() => change(next.id)}>
                    {next.label}
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-foreground-muted">That&apos;s everything</span>
                    <span className="text-base font-medium">Back to the short version</span>
                  </div>
                  <Button size="lg" variant="secondary" onClick={() => change("summary")}>
                    Summary
                  </Button>
                </>
              )}
            </div>
          </Tabs.Panel>
        );
      })}
    </Tabs.Root>
  );
}
