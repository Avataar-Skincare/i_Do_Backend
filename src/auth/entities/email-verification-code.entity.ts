import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The raw code is emailed once and never stored — only its hash. Indexed on
 * (userId, codeHash) together, not codeHash alone — a 6-digit code isn't
 * unique enough across users to index by itself.
 */
@Entity('email_verification_codes')
@Index(['userId', 'codeHash'])
export class EmailVerificationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  userId: string;

  @Column({ type: 'varchar' })
  codeHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Null until used — a used code must never work twice. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
