import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Emailed once, right after a guest order is placed — lets that specific
 * inbox turn the order into a real account (or attach it to an existing one)
 * without ever proving a password. Same trust model as PasswordResetToken:
 * only the hash is stored, single-use, expires.
 */
@Entity('order_claim_tokens')
export class OrderClaimToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  orderId: string;

  /** Snapshotted at send time — stays valid even if the order is later anonymized. */
  @Column({ type: 'varchar' })
  email: string;

  @Index()
  @Column({ type: 'varchar' })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Null until used — a used link must never work twice. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
