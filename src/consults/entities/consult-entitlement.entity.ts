import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { ConsultType } from './consult.entity';

/**
 * Created only at first ring delivery: one derm + one dietician per order,
 * expiring ringDeliveredAt + 30 days. No status column — the state
 * (used/booked/expired/available) is derived from its consults (LLD §3.5).
 */
@Entity('consult_entitlements')
@Unique('UQ_consult_entitlements_order_type', ['orderId', 'type'])
export class ConsultEntitlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, name: 'order_id' })
  orderId: string;

  @Index('IDX_consult_entitlements_user')
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'varchar', length: 10 })
  type: ConsultType;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
