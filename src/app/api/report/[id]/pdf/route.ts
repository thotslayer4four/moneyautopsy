import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { generateReportPdf } from "@/lib/report/pdf";

export const runtime = "nodejs";

/**
 * The full report as a PDF. Like every other paid surface, the paywall is enforced here on
 * the server: a session that hasn't paid never gets the document, whatever the client does.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Report not found or has expired." }, { status: 404 });
  }
  if (session.status !== "unlocked") {
    return NextResponse.json({ error: "Unlock the full autopsy first." }, { status: 403 });
  }

  const bytes = await generateReportPdf(session.report);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="money-autopsy.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
