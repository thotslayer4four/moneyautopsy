"use client";

import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DownloadPdfButton({ reportId }: { reportId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/report/${reportId}/pdf`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not create the PDF.");
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "money-autopsy.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="secondary" onClick={download} disabled={busy}>
        {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Download size={18} aria-hidden />}
        {busy ? "Preparing PDF…" : "Download PDF"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
