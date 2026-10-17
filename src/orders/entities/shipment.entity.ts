import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type ShipmentKind = 'kit' | 'ring' | 'replacement';
export type ShipmentStatus = 'pending' | 'shipped' | 'delivered' | 'rto' | 'lost';
export type RtoReason = 'refused' | 'undeliverable';
export type ReturnCondition = 'sealed' | 'damaged';

/**
 * Every physical parcel for an order: one sizing kit, the ring (a second ring
 * attempt after an undeliverable RTO), and replacements for approved claims.
 * Ops enter courier status by hand at launch (TD-24). A refund for a refused
 * ring is created only when ops record returnedAt (TD-26).
 */
@Entity('shipments')
@Unique('UQ_shipments_courier_awb', ['courier', 'awb'])
@Index('UQ_shipments_one_kit', ['orderId'], { unique: true, where: `"kind" = 'kit'` })
@Index('UQ_shipments_one_live_ring', ['orderId'], {
  unique: true,
  where: `"kind" = 'ring' AND "status" IN ('pending','shipped','delivered')`,
})
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_shipments_order')
  @Column({ type: 'varchar', length: 16, name: 'order_id' })
  orderId: string;

  @Column({ type: 'varchar', length: 12 })
  kind: ShipmentKind;

  /** Set if and only if kind is 'replacement' (DB CHECK). */
  @Column({ type: 'uuid', name: 'claim_id', nullable: true })
  claimId: string | null;

  @Column({ type: 'varchar', length: 32, name: 'sku_id' })
  skuId: string;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: ShipmentStatus;

  @Column({ type: 'varchar', length: 32, nullable: true })
  courier: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  awb: string | null;

  @Column({ type: 'text', name: 'tracking_url', nullable: true })
  trackingUrl: string | null;

  /** Required once a ring or replacement leaves 'pending' (DB CHECK). */
  @Column({ type: 'varchar', length: 40, name: 'serial_number', nullable: true, unique: true })
  serialNumber: string | null;

  /** orders.total on a COD kit, else 0 — COD is collected in full at kit delivery. */
  @Column({ type: 'int', name: 'cod_amount', default: 0 })
  codAmount: number;

  @Column({ type: 'timestamptz', name: 'cod_collected_at', nullable: true })
  codCollectedAt: Date | null;

  @Column({ type: 'smallint', default: 1 })
  attempt: number;

  /** Set if and only if status is 'rto' (DB CHECK). */
  @Column({ type: 'varchar', length: 16, name: 'rto_reason', nullable: true })
  rtoReason: RtoReason | null;

  @Column({ type: 'timestamptz', name: 'returned_at', nullable: true })
  returnedAt: Date | null;

  @Column({ type: 'varchar', length: 8, name: 'return_condition', nullable: true })
  returnCondition: ReturnCondition | null;

  @Column({ type: 'timestamptz', name: 'shipped_at', nullable: true })
  shippedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'delivered_at', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
