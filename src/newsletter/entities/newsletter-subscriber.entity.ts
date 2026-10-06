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
}
