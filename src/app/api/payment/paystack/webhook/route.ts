import { NextRequest, NextResponse } from "next/server";
import { unlockSession } from "@/lib/session";
import { verifyWebhookSignature } from "@/lib/payments";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.event === "charge.success") {
    const reference: string | undefined = event.data?.reference;
    if (reference) await unlockSession(reference);
  }

  return NextResponse.json({ received: true });
}
