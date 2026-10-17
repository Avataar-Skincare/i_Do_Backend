import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('newsletter_subscribers')
export class NewsletterSubscriber {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  email: string;

  @CreateDateColumn({ type: 'timestamptz' })
  subscribedAt: Date;

  /** Null while subscribed — set only if/when an unsubscribe flow exists. */
  @Column({ type: 'timestamptz', nullable: true })
  unsubscribedAt: Date | null;

  /** Where the signup came from (e.g. 'footer', 'launch_popup'). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  source: string | null;

  /** Set once the launch-offer code has been emailed. */
  @Column({ type: 'timestamptz', name: 'offer_code_sent_at', nullable: true })
  offerCodeSentAt: Date | null;
}
