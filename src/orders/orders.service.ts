import { Injectable, Logger, NotFoundException, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { RazorpayService } from '../payments/razorpay.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepo: Repository<Order>,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly razorpayService: RazorpayService,
  ) {}

  /** A real Razorpay order, created before the customer pays — see OrdersController.createRazorpayOrder. */
  async createRazorpayOrder(amount: number, userId: string): Promise<{ id: string; amount: number; currency: string; keyId: string }> {
    const receipt = `ido_${userId.slice(0, 8)}_${Date.now()}`;
    const order = await this.razorpayService.createOrder(amount, receipt);
    return { ...order, keyId: this.razorpayService.keyId };
  }

  /**
   * Placing an order requires an account (see OrdersController) — userId is
   * always real, never a guest. For an online payment, the signature is the
   * only thing that actually proves the customer paid — Razorpay signs it
   * server-side with the account's key secret, so recomputing and comparing
   * it here (RazorpayService.verifySignature) is the real check; nothing
   * the browser claims about its own payment is trusted on its own. COD
   * skips all of this — there's no payment yet to verify.
   */
  // TODO(LLD v1.4 §5/§6): rebuild order placement on the new schema — finish
  // + idempotency key, prices from settings, payments row, OrderStateService.
  // The old body wrote items/date/razorpay* columns that M15 dropped.
  async create(_dto: CreateOrderDto, _userId: string): Promise<Order> {
    throw new NotImplementedException('Order placement is being rebuilt for LLD v1.4');
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.ordersRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async findMineForUser(userId: string): Promise<Order[]> {
    return this.ordersRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
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
