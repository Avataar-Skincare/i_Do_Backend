import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { email } });
  }

  findByPhone(phone: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { phone } });
  }

  /** Login accepts either identifier — a 10-digit input is checked as a phone, anything else as an email. */
  findByIdentifier(identifier: string): Promise<User | null> {
    return /^\d{10}$/.test(identifier) ? this.findByPhone(identifier) : this.findByEmail(identifier);
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id } });
  }

  create(input: { email?: string; phone?: string; passwordHash: string; fullName?: string }): Promise<User> {
    const user = this.usersRepo.create({
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash,
      fullName: input.fullName ?? null,
    });
    return this.usersRepo.save(user);
  }

  async deleteById(id: string): Promise<void> {
    await this.usersRepo.delete({ id });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.usersRepo.update({ id: userId }, { passwordHash });
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.usersRepo.update({ id: userId }, { emailVerifiedAt: new Date() });
  }

  /**
   * Opportunistic only — never overwrites a phone the account already has.
   * An account can sign up with just an email (no phone), so this fills the
   * gap the first time one shows up on an order or consult booking.
   */
  async backfillPhoneIfMissing(userId: string, phone: string): Promise<void> {
    await this.usersRepo
      .createQueryBuilder()
      .update(User)
      .set({ phone })
      .where('id = :userId AND phone IS NULL', { userId })
      .execute();
  }

  /** Mirrors backfillPhoneIfMissing — for an account that signed up with just a phone (no email). */
  async backfillEmailIfMissing(userId: string, email: string): Promise<void> {
    await this.usersRepo
      .createQueryBuilder()
      .update(User)
      .set({ email })
      .where('id = :userId AND email IS NULL', { userId })
      .execute();
  }
}
