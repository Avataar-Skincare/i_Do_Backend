import type { RazorpayOrder } from '../../payments/razorpay.service';

/** A payment as Razorpay reports it (GET /payments/:id or a webhook entity). Amount in paise. */
export interface GatewayPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  /** Razorpay: created | authorized | captured | refunded | failed. */
  status: string;
}

/** What the order flow needs from Razorpay — RazorpayService in the app, a fake in tests. */
export interface PaymentGateway {
  keyId: string;
  createOrder(amount: number, receipt: string): Promise<RazorpayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  /** Every payment attempt on one Razorpay order (payment_sweep: was it captured after all?). */
  fetchOrderPayments(razorpayOrderId: string): Promise<GatewayPayment[]>;
  /** Checkout handler signature: HMAC-SHA256 of `${orderId}|${paymentId}` with the key secret. */
  verifySignature(
    orderId: string,
    paymentId: string,
    signature: string,
  ): boolean;
}
