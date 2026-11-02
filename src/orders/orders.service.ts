import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { toOrderView, type OrderView } from './order-view';
import { apiError } from '../common/api-error';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
  ) {}

  /** The customer's view of one of their own orders; 404 for anyone else's (never reveal it exists). */
  async findOneForUser(id: string, userId: string): Promise<OrderView> {
    const order = await this.ordersRepo.findOne({ where: { id, userId } });
    if (!order) throw apiError(404, 'NOT_FOUND', `Order ${id} not found`);
    return toOrderView(order);
  }

  /** Account → Orders: newest first; never a pending_payment order (an abandoned checkout isn't an order yet). */
  async findMineForUser(userId: string): Promise<OrderView[]> {
    const orders = await this.ordersRepo.find({
      where: { userId, status: Not('pending_payment') },
      order: { createdAt: 'DESC' },
    });
    return orders.map(toOrderView);
  }

  /**
   * Called on account deletion — the order itself is kept (accounting/tax
   * records), but nothing personally identifying stays attached to it.
   */
  async anonymizeForUser(userId: string): Promise<void> {
    await this.ordersRepo.update(
      { userId },
      {
        userId: null,
        customer: { name: 'Deleted customer', email: '', phone: '' },
        address: { line: '', city: '', state: '', pin: '' },
        piiScrubbedAt: new Date(),
      },
    );
  }
}
