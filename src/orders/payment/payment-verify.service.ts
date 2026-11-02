import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { apiError } from '../../common/api-error';
import { RazorpayService } from '../../payments/razorpay.service';
import { Order } from '../entities/order.entity';
import { toOrderView, type OrderView } from '../order-view';
import { PaymentCaptureService } from './payment-capture.service';
import type { PaymentGateway } from './payment-gateway';

export interface PaymentVerifyInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * POST /orders/:id/payment/verify — the browser's Razorpay Checkout result.
 * The signature proves the payment was authorized; Razorpay is then asked
 * whether it's captured yet. Captured → confirmed now; otherwise the order
 * stays pending_payment and the page keeps polling. The webhook is the
 * source of truth either way.
 */
@Injectable()
export class PaymentVerifyService {
  private readonly logger = new Logger(PaymentVerifyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly capture: PaymentCaptureService,
    @Inject(RazorpayService) private readonly gateway: PaymentGateway,
  ) {}

  async verify(
    userId: string,
    orderId: string,
    input: PaymentVerifyInput,
  ): Promise<OrderView> {
    const orders = this.dataSource.getRepository(Order);
    if (!(await orders.existsBy({ id: orderId, userId }))) {
      throw apiError(404, 'NOT_FOUND', `Order ${orderId} not found`);
    }
    const invalid = () =>
      apiError(400, 'SIGNATURE_INVALID', "We couldn't verify this payment.");
    const [ours] = await this.dataSource.query(
      `SELECT 1 FROM "payments" WHERE "order_id" = $1 AND "razorpay_order_id" = $2`,
      [orderId, input.razorpayOrderId],
    );
    if (!ours) throw invalid();
    if (
      !this.gateway.verifySignature(
        input.razorpayOrderId,
        input.razorpayPaymentId,
        input.razorpaySignature,
      )
    ) {
      throw invalid();
    }

    let payment;
    try {
      payment = await this.gateway.fetchPayment(input.razorpayPaymentId);
    } catch (e) {
      this.logger.warn(
        `Razorpay fetch of ${input.razorpayPaymentId} failed: ${(e as Error).message}`,
      );
    }
    if (payment && payment.orderId !== input.razorpayOrderId) throw invalid();

    if (payment?.status === 'captured') {
      await this.capture.recordCapture(payment, { type: 'customer', userId });
    } else if (payment?.status === 'authorized') {
      await this.dataSource.query(
        `UPDATE "payments" SET "status" = 'authorized', "razorpay_payment_id" = $2
         WHERE "razorpay_order_id" = $1 AND "status" = 'created'`,
        [input.razorpayOrderId, payment.id],
      );
    }
    return toOrderView(await orders.findOneByOrFail({ id: orderId }));
  }
}
