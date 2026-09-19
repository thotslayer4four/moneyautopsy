import { mockProvider } from "./mock";
import { paystackProvider } from "./paystack";
import type { PaymentProvider } from "./types";

/**
 * The rest of the app talks to "a payment provider," never to Paystack specifically —
 * swapping providers later means changing this one function, nothing else.
 * PAYMENT_PROVIDER=mock is the default outside production so the flow is testable without
 * real keys; production always uses the real provider.
 */
export function getPaymentProvider(): PaymentProvider {
  const configured = process.env.PAYMENT_PROVIDER;
  if (configured === "paystack") return paystackProvider;
  if (configured === "mock") return mockProvider;
  return process.env.NODE_ENV === "production" ? paystackProvider : mockProvider;
}

export * from "./types";
export { verifyWebhookSignature } from "./paystack";
