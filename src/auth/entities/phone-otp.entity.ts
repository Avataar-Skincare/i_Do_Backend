import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Keyed by phone, not userId — unlike EmailVerificationCode, the account may
 * not exist yet when a code is sent (phone login creates the account on
 * first successful verify, same as the Client repo's own signIn/verifyOtp).
 * The raw code is texted once and never stored — only its hash.
 */
@Entity('phone_otps')
@Index(['phone', 'codeHash'])
@Index('IDX_phone_otps_phone_created', ['phone', 'createdAt'])
@Index('IDX_phone_otps_ip_created', ['ip', 'createdAt'])
export class PhoneOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10 })
  phone: string;

  @Column({ type: 'varchar' })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Null until used — a used code must never work twice. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  /** Wrong guesses against this code; locked at 5 (DB CHECK). */
  @Column({ type: 'smallint', default: 0 })
  attempts: number;

  /** Requester IP, for per-IP send limits. */
  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
