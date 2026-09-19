import type { PaymentProvider } from "./types";

import { createHmac } from "crypto";

const PAYSTACK_BASE = "https://api.paystack.co";

/** Real Paystack integration. Requires PAYSTACK_SECRET_KEY. Verify webhooks with
 * verifyWebhookSignature before trusting any webhook payload. */
export const paystackProvider: PaymentProvider = {
  id: "paystack",
  async initialize({ email, amountKobo, reference }) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) throw new Error("PAYSTACK_SECRET_KEY is not set");

    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountKobo,
        reference,
        callback_url: process.env.PAYSTACK_CALLBACK_URL,
      }),
    });

    if (!res.ok) throw new Error(`Paystack initialize failed: ${res.status}`);
    const json = (await res.json()) as { data?: { authorization_url?: string } };
    return {
      provider: "paystack",
      authorizationUrl: json.data?.authorization_url ?? null,
      reference,
    };
  },
  async verify(reference) {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) throw new Error("PAYSTACK_SECRET_KEY is not set");

    const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) return { success: false, reference };
    const json = (await res.json()) as { data?: { status?: string } };
    return { success: json.data?.status === "success", reference };
  },
};

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) return false;
  const hash = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  return hash === signature;
}
