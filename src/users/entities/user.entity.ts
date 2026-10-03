import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type UserRole = 'user' | 'admin';

/**
 * This website's own account table — separate from the ring app's database.
 * Signing up here does not create an account on the ring app, and vice versa.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * One of email/phone is always set at signup (whichever the customer chose
   * — see AuthService.register), never both required. Either can log in
   * (UsersService.findByIdentifier). Whichever one is missing gets backfilled
   * the first time it shows up on an order or consult booking (both of which
   * always collect both independently — see OrdersService/ConsultsService),
   * but is never overwritten once set.
   */
  @Column({ type: 'varchar', length: 255, unique: true, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'varchar', length: 120, name: 'full_name', nullable: true })
  fullName: string | null;

  @Column({ type: 'enum', enum: ['user', 'admin'], enumName: 'user_role', default: 'user' })
  role: UserRole;

  /** Null until the signup OTP is confirmed — only applies to an account that signed up by email (see AuthService.register). */
  @Column({ type: 'timestamptz', name: 'email_verified_at', nullable: true })
  emailVerifiedAt: Date | null;

  @Column({ type: 'varchar', length: 10, nullable: true, unique: true })
  phone: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
