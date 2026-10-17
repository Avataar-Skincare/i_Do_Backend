import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Business rules that ops must never edit from the dashboard (LLD §2.1). The
 * settings API will refuse writes to these keys; they change only by migration.
 */
export const READ_ONLY_SETTING_KEYS = [
  'max_rings_per_order',
  'size_window_days',
  'consult_window_days',
  'replacement_window_days',
  'warranty_months',
  'cod_reply_timeout_hours',
  'cod_max_call_attempts',
  'staff_session_hours',
  'step_up_minutes',
  'refund_full_before_kit_ship',
  'kit_rto_refund_full',
] as const;

@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  /** Staff user who last changed it; null for seeds. */
  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy: string | null;
}
