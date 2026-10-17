import { Column, Entity, PrimaryColumn, Unique, UpdateDateColumn } from 'typeorm';

export type SkuKind = 'ring' | 'kit';
export type Finish = 'gold' | 'silver' | 'black';

/**
 * One row per sellable item: 24 rings (3 finishes × US 6–13) plus the sizing
 * kit. Available stock = onHand − reserved (TD-6): a ring is reserved when the
 * customer submits a size and deducted from onHand at dispatch.
 */
@Entity('skus')
@Unique('UQ_skus_finish_us_size', ['finish', 'usSize'])
export class Sku {
  /** e.g. 'ring-gold-7', 'kit'. */
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'varchar', length: 4 })
  kind: SkuKind;

  @Column({ type: 'varchar', length: 8, nullable: true })
  finish: Finish | null;

  @Column({ type: 'smallint', name: 'us_size', nullable: true })
  usSize: number | null;

  @Column({ type: 'int', name: 'on_hand', default: 0 })
  onHand: number;

  @Column({ type: 'int', default: 0 })
  reserved: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
