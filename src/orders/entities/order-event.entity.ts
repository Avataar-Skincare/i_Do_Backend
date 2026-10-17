import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ActorType = 'customer' | 'admin' | 'system' | 'webhook' | 'partner';

/**
 * Append-only audit trail for an order: every status change plus events such
 * as awb_added, cod_call, size_changed (with the ops reason) and
 * refund_details_viewed. Written in the same transaction as the change.
 */
@Entity('order_events')
@Index('IDX_order_events_order_created', ['orderId', 'createdAt'])
export class OrderEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 16, name: 'order_id' })
  orderId: string;

  @Column({ type: 'varchar', length: 10, name: 'actor_type' })
  actorType: ActorType;

  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'varchar', length: 20, name: 'from_status', nullable: true })
  fromStatus: string | null;

  @Column({ type: 'varchar', length: 20, name: 'to_status', nullable: true })
  toStatus: string | null;

  @Column({ type: 'varchar', length: 40 })
  event: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
