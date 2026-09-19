import type { PaymentProvider } from "./types";

/** Development/test payment provider — never used in production (see lib/payments/index.ts). */
export const mockProvider: PaymentProvider = {
  id: "mock",
  async initialize({ reference }) {
    return { provider: "mock", authorizationUrl: null, reference };
  },
  async verify(reference) {
    return { success: true, reference };
  },
};
