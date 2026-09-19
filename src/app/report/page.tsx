"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileX } from "lucide-react";
import { Container } from "@/components/layout/container";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { IconTile } from "@/components/ui/icon-tile";
import { LoadingQuips } from "@/components/ui/loading-quips";
import { Spinner } from "@/components/ui/spinner";
import { useAutopsyStore, useStoreHydrated } from "@/lib/store";
import type { ClientReport } from "@/lib/types";
import { FreeReport } from "@/components/report/free-report";
import { FullReport } from "@/components/report/full-report";

export default function ReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportPageInner />
    </Suspense>
  );
}

function ReportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hydrated = useStoreHydrated();
  const storeReportId = useAutopsyStore((s) => s.reportId);
  const setReportId = useAutopsyStore((s) => s.setReportId);
  const storedReport = useAutopsyStore((s) => s.report);
  const setReport = useAutopsyStore((s) => s.setReport);

  // The Paystack reference *is* the report id (see /api/payment/paystack/initialize), so
  // when we're returning from checkout, the URL is the authoritative source — client-side
  // state (sessionStorage) isn't guaranteed to survive every browser's redirect round trip
  // to an external payment page and back (new tab, private browsing, etc.).
  const referenceFromUrl = searchParams.get("reference") || searchParams.get("trxref");
  const reportId = referenceFromUrl || storeReportId;

  const [report, setLocalReport] = useState<ClientReport | null>(storedReport);
  const [loading, setLoading] = useState(!storedReport);
  const [notFound, setNotFound] = useState(false);

  const fetchReport = useCallback(async () => {
    if (!reportId) return;
    try {
      const res = await fetch(`/api/report/${reportId}`);
      if (!res.ok) {
        setNotFound(true);
        return;
      }
      const json = await res.json();
      setLocalReport(json.report);
      setReport(json.report);
    } finally {
      setLoading(false);
    }
  }, [reportId, setReport]);

  useEffect(() => {
    if (!hydrated) return;
    if (!reportId) {
      router.replace("/");
      return;
    }
    if (reportId !== storeReportId) setReportId(reportId);
    if (!storedReport || referenceFromUrl) fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reportId]);

  const returningFromPayment = !!(searchParams.get("reference") || searchParams.get("trxref"));
  const [verifyingPayment, setVerifyingPayment] = useState(returningFromPayment);

  // Returning from a redirect-based payment provider (Paystack's hosted checkout, in
  // production): actively verify with the provider rather than just re-reading session
  // status, since a webhook may not have landed yet — or, for local dev, can never reach
  // this machine at all. Safe to poll repeatedly; verify() just reflects real charge status.
  useEffect(() => {
    if (!returningFromPayment || !reportId) return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/payment/verify/${reportId}`, { method: "POST" });
        if (res.ok) {
          const json = await res.json();
          setLocalReport(json.report);
          setReport(json.report);
          if (json.report.status === "unlocked" || attempts >= 6) {
            setVerifyingPayment(false);
            clearInterval(interval);
          }
        } else if (attempts >= 6) {
          setVerifyingPayment(false);
          clearInterval(interval);
        }
      } catch {
        if (attempts >= 6) {
          setVerifyingPayment(false);
          clearInterval(interval);
        }
      }
    }, 1500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returningFromPayment, reportId]);

  function handleUnlocked(unlocked: ClientReport) {
    setLocalReport(unlocked);
    setReport(unlocked);
  }

  if (notFound) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center py-12">
          <Container size="narrow" className="flex flex-col items-center gap-8 text-center">
            <IconTile icon={FileX} />
            <div className="flex flex-col gap-4">
              <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
                This report has expired
              </h1>
              <p className="text-base leading-7 text-foreground-secondary">
                Start a new autopsy to see your results.
              </p>
            </div>
            <Button href="/about-you" size="lg" arrow>
              Start a new autopsy
            </Button>
          </Container>
        </main>
      </div>
    );
  }

  if (loading || !report) {
    return (
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <main role="status" aria-label="Loading your report" className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-wash">
            <Spinner />
          </div>
          <LoadingQuips />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1 py-12 sm:py-16">
        <Container size={report.status === "unlocked" ? "narrow" : "default"} className="flex flex-col gap-8">
          {verifyingPayment && report.status === "free" && (
            <div role="status">
              <Callout icon={<Spinner size={16} className="shrink-0" />}>Confirming your payment...</Callout>
            </div>
          )}
          {report.status === "free" ? (
            <FreeReport report={report} onUnlocked={handleUnlocked} />
          ) : (
            <FullReport report={report} onReportUpdated={handleUnlocked} />
          )}
        </Container>
      </main>
    </div>
  );
}
