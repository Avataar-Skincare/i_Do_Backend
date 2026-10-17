import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type PaymentMethodKind = 'razorpay' | 'cod_cash';
export type PaymentStatus = 'created' | 'authorized' | 'captured' | 'failed';

/** One row per Razorpay order attempt, or per COD cash collection recorded by ops. */
@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_payments_order')
  @Column({ type: 'varchar', length: 16, name: 'order_id' })
  orderId: string;

  @Column({ type: 'varchar', length: 8 })
  method: PaymentMethodKind;

  @Column({ type: 'varchar', length: 64, name: 'razorpay_order_id', nullable: true, unique: true })
  razorpayOrderId: string | null;

  @Column({ type: 'varchar', length: 64, name: 'razorpay_payment_id', nullable: true, unique: true })
  razorpayPaymentId: string | null;

  /** Paise, > 0 (DB CHECK). */
  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'char', length: 3, default: 'INR' })
  currency: string;

  @Column({ type: 'varchar', length: 12, default: 'created' })
  status: PaymentStatus;

  @Column({ type: 'timestamptz', name: 'captured_at', nullable: true })
  capturedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
