import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
  ) {}

  async create(dto: CreateOrderDto): Promise<Order> {
    const id = `IDO-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const order = this.ordersRepo.create({ ...dto, id, status: 'placed' });
    return this.ordersRepo.save(order);
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.ordersRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async findAll(): Promise<Order[]> {
    return this.ordersRepo.find({ order: { date: 'DESC' } });
  }
}
