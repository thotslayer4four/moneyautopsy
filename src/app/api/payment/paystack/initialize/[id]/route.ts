import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPaymentProvider } from "@/lib/payments";
import { AUTOPSY_PRICE_KOBO } from "@/lib/payments/pricing";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Report not found or has expired." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email : "guest@moneyautopsy.app";

  try {
    const provider = getPaymentProvider();
    // The report id doubles as the Paystack reference so the webhook can map a
    // successful charge straight back to the session without a separate lookup table.
    const result = await provider.initialize({ email, amountKobo: AUTOPSY_PRICE_KOBO, reference: id });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Payment initialize failed:", err);
    return NextResponse.json({ error: "Could not start payment." }, { status: 500 });
  }
}
