import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type TokenClient = 'web' | 'app' | 'ops';
export type RevokedReason = 'reuse' | 'logout' | 'admin';

/**
 * Rotating refresh tokens (single login, TD-19/20). Only the sha256 of the raw
 * token is stored. All tokens issued from one login share a familyId; reuse of
 * a rotated token revokes the whole family.
 */
@Entity('refresh_tokens')
@Index('IDX_refresh_tokens_user_active', ['userId'], { where: `"revoked_at" IS NULL` })
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Index('IDX_refresh_tokens_family')
  @Column({ type: 'uuid', name: 'family_id' })
  familyId: string;

  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parentId: string | null;

  @Column({ type: 'char', length: 64, name: 'token_hash', unique: true })
  tokenHash: string;

  @Column({ type: 'varchar', length: 4 })
  client: TokenClient;

  /** web/app: now() + 60 days; ops: now() + 12 hours. */
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', name: 'rotated_at', nullable: true })
  rotatedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', length: 16, name: 'revoked_reason', nullable: true })
  revokedReason: RevokedReason | null;

  @Column({ type: 'inet', nullable: true })
  ip: string | null;

  @Column({ type: 'text', name: 'user_agent', nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
