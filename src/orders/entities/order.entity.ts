import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, Unique, UpdateDateColumn } from 'typeorm';
import type { Finish } from '../../catalog/entities/sku.entity';

/** The 9 order states (LLD §3.1). Transitions are owned by OrderStateService, never set directly. */
export type OrderStatus =
  | 'pending_payment'
  | 'cod_pending'
  | 'confirmed'
  | 'kit_shipped'
  | 'kit_delivered'
  | 'size_submitted'
  | 'ring_shipped'
  | 'ring_delivered'
  | 'cancelled';

/** Set if and only if status is 'cancelled' (DB CHECK). */
export type CancelReason = 'unpaid' | 'cod_unconfirmed' | 'customer' | 'kit_rto' | 'ring_refused' | 'admin';

export type PaymentMethod = 'online' | 'cod';
export type CodConfirmVia = 'whatsapp_manual' | 'whatsapp_auto' | 'call';

export interface OrderCustomer {
  name: string;
  email: string;
  phone: string;
}

export interface OrderAddress {
  line: string;
  city: string;
  state: string;
  pin: string;
}

/**
 * One order = one i do ring, sizing kit first (LLD v1.4 §2.1). The finish is
 * chosen at order time; the size stays NULL until the customer submits it,
 * after which the composite FK (finish, us_size) → skus is enforced. All money
 * is integer paise. Rows are never deleted (accounting) — account deletion
 * scrubs the customer/address snapshots and sets piiScrubbedAt.
 */
@Entity('orders')
@Unique('UQ_orders_user_idempotency', ['userId', 'idempotencyKey'])
@Index('IDX_orders_user_created', ['userId', 'createdAt'])
@Index('IDX_orders_cod_call_due', ['codCallDueAt'], { where: `"status" = 'cod_pending'` })
@Index('IDX_orders_size_due', ['sizeDueAt'], { where: `"status" = 'kit_delivered'` })
export class Order {
  /** 'IDO-' + 10 crypto-random Crockford base32 characters. */
  @PrimaryColumn({ type: 'varchar', length: 16 })
  id: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', name: 'idempotency_key' })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 20, default: 'pending_payment' })
  status: OrderStatus;

  @Column({ type: 'varchar', length: 16, name: 'cancel_reason', nullable: true })
  cancelReason: CancelReason | null;

  @Column({ type: 'varchar', length: 6, name: 'payment_method' })
  paymentMethod: PaymentMethod;

  @Column({ type: 'varchar', length: 8 })
  finish: Finish;

  /** NULL until the customer submits a size; locked from then on (TD-23). */
  @Column({ type: 'smallint', name: 'us_size', nullable: true })
  usSize: number | null;

  @Column({ type: 'int', name: 'unit_price' })
  unitPrice: number;

  @Column({ type: 'int', name: 'list_price' })
  listPrice: number;

  @Column({ type: 'int' })
  subtotal: number;

  @Column({ type: 'int', name: 'cod_fee', default: 0 })
  codFee: number;

  @Column({ type: 'int', default: 0 })
  discount: number;

  /** total = subtotal + cod_fee − discount (DB CHECK). */
  @Column({ type: 'int' })
  total: number;

  @Column({ type: 'int', name: 'amount_paid', default: 0 })
  amountPaid: number;

  /** Kit price at order time — deducted on a cancel after the kit or a refused ring. */
  @Column({ type: 'int', name: 'kit_price_snapshot' })
  kitPriceSnapshot: number;

  @Column({ type: 'varchar', length: 32, name: 'offer_code', nullable: true })
  offerCode: string | null;

  @Column({ type: 'jsonb' })
  customer: OrderCustomer;

  @Column({ type: 'jsonb' })
  address: OrderAddress;

  /** Optional at checkout; set together with buyerLegalName for a B2B invoice (TD-14). */
  @Column({ type: 'varchar', length: 15, name: 'buyer_gstin', nullable: true })
  buyerGstin: string | null;

  @Column({ type: 'varchar', length: 160, name: 'buyer_legal_name', nullable: true })
  buyerLegalName: string | null;

  /** True while one ring of (finish, us_size) is reserved for this order (TD-6). */
  @Column({ type: 'boolean', name: 'stock_reserved', default: false })
  stockReserved: boolean;

  @Column({ type: 'timestamptz', name: 'cod_confirm_sent_at', nullable: true })
  codConfirmSentAt: Date | null;

  @Column({ type: 'timestamptz', name: 'cod_confirmed_at', nullable: true })
  codConfirmedAt: Date | null;

  @Column({ type: 'varchar', length: 16, name: 'cod_confirm_via', nullable: true })
  codConfirmVia: CodConfirmVia | null;

  @Column({ type: 'smallint', name: 'cod_call_attempts', default: 0 })
  codCallAttempts: number;

  @Column({ type: 'timestamptz', name: 'cod_call_due_at', nullable: true })
  codCallDueAt: Date | null;

  @Column({ type: 'timestamptz', name: 'kit_delivered_at', nullable: true })
  kitDeliveredAt: Date | null;

  /** End of the IST day of kit delivery + 15 days — a reminder target, never a cancellation. */
  @Column({ type: 'timestamptz', name: 'size_due_at', nullable: true })
  sizeDueAt: Date | null;

  @Column({ type: 'timestamptz', name: 'size_submitted_at', nullable: true })
  sizeSubmittedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'ring_delivered_at', nullable: true })
  ringDeliveredAt: Date | null;

  @Column({ type: 'timestamptz', name: 'damage_window_until', nullable: true })
  damageWindowUntil: Date | null;

  @Column({ type: 'timestamptz', name: 'warranty_until', nullable: true })
  warrantyUntil: Date | null;

  @Column({ type: 'timestamptz', name: 'cancelled_at', nullable: true })
  cancelledAt: Date | null;

  @Column({ type: 'timestamptz', name: 'pii_scrubbed_at', nullable: true })
  piiScrubbedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
