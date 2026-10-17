import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RefundReason = 'customer_cancel' | 'kit_rto' | 'ring_refused' | 'late_capture' | 'admin';
export type RefundMethod = 'razorpay' | 'bank' | 'upi';
export type RefundStatus = 'requested' | 'processing' | 'paid' | 'rejected';

/**
 * At most one non-rejected refund per order (partial UNIQUE). The amount is
 * computed once under a row lock on the order and never changes:
 * amount = amountPaid − kitDeduction − feeDeduction, > 0 (DB CHECK).
 */
@Entity('refunds')
@Index('UQ_refunds_one_active', ['orderId'], { unique: true, where: `"status" <> 'rejected'` })
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_refunds_order')
  @Column({ type: 'varchar', length: 16, name: 'order_id' })
  orderId: string;

  @Column({ type: 'varchar', length: 16 })
  reason: RefundReason;

  @Column({ type: 'int', name: 'amount_paid' })
  amountPaid: number;

  @Column({ type: 'int', name: 'kit_deduction', default: 0 })
  kitDeduction: number;

  /** orders.cod_fee on a COD order (the ₹100 fee is never refunded), else 0. */
  @Column({ type: 'int', name: 'fee_deduction', default: 0 })
  feeDeduction: number;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'varchar', length: 8 })
  method: RefundMethod;

  /** AES-256-GCM ciphertext (key version in its prefix, TD-17); NULL for Razorpay refunds. */
  @Column({ type: 'bytea', name: 'dest_enc', nullable: true })
  destEnc: Buffer | null;

  @Column({ type: 'char', length: 4, name: 'dest_last4', nullable: true })
  destLast4: string | null;

  @Column({ type: 'varchar', length: 120, name: 'account_holder', nullable: true })
  accountHolder: string | null;

  @Column({ type: 'varchar', length: 16, default: 'requested' })
  status: RefundStatus;

  /** Razorpay refund id or bank UTR. */
  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  reference: string | null;

  @Column({ type: 'uuid', name: 'requested_by', nullable: true })
  requestedBy: string | null;

  @Column({ type: 'uuid', name: 'processed_by', nullable: true })
  processedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz', name: 'dest_purged_at', nullable: true })
  destPurgedAt: Date | null;
}
