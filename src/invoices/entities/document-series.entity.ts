import { Column, Entity, PrimaryColumn } from 'typeorm';

export type DocumentSeriesKey = 'invoice' | 'credit_note';

/**
 * Gapless numbering per (key, financial year). Take the next number under
 * SELECT … FOR UPDATE. Format PREFIX/YY-YY/NNNNNN, ≤ 16 chars.
 */
@Entity('document_series')
export class DocumentSeries {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  key: DocumentSeriesKey;

  /** e.g. '26-27'. */
  @PrimaryColumn({ type: 'char', length: 5, name: 'financial_year' })
  financialYear: string;

  @Column({ type: 'varchar', length: 8 })
  prefix: string;

  @Column({ type: 'int', name: 'next_no', default: 1 })
  nextNo: number;
}
