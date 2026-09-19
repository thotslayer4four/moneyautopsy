"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/layout/container";
import { SiteHeader } from "@/components/layout/site-header";
import { Dropzone } from "@/components/upload/dropzone";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useAutopsyStore, useStoreHydrated } from "@/lib/store";
import { isProfileComplete } from "@/lib/profile/complete";
import { userProfileSchema } from "@/lib/profileSchema";

export default function UploadPage() {
  const router = useRouter();
  const profile = useAutopsyStore((s) => s.profile);
  const setPendingFile = useAutopsyStore((s) => s.setPendingFile);
  const pendingFile = useAutopsyStore((s) => s.pendingFile);
  const [file, setFile] = useState<File | null>(pendingFile);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useStoreHydrated();

  useEffect(() => {
    if (!hydrated) return;
    if (!isProfileComplete(profile)) {
      console.warn("About You is incomplete; returning to it.", userProfileSchema.safeParse(profile).error?.issues);
      router.replace("/about-you");
    }
  }, [hydrated, profile, router]);

  function handleContinue() {
    if (!file) {
      setError("Please choose a PDF or CSV statement to continue.");
      return;
    }
    setError(null);
    setPendingFile(file);
    router.push("/processing");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center py-12">
        <Container size="narrow" className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              Show us the evidence
            </h1>
            <p className="text-base leading-7 text-foreground-secondary">
              Upload a bank statement covering a useful period. The longer the period, the better the
              analysis.
            </p>
          </div>

          <Dropzone file={file} onFileSelected={setFile} error={error} />

          <Callout leadIn="Read once, never saved." icon={<Info size={16} className="shrink-0 text-accent" aria-hidden />}>
            Your statement is used only to write your autopsy, and we don&apos;t keep a copy. Your results clear after
            two hours. Please don&apos;t upload a statement that isn&apos;t yours.
          </Callout>

          <Button size="lg" arrow glow onClick={handleContinue} className="w-full sm:w-auto sm:self-start">
            Begin the autopsy
          </Button>
        </Container>
      </main>
    </div>
  );
}
