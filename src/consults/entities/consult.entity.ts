import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type ConsultType = 'derm' | 'dietician';

/**
 * Mirrors `StoredConsult` in i_Do_Frontend/lib/consults-storage.ts, plus `clientId`.
 *
 * The frontend today has no concept of an identity at all — bookings live in one
 * browser's localStorage. The moment this table is shared across visitors, "one
 * active booking per type" (Data_Model.md) needs *something* to scope "per user"
 * to, or every visitor's dermatologist booking would overwrite everyone else's.
 * Real auth is deferred until /account is built (CLAUDE.md), so `clientId` is a
 * stand-in: a stable anonymous id the frontend generates once and keeps in
 * localStorage. Swap it for a real userId once accounts exist — don't just add
 * userId alongside it later without migrating existing rows.
 */
@Entity('consults')
export class Consult {
  @PrimaryColumn()
  id: string;

  @Column({ type: 'varchar' })
  clientId: string;

  @Column({ type: 'varchar' })
  type: ConsultType;

  @Column({ type: 'varchar' })
  dayLabel: string;

  @Column({ type: 'varchar' })
  timeSlot: string;

  @Column({ type: 'text', default: '' })
  concern: string;

  @CreateDateColumn()
  createdAt: Date;
}
