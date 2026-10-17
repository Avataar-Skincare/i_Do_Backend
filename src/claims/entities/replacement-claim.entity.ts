import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ClaimKind = 'damaged' | 'wrong_item' | 'warranty_defect';
export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'replaced';

/**
 * A claim against a delivered ring or replacement. At most one open
 * (draft/submitted/approved) claim per order (partial UNIQUE). Replacements are
 * always the same size and finish.
 */
@Entity('replacement_claims')
@Index('UQ_replacement_claims_one_open', ['orderId'], {
  unique: true,
  where: `"status" IN ('draft','submitted','approved')`,
})
export class ReplacementClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_replacement_claims_order')
  @Column({ type: 'varchar', length: 16, name: 'order_id' })
  orderId: string;

  /** The delivered ring or replacement being claimed against. */
  @Column({ type: 'uuid', name: 'shipment_id' })
  shipmentId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: ClaimKind;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', length: 10, default: 'draft' })
  status: ClaimStatus;

  @Column({ type: 'uuid', name: 'decided_by', nullable: true })
  decidedBy: string | null;

  @Column({ type: 'text', name: 'decision_note', nullable: true })
  decisionNote: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'submitted_at', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'decided_at', nullable: true })
  decidedAt: Date | null;
}
