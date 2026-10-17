import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type NotificationChannel = 'sms' | 'whatsapp' | 'email';
export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'skipped';

/**
 * Outbox: rows are written in the same transaction as the event that causes
 * them and sent by a worker. dedupeKey makes enqueueing idempotent. At launch
 * WhatsApp rows are marked 'skipped' (TD-11 parked).
 */
@Entity('notifications')
@Index('IDX_notifications_queue', ['nextAttemptAt'], { where: `"status" = 'queued'` })
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 64 })
  template: string;

  @Column({ type: 'varchar', length: 255 })
  recipient: string;

  @Index('IDX_notifications_order')
  @Column({ type: 'varchar', length: 16, name: 'order_id', nullable: true })
  orderId: string | null;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  vars: Record<string, unknown>;

  @Column({ type: 'varchar', length: 160, name: 'dedupe_key', unique: true })
  dedupeKey: string;

  @Column({ type: 'varchar', length: 8, default: 'queued' })
  status: NotificationStatus;

  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', name: 'next_attempt_at', default: () => 'now()' })
  nextAttemptAt: Date;

  @Index('IDX_notifications_provider_msg')
  @Column({ type: 'varchar', length: 128, name: 'provider_msg_id', nullable: true })
  providerMsgId: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
