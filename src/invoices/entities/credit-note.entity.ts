import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Issued automatically for every refund, against the order's invoice. */
@Entity('credit_notes')
export class CreditNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_credit_notes_invoice')
  @Column({ type: 'uuid', name: 'invoice_id' })
  invoiceId: string;

  @Column({ type: 'uuid', name: 'refund_id', unique: true })
  refundId: string;

  /** e.g. 'IDOCN/26-27/000001'. */
  @Column({ type: 'varchar', length: 20, unique: true })
  number: string;

  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt: Date;

  @Column({ type: 'int' })
  amount: number;

  @Column({ type: 'int', name: 'taxable_value' })
  taxableValue: number;

  @Column({ type: 'int', default: 0 })
  cgst: number;

  @Column({ type: 'int', default: 0 })
  sgst: number;

  @Column({ type: 'int', default: 0 })
  igst: number;

  @Column({ type: 'varchar', length: 255, name: 'pdf_s3_key', nullable: true })
  pdfS3Key: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
