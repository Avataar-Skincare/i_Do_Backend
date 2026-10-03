import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** The raw token is emailed once and never stored — only its hash, so a leaked DB row can't be replayed. */
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  userId: string;

  /** Not unique — two independently-generated tokens hashing the same value is astronomically unlikely, not something to enforce. */
  @Index()
  @Column({ type: 'varchar' })
  tokenHash: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** Null until used — a used token must never work twice. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
