import { NextRequest, NextResponse } from "next/server";
import { getSession, unlockSession } from "@/lib/session";
import { getPaymentProvider } from "@/lib/payments";
import { AUTOPSY_PRICE_KOBO } from "@/lib/payments/pricing";
import { shapeForStatus } from "@/lib/report";

/**
 * Single entry point the frontend calls to start payment. Which provider actually runs is
 * an application/environment decision (see lib/payments), never something the client picks.
 * Mock mode unlocks immediately; a real provider returns a redirect URL and the report
 * only unlocks once that provider's webhook confirms the charge.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Report not found or has expired." }, { status: 404 });
  }

  const provider = getPaymentProvider();

  if (provider.id === "mock") {
    const updated = await unlockSession(id);
    if (!updated) return NextResponse.json({ error: "Could not unlock report." }, { status: 500 });
    return NextResponse.json({ mode: "unlocked", report: shapeForStatus(updated.report, updated.status) });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email : "guest@moneyautopsy.app";

  try {
    const result = await provider.initialize({
      email,
      amountKobo: AUTOPSY_PRICE_KOBO,
      reference: id,
      callbackUrl: `${new URL(req.url).origin}/report`,
    });
    return NextResponse.json({ mode: "redirect", url: result.authorizationUrl });
  } catch (err) {
    console.error("Checkout initialize failed:", err);
    return NextResponse.json({ error: "Could not start payment." }, { status: 500 });
  }
}
