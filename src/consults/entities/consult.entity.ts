import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type ConsultType = 'derm' | 'dietician';

/**
 * PENDING: the customer requested a slot, no staff member has acted on it yet.
 * CONFIRMED: a staff member booked an actual doctor for this lead via the
 * partner-app SkinRx flow (see ApiKeyGuard-protected endpoints below) and it
 * called back here with the real doctor/meeting details.
 * CANCELLED: the customer cancelled it themselves. A customer can hold any
 * number of PENDING/CONFIRMED sessions per type at once (see
 * ConsultsService.create) — CANCELLED just excludes a row from the
 * per-customer slot-conflict check, it isn't a booking-limit mechanism.
 */
export type ConsultStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

/**
 * Booking requires a logged-in account (see ConsultsController — `POST /` takes
 * JwtAuthGuard, not the optional one this used to have). `name`/`phone` are
 * still asked for at booking time (the account has neither), while `email`
 * comes from the verified JWT, not client input. Storing all three directly on
 * the row — rather than only `userId` and joining back to the account later —
 * means partner-app-server's staff queue (`GET /consults/partner/pending`) has
 * everything needed to actually contact the customer without a second lookup.
 */
@Entity('consults')
export class Consult {
  @PrimaryColumn()
  id: string;

  @Index()
  @Column({ type: 'varchar' })
  userId: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  phone: string;

  @Column({ type: 'varchar' })
  email: string;

  @Column({ type: 'varchar' })
  type: ConsultType;

  @Column({ type: 'varchar' })
  dayLabel: string;

  @Column({ type: 'varchar' })
  timeSlot: string;

  @Column({ type: 'text', default: '' })
  concern: string;

  @Column({ type: 'varchar', default: 'PENDING' })
  status: ConsultStatus;

  /** Set by partner-app once a staff member books a real doctor for this lead. */
  @Column({ type: 'varchar', nullable: true })
  doctorName: string | null;

  @Column({ type: 'varchar', nullable: true })
  meetingLink: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
