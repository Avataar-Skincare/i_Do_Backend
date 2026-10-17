import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AttachmentKind = 'video' | 'photo';

/** Private S3 upload for a claim; the service allows at most 1 video and 6 photos per claim. */
@Entity('claim_attachments')
export class ClaimAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_claim_attachments_claim')
  @Column({ type: 'uuid', name: 'claim_id' })
  claimId: string;

  @Column({ type: 'varchar', length: 8 })
  kind: AttachmentKind;

  @Column({ type: 'varchar', length: 255, name: 's3_key', unique: true })
  s3Key: string;

  @Column({ type: 'varchar', length: 64, name: 'content_type' })
  contentType: string;

  /** ≤ 250 MB (DB CHECK). bigint comes back from pg as a string. */
  @Column({ type: 'bigint', name: 'size_bytes' })
  sizeBytes: string;

  /** Set once HeadObject confirms the upload exists. */
  @Column({ type: 'timestamptz', name: 'verified_at', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
