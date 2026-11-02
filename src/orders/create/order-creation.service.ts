import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { apiError } from '../../common/api-error';
import { quote } from '../../catalog/pricing';
import {
  RazorpayService,
  type RazorpayOrder,
} from '../../payments/razorpay.service';
import { SettingsService } from '../../settings/settings.service';
import { Order } from '../entities/order.entity';
import { toOrderView, type OrderView } from '../order-view';
import { initialStatus } from '../state/order-transitions';
import type { PaymentGateway } from '../payment/payment-gateway';
import {
  launchGateMissing,
  newOrderId,
  sameOrderDetails,
  type LaunchGateSettings,
  type OrderDetails,
} from './order-create-rules';

export type CreateOrderInput = OrderDetails;

export interface CreateOrderResult {
  /** true → 201 (new order); false → 200 (Idempotency-Key replay). */
  created: boolean;
  body: {
    order: OrderView;
    razorpay?: { id: string; amount: number; currency: string; keyId: string };
  };
}

const UNIQUE_VIOLATION = '23505';

/**
 * POST /orders (LLD §3.1 transitions 1 and 4, §5).
 *
 * Prices come from the server quote, never the browser. The order row is
 * inserted first, then the Razorpay order is created and its payments row
 * written — all in one transaction, so a Razorpay failure leaves nothing
 * behind, and a simultaneous duplicate (double-click) waits on the
 * (user_id, idempotency_key) unique index and then replays the finished order.
 */
@Injectable()
export class OrderCreationService {
  private readonly logger = new Logger(OrderCreationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    @Inject(RazorpayService) private readonly gateway: PaymentGateway,
  ) {}

  async create(
    userId: string,
    idempotencyKey: string,
    input: CreateOrderInput,
  ): Promise<CreateOrderResult> {
    // A retry must get its order back even if settings changed since (store paused, price edited).
    const existing = await this.replay(userId, idempotencyKey, input);
    if (existing) return existing;

    const pricing = await this.settings.pricing();
    const gate = await this.settings.getMany<
      LaunchGateSettings & Record<string, unknown>
    >(['kit_price_paise', 'hsn_code', 'seller', 'support_contacts']);
    const missing = launchGateMissing(gate);
    if (missing.length) {
      throw apiError(
        503,
        'STORE_NOT_LIVE',
        `Orders open once these settings are set: ${missing.join(', ')}`,
      );
    }

    const q = quote(pricing, {
      finish: input.finish,
      paymentMethod: input.paymentMethod,
      pin: input.address.pin,
    });
    if (input.paymentMethod === 'cod' && !q.codAvailable) {
      throw apiError(
        409,
        'COD_NOT_SERVICEABLE',
        'Cash on delivery is not available for this pincode',
      );
    }

    const id = newOrderId();
    const status = initialStatus(input.paymentMethod);
    try {
      return await this.dataSource.transaction(async (m) => {
        await m.query(
          `INSERT INTO "orders" ("id", "user_id", "idempotency_key", "status", "payment_method", "finish",
             "unit_price", "list_price", "subtotal", "cod_fee", "discount", "total", "kit_price_snapshot",
             "offer_code", "customer", "address", "buyer_gstin", "buyer_legal_name")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18)`,
          [
            id,
            userId,
            idempotencyKey,
            status,
            input.paymentMethod,
            input.finish,
            pricing.ring_price_paise,
            pricing.ring_list_price_paise,
            q.subtotal,
            q.codFee,
            q.discount,
            q.total,
            gate.kit_price_paise,
            input.offerCode ?? null,
            JSON.stringify(input.customer),
            JSON.stringify(input.address),
            input.buyerGstin ?? null,
            input.buyerLegalName ?? null,
          ],
        );
        await m.query(
          `INSERT INTO "order_events" ("order_id", "actor_type", "actor_user_id", "from_status", "to_status", "event")
           VALUES ($1, 'customer', $2, NULL, $3, 'order_created')`,
          [id, userId, status],
        );

        let razorpay: CreateOrderResult['body']['razorpay'];
        if (input.paymentMethod === 'online') {
          const rzp = await this.createGatewayOrder(q.total, id);
          await m.query(
            `INSERT INTO "payments" ("order_id", "method", "razorpay_order_id", "amount", "currency", "status")
             VALUES ($1, 'razorpay', $2, $3, $4, 'created')`,
            [id, rzp.id, rzp.amount, rzp.currency],
          );
          razorpay = { ...rzp, keyId: this.gateway.keyId };
        }

        const order = await m.getRepository(Order).findOneByOrFail({ id });
        return {
          created: true,
          body: {
            order: toOrderView(order),
            ...(razorpay ? { razorpay } : {}),
          },
        };
      });
    } catch (e) {
      // Same key raced in from a second request and won: return its order (or 409 if it differs).
      if ((e as { code?: string }).code === UNIQUE_VIOLATION) {
        const won = await this.replay(userId, idempotencyKey, input);
        if (won) return won;
      }
      throw e;
    }
  }

  private async createGatewayOrder(
    amount: number,
    receipt: string,
  ): Promise<RazorpayOrder> {
    try {
      return await this.gateway.createOrder(amount, receipt);
    } catch (e) {
      this.logger.error(
        `Razorpay order for ${receipt} failed: ${(e as Error).message}`,
      );
      throw apiError(
        503,
        'PAYMENT_GATEWAY_UNAVAILABLE',
        'Payments are temporarily unavailable. Please try again.',
      );
    }
  }

  /** The order already created with this key: same details → replay (200), different → 409. */
  private async replay(
    userId: string,
    key: string,
    input: CreateOrderInput,
    m: EntityManager = this.dataSource.manager,
  ) {
    const order = await m
      .getRepository(Order)
      .findOneBy({ userId, idempotencyKey: key });
    if (!order) return null;
    if (!sameOrderDetails(order, input)) {
      throw apiError(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for an order with different details. Send a new key.',
      );
    }
    let razorpay: CreateOrderResult['body']['razorpay'];
    if (order.paymentMethod === 'online') {
      const [p]: Array<{
        razorpay_order_id: string;
        amount: number;
        currency: string;
      }> = await m.query(
        `SELECT "razorpay_order_id", "amount", "currency" FROM "payments"
         WHERE "order_id" = $1 AND "method" = 'razorpay' ORDER BY "created_at" LIMIT 1`,
        [order.id],
      );
      if (p)
        razorpay = {
          id: p.razorpay_order_id,
          amount: p.amount,
          currency: p.currency,
          keyId: this.gateway.keyId,
        };
    }
    return {
      created: false,
      body: { order: toOrderView(order), ...(razorpay ? { razorpay } : {}) },
    } as CreateOrderResult;
  }
}
