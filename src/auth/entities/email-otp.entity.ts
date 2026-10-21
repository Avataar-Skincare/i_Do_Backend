import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Passwordless email login code. Keyed by email, not userId, because the account may not
 * exist yet when a code is sent: the first successful verify creates it (same as phone_otps).
 * The raw code is emailed once and never stored, only its hash.
 */
@Entity('email_otps')
@Index('IDX_email_otps_email_created', ['email', 'createdAt'])
@Index('IDX_email_otps_ip_created', ['ip', 'createdAt'])
export class EmailOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Lower-cased and trimmed. */
  @Column({ type: 'varchar', length: 254 })
  email: string;

  @Column({ type: 'varchar' })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Null until used or burned: a used code must never work twice. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  /** Wrong guesses against this code; the code is burned at 5 (DB CHECK). */
  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  /** Requester IP, for per-IP send limits. */
  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
