import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Consult, ConsultStatus } from './entities/consult.entity';
import { CreateConsultDto } from './dto/create-consult.dto';
import { ConfirmConsultDto } from './dto/confirm-consult.dto';
import { RescheduleConsultDto } from './dto/reschedule-consult.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class ConsultsService {
  private readonly logger = new Logger(ConsultsService.name);

  constructor(
    @InjectRepository(Consult)
    private readonly consultsRepo: Repository<Consult>,
    private readonly usersService: UsersService,
  ) {}

  /** A customer can hold any number of sessions per type at once — each is booked, tracked and rescheduled independently. */
  async create(dto: CreateConsultDto, userId: string): Promise<Consult> {
    const id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const consult = this.consultsRepo.create({ ...dto, id, userId, concern: dto.concern ?? '' });
    const saved = await this.consultsRepo.save(consult);

    // Opportunistic — only fills in whichever of email/phone the account doesn't already have, never overwrites either.
    await this.usersService.backfillPhoneIfMissing(userId, dto.phone).catch((err) =>
      this.logger.warn(`Phone backfill failed for user ${userId}: ${(err as Error).message}`),
    );
    await this.usersService.backfillEmailIfMissing(userId, dto.email).catch((err) =>
      this.logger.warn(`Email backfill failed for user ${userId}: ${(err as Error).message}`),
    );

    return saved;
  }

  /** Ownership-checked — a customer can only cancel their own booking. */
  async cancel(id: string, userId: string): Promise<Consult> {
    const consult = await this.consultsRepo.findOne({ where: { id, userId } });
    if (!consult) {
      throw new NotFoundException(`Consult ${id} not found`);
    }
    consult.status = 'CANCELLED';
    return this.consultsRepo.save(consult);
  }

  /**
   * Customer-initiated reschedule. If this session was already CONFIRMED, the
   * doctor who was assigned may not be free at the new time — so it drops back
   * to PENDING (clearing the stale doctor/meeting details) instead of silently
   * keeping a confirmed slot that's no longer accurate; ops re-confirms it at
   * the new time via `rescheduleByPartner` below.
   */
  async reschedule(id: string, userId: string, dto: RescheduleConsultDto): Promise<Consult> {
    const consult = await this.consultsRepo.findOne({ where: { id, userId } });
    if (!consult) {
      throw new NotFoundException(`Consult ${id} not found`);
    }
    if (consult.status === 'CANCELLED') {
      throw new ConflictException(`Consult ${id} was cancelled — book a new session instead of rescheduling this one`);
    }
    consult.dayLabel = dto.dayLabel;
    consult.timeSlot = dto.timeSlot;
    if (consult.status === 'CONFIRMED') {
      consult.status = 'PENDING';
      consult.doctorName = null;
      consult.meetingLink = null;
      consult.confirmedAt = null;
    }
    return this.consultsRepo.save(consult);
  }

  /**
   * Ops-initiated reschedule from partner-app's "i do Consultations" tab — the
   * doctor is already assigned, this is ops re-confirming a new time with them,
   * not a fresh booking, so it stays (or becomes) CONFIRMED. Only valid on a
   * session that's already been confirmed at least once — a still-PENDING lead
   * goes through the normal Book/SkinRx flow instead, and a cancelled one can't
   * be revived (same protection as `confirmLead`).
   */
  async rescheduleByPartner(id: string, dto: RescheduleConsultDto): Promise<Consult> {
    const consult = await this.consultsRepo.findOne({ where: { id } });
    if (!consult) {
      throw new NotFoundException(`Consult ${id} not found`);
    }
    if (consult.status !== 'CONFIRMED') {
      throw new ConflictException(
        `Consult ${id} is ${consult.status.toLowerCase()}, not confirmed — nothing to reschedule yet`,
      );
    }
    consult.dayLabel = dto.dayLabel;
    consult.timeSlot = dto.timeSlot;
    return this.consultsRepo.save(consult);
  }

  async findMineForUser(userId: string): Promise<Consult[]> {
    return this.consultsRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  /** Called on account deletion — unlike orders, consults are hard-deleted, not anonymized. */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.consultsRepo.delete({ userId });
  }

  /**
   * For partner-app-server's "i do Consultations" tab — everything by default
   * (so staff have a real history to check, not just the live queue), or one
   * status when the dashboard's filter asks for it.
   */
  async findLeadsForPartner(status?: ConsultStatus): Promise<Consult[]> {
    return this.consultsRepo.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  /** Called by partner-app-server once a staff member books a real doctor for this lead. */
  async confirmLead(id: string, dto: ConfirmConsultDto): Promise<Consult> {
    const consult = await this.consultsRepo.findOne({ where: { id } });
    if (!consult) {
      throw new NotFoundException(`Consult ${id} not found`);
    }
    if (consult.status === 'CANCELLED') {
      // The customer cancelled this — now that partner-app shows cancelled
      // leads in its history view, staff could otherwise click Book on one
      // and silently resurrect a request the customer no longer wants.
      throw new ConflictException(`Consult ${id} was cancelled by the customer and can't be confirmed`);
    }
    consult.status = 'CONFIRMED';
    consult.doctorName = dto.doctorName;
    consult.meetingLink = dto.meetingLink ?? null;
    consult.confirmedAt = new Date();
    return this.consultsRepo.save(consult);
  }
}
