import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type ConsultType = 'derm' | 'dietician';

/**
 * PENDING: booked against an entitlement, no doctor assigned yet.
 * CONFIRMED: partner-app booked a real doctor and called back with
 * appointmentAt/doctorName/meetingLink.
 * COMPLETED: partner marked it done (a no-show is also COMPLETED, with a note).
 * CANCELLED: the customer cancelled — frees the entitlement while its window is open.
 */
export type ConsultStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

/**
 * Every consult belongs to an entitlement earned by a delivered ring; at most
 * one non-cancelled consult per entitlement (partial UNIQUE). name/phone/email
 * are stored on the row so partner-app's staff queue needs no second lookup.
 */
@Entity('consults')
@Index('UQ_consults_one_active', ['entitlementId'], { unique: true, where: `"status" <> 'CANCELLED'` })
export class Consult {
  /** 'c_' + random. */
  @PrimaryColumn({ type: 'varchar', length: 40 })
  id: string;

  @Index('IDX_consults_user')
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'entitlement_id' })
  entitlementId: string;

  @Column({ type: 'varchar', length: 10 })
  type: ConsultType;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  phone: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'date', name: 'appointment_date' })
  appointmentDate: string;

  @Column({ type: 'varchar', length: 8, name: 'time_slot' })
  timeSlot: string;

  /** Set by the partner on confirm. */
  @Column({ type: 'timestamptz', name: 'appointment_at', nullable: true })
  appointmentAt: Date | null;

  @Column({ type: 'text', default: '' })
  concern: string;

  @Column({ type: 'varchar', length: 10, default: 'PENDING' })
  status: ConsultStatus;

  @Column({ type: 'varchar', length: 120, name: 'doctor_name', nullable: true })
  doctorName: string | null;

  @Column({ type: 'text', name: 'meeting_link', nullable: true })
  meetingLink: string | null;

  @Column({ type: 'timestamptz', name: 'confirmed_at', nullable: true })
  confirmedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
