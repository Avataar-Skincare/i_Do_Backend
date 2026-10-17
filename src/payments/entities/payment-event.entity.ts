import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Raw inbound payment webhooks, deduplicated on (provider, event_id) — the
 * event id comes from the `x-razorpay-event-id` header. Linked to an order
 * only through its payload.
 */
@Entity('payment_events')
@Unique('UQ_payment_events_provider_event', ['provider', 'eventId'])
export class PaymentEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, default: 'razorpay' })
  provider: string;

  @Column({ type: 'varchar', length: 64, name: 'event_id' })
  eventId: string;

  @Column({ type: 'varchar', length: 64, name: 'event_type' })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'boolean', name: 'signature_ok' })
  signatureOk: boolean;

  @Column({ type: 'timestamptz', name: 'received_at', default: () => 'now()' })
  receivedAt: Date;

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
