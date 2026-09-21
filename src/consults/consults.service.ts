import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Consult } from './entities/consult.entity';
import { CreateConsultDto } from './dto/create-consult.dto';

@Injectable()
export class ConsultsService {
  constructor(
    @InjectRepository(Consult)
    private readonly consultsRepo: Repository<Consult>,
  ) {}

  /** Only one active booking per type per clientId — a new booking replaces the old one. */
  async create(dto: CreateConsultDto): Promise<Consult> {
    await this.consultsRepo.delete({ clientId: dto.clientId, type: dto.type });
    const id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const consult = this.consultsRepo.create({ ...dto, id, concern: dto.concern ?? '' });
    return this.consultsRepo.save(consult);
  }

  async findForClient(clientId: string): Promise<Consult[]> {
    return this.consultsRepo.find({ where: { clientId } });
  }
}
