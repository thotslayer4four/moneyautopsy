import { NextRequest, NextResponse } from "next/server";
import { getSession, unlockSession } from "@/lib/session";
import { getPaymentProvider } from "@/lib/payments";
import { shapeForStatus } from "@/lib/report";

/**
 * Actively confirms payment status with the provider and unlocks on success.
 *
 * The webhook (see /api/payment/paystack/webhook) is the source of truth in production,
 * but it can't reach a local dev server, and even in production it can lag behind the
 * browser redirect. The frontend calls this when the user lands back on /report with a
 * `reference` query param, so unlocking doesn't depend solely on the webhook arriving.
 * Safe to call repeatedly — verify() just reflects the provider's actual charge status,
 * and unlocking an already-unlocked session is a no-op.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Report not found or has expired." }, { status: 404 });
  }

  if (session.status === "unlocked") {
    return NextResponse.json({ report: shapeForStatus(session.report, session.status) });
  }

  const provider = getPaymentProvider();
  if (provider.id === "mock") {
    // Mock payments unlock immediately via /api/payment/checkout — nothing to verify here.
    return NextResponse.json({ report: shapeForStatus(session.report, session.status) });
  }

  try {
    // The report id doubles as the payment reference (see /api/payment/paystack/initialize).
    const result = await provider.verify(id);
    if (result.success) {
      const updated = await unlockSession(id);
      if (updated) return NextResponse.json({ report: shapeForStatus(updated.report, updated.status) });
    }
    return NextResponse.json({ report: shapeForStatus(session.report, session.status) });
  } catch (err) {
    console.error("Payment verification failed:", err);
    return NextResponse.json({ error: "Could not verify payment." }, { status: 500 });
  }
}
