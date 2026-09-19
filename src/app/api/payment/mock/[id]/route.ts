import { NextRequest, NextResponse } from "next/server";
import { getSession, unlockSession } from "@/lib/session";
import { shapeForStatus } from "@/lib/report";
import { getPaymentProvider } from "@/lib/payments";

/** Test/mock payment confirmation. Never available in production — real payments must go
 * through the real provider's verified callback/webhook. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production" && getPaymentProvider().id !== "mock") {
    return NextResponse.json({ error: "Mock payments are disabled in production." }, { status: 403 });
  }

  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Report not found or has expired." }, { status: 404 });
  }

  const updated = unlockSession(id);
  if (!updated) {
    return NextResponse.json({ error: "Could not unlock report." }, { status: 500 });
  }

  return NextResponse.json({ report: shapeForStatus(updated.report, updated.status) });
}
