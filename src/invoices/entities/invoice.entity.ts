import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type InvoiceType = 'b2c' | 'b2b';

/**
 * One GST invoice per order, issued at payment (prepaid capture, or COD cash
 * collected at kit delivery). Immutable once issued. All amounts are paise;
 * total = taxableValue + cgst + sgst + igst (DB CHECK).
 */
@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, name: 'order_id', unique: true })
  orderId: string;

  /** e.g. 'IDO/26-27/000001'. */
  @Column({ type: 'varchar', length: 16, unique: true })
  number: string;

  @Column({ type: 'varchar', length: 3 })
  type: InvoiceType;

  @Column({ type: 'timestamptz', name: 'issued_at' })
  issuedAt: Date;

  @Column({ type: 'varchar', length: 64, name: 'place_of_supply_state' })
  placeOfSupplyState: string;

  @Column({ type: 'int', name: 'taxable_value' })
  taxableValue: number;

  @Column({ type: 'int', default: 0 })
  cgst: number;

  @Column({ type: 'int', default: 0 })
  sgst: number;

  @Column({ type: 'int', default: 0 })
  igst: number;

  @Column({ type: 'int' })
  total: number;

  /** Ring (sizing kit at ₹0) plus the COD handling fee line on COD orders. */
  @Column({ type: 'jsonb' })
  lines: Record<string, unknown>[];

  @Column({ type: 'varchar', length: 15, name: 'buyer_gstin', nullable: true })
  buyerGstin: string | null;

  @Column({ type: 'varchar', length: 160, name: 'buyer_legal_name', nullable: true })
  buyerLegalName: string | null;

  /** B2B e-invoice reference, if the accountant confirms it applies. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  irn: string | null;

  @Column({ type: 'varchar', length: 255, name: 'pdf_s3_key', nullable: true })
  pdfS3Key: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
