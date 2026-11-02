import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
// `razorpay` exports via plain `module.exports = Razorpay`, and this project's
// tsconfig doesn't have esModuleInterop on — a default import here compiles to
// `razorpay_1.default`, which doesn't exist. Explicit require-syntax sidesteps that.
import Razorpay = require('razorpay');
import type { GatewayPayment, PaymentGateway } from '../orders/payment/payment-gateway';

export type RazorpayOrder = { id: string; amount: number; currency: string };

/**
 * Not live yet — needs real test-mode credentials (RAZORPAY_KEY_ID/SECRET)
 * before any of this can actually create a payable order. The Razorpay SDK's
 * own constructor throws synchronously on an empty key_id (unlike, say, the
 * AWS SDK, which only fails lazily on an actual call) — so the client is
 * built lazily here, the first time it's actually needed, not at app boot.
 * Building it eagerly would crash the entire backend on startup whenever
 * these env vars are blank, which they are until real keys exist.
 */
@Injectable()
export class RazorpayService implements PaymentGateway {
  private readonly logger = new Logger(RazorpayService.name);
  private client: Razorpay | null = null;
  readonly keyId: string;

  constructor(private readonly config: ConfigService) {
    this.keyId = this.config.get<string>('RAZORPAY_KEY_ID', '');
  }

  private getClient(): Razorpay {
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET', '');
    if (!this.keyId || !keySecret) {
      throw new Error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
    }
    if (!this.client) {
      this.client = new Razorpay({ key_id: this.keyId, key_secret: keySecret });
    }
    return this.client;
  }

  /** `amount` is in paise, same unit as everywhere else in this codebase — Razorpay expects the same. */
  async createOrder(amount: number, receipt: string): Promise<RazorpayOrder> {
    const order = await this.getClient().orders.create({ amount, currency: 'INR', receipt, payment_capture: true });
    return { id: order.id, amount: Number(order.amount), currency: order.currency };
  }

  /** The payment as Razorpay has it now — `status` says whether it's captured yet. */
  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    const p = await this.getClient().payments.fetch(paymentId);
    return { id: p.id, orderId: String(p.order_id), amount: Number(p.amount), currency: p.currency, status: p.status };
  }

  /** Every payment attempt on one Razorpay order (payment_sweep: was it captured after all?). */
  async fetchOrderPayments(razorpayOrderId: string): Promise<GatewayPayment[]> {
    const { items } = await this.getClient().orders.fetchPayments(razorpayOrderId);
    return items.map((p) => ({ id: p.id, orderId: String(p.order_id), amount: Number(p.amount), currency: p.currency, status: p.status }));
  }

  /**
   * The only real proof a payment happened: Razorpay signs
   * `${orderId}|${paymentId}` with the account's key secret (HMAC-SHA256) and
   * hands the signature to the browser, which hands it to us. We recompute
   * it server-side and compare — never trust the client's own claim that a
   * payment succeeded.
   */
  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET', '');
    if (!keySecret) {
      this.logger.warn('Razorpay signature check skipped — RAZORPAY_KEY_SECRET not set');
      return false;
    }
    const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    // timingSafeEqual throws on mismatched lengths rather than returning false —
    // an attacker-supplied signature of the wrong length must still just fail, not crash.
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}
