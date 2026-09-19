export interface PaymentInitResult {
  provider: "mock" | "paystack";
  /** Where to send the user to complete payment. For mock mode, this is null — the
   * caller unlocks immediately. */
  authorizationUrl: string | null;
  reference: string;
}

export interface PaymentProvider {
  id: "mock" | "paystack";
  initialize(params: { email: string; amountKobo: number; reference: string }): Promise<PaymentInitResult>;
  verify(reference: string): Promise<{ success: boolean; reference: string }>;
}
