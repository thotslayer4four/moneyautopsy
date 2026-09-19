"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { m, AnimatePresence } from "framer-motion";
import {
  ArrowLeftRight,
  CircleAlert,
  CircleCheck,
  FileText,
  PenLine,
  Scale,
  ScanSearch,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Container } from "@/components/layout/container";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { IconTile } from "@/components/ui/icon-tile";
import { LoadingQuips } from "@/components/ui/loading-quips";
import { Spinner } from "@/components/ui/spinner";
import { useAutopsyStore } from "@/lib/store";
import { MAX_UPLOAD_LABEL } from "@/lib/upload";
import type { ExtractionIssue } from "@/lib/types";

const STAGES: { text: string; icon: LucideIcon }[] = [
  { text: "Reading your statement...", icon: FileText },
  { text: "Finding your transactions...", icon: Search },
  { text: "Figuring out where the money went...", icon: ArrowLeftRight },
  { text: "Looking for patterns...", icon: ScanSearch },
  { text: "Checking what you thought you spent too much on...", icon: Scale },
  { text: "Writing up the evidence...", icon: PenLine },
];

const STAGE_INTERVAL_MS = 1400;

export default function ProcessingPage() {
  const router = useRouter();
  const profile = useAutopsyStore((s) => s.profile);
  const pendingFile = useAutopsyStore((s) => s.pendingFile);
  const setReportId = useAutopsyStore((s) => s.setReportId);
  const setReport = useAutopsyStore((s) => s.setReport);

  const [stageIndex, setStageIndex] = useState(0);
  const [error, setError] = useState<{ message: string; issues?: ExtractionIssue[] } | null>(null);
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!pendingFile) {
      router.replace("/upload");
      return;
    }
    if (started.current) return;
    started.current = true;

    const stageTimer = setInterval(() => {
      setStageIndex((i) => Math.min(i + 1, STAGES.length - 1));
    }, STAGE_INTERVAL_MS);

    async function run() {
      try {
        const formData = new FormData();
        formData.append("file", pendingFile!);
        formData.append("profile", JSON.stringify(profile));

        const res = await fetch("/api/analyze", { method: "POST", body: formData });
        // Vercel answers an oversized upload with a plain-text 413, not JSON.
        const json = await res.json().catch(() => ({}) as { error?: string; issues?: ExtractionIssue[] });

        if (!res.ok) {
          setError({
            message:
              json.error ??
              (res.status === 413
                ? `That file is too large. The limit is ${MAX_UPLOAD_LABEL} — try a shorter date range or a CSV export.`
                : "Something went wrong reading your statement."),
            issues: json.issues,
          });
          return;
        }

        setReportId(json.reportId);
        setReport(json.report);
        setDone(true);
        window.setTimeout(() => router.push("/report"), 900);
      } catch {
        setError({ message: "Something went wrong. Please check your connection and try again." });
      }
    }

    run();
    return () => clearInterval(stageTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center py-12">
          <Container size="narrow" className="flex flex-col items-center gap-8 text-center">
            <IconTile icon={CircleAlert} />
            <div className="flex flex-col gap-4">
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                We couldn&apos;t complete the autopsy
              </h1>
              <p className="text-pretty text-base leading-7 text-foreground-secondary">{error.message}</p>
            </div>
            {error.issues && error.issues.length > 0 && (
              <ul className="flex w-full flex-col gap-2 rounded-2xl border border-border bg-background px-6 py-4 text-left text-sm leading-6 text-foreground-secondary">
                {error.issues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            )}
            <Button size="lg" arrow onClick={() => router.push("/upload")}>
              Try a different file
            </Button>
          </Container>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center py-12">
        <Container size="narrow" className="flex flex-col items-center gap-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-wash">
            <Spinner />
          </div>
          <div className="flex flex-col items-center gap-4">
            <div role="status" aria-live="polite">
              <AnimatePresence mode="wait">
                <m.p
                  key={done ? "done" : stageIndex}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-center justify-center gap-3 text-balance text-lg leading-8 text-foreground-secondary"
                >
                  <StageIcon icon={done ? CircleCheck : STAGES[stageIndex].icon} />
                  {done ? "Your money autopsy is ready." : STAGES[stageIndex].text}
                </m.p>
              </AnimatePresence>
            </div>
            <LoadingQuips />
          </div>
        </Container>
      </main>
    </div>
  );
}

function StageIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon size={20} className="shrink-0 text-accent" aria-hidden />;
}
