import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { RazorpayService } from '../payments/razorpay.service';
import { formatINR } from './format-inr';

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
  async create(dto: CreateOrderDto, userId: string): Promise<Order> {
    if (dto.paymentMethod === 'online') {
      if (!dto.razorpayOrderId || !dto.razorpayPaymentId || !dto.razorpaySignature) {
        throw new BadRequestException('Missing Razorpay payment details for an online order');
      }
      const verified = this.razorpayService.verifySignature(
        dto.razorpayOrderId,
        dto.razorpayPaymentId,
        dto.razorpaySignature,
      );
      if (!verified) {
        throw new BadRequestException('Payment verification failed');
      }
    }

    const id = `IDO-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    const order = this.ordersRepo.create({
      id,
      items: dto.items,
      subtotal: dto.subtotal,
      codFee: dto.codFee,
      total: dto.total,
      paymentMethod: dto.paymentMethod,
      customer: dto.customer,
      address: dto.address,
      status: 'placed',
      userId,
      razorpayOrderId: dto.razorpayOrderId ?? null,
      razorpayPaymentId: dto.razorpayPaymentId ?? null,
    });
    const saved = await this.ordersRepo.save(order);

    await this.sendOrderConfirmationEmail(saved).catch((err) =>
      this.logger.warn(`Order confirmation email failed for ${saved.id}: ${(err as Error).message}`),
    );

    // Opportunistic — only fills in whichever of email/phone the account doesn't already have, never overwrites either.
    await this.usersService.backfillPhoneIfMissing(userId, dto.customer.phone).catch((err) =>
      this.logger.warn(`Phone backfill failed for user ${userId}: ${(err as Error).message}`),
    );
    await this.usersService.backfillEmailIfMissing(userId, dto.customer.email).catch((err) =>
      this.logger.warn(`Email backfill failed for user ${userId}: ${(err as Error).message}`),
    );

    return saved;
  }

  /**
   * Attaches every guest order placed under this email to the now-identified
   * user. Orders can no longer be placed as a guest (see OrdersController),
   * so this only ever matters for rows left over from before that change —
   * kept so anyone who still has an old claim-order email link, or signs up
   * with the same email, recovers their historical orders.
   */
  async attachAllGuestOrdersForEmail(userId: string, email: string): Promise<void> {
    await this.ordersRepo
      .createQueryBuilder()
      .update(Order)
      .set({ userId })
      .where(`"userId" IS NULL AND LOWER(TRIM(customer->>'email')) = LOWER(TRIM(:email))`, { email })
      .execute();
  }

  private async sendOrderConfirmationEmail(order: Order): Promise<void> {
    const itemsHtml = order.items
      .map((item) => `<li>${item.name}${item.size ? ` · US ${item.size}` : ''} × ${item.qty} — ${formatINR(item.price * item.qty)}</li>`)
      .join('');

    await this.mailService.sendEmail({
      to: order.customer.email,
      subject: `Your i do order ${order.id} is confirmed`,
      html: `
        <p>Hi ${order.customer.name.split(' ')[0] || 'there'},</p>
        <p>Your order <strong>${order.id}</strong> is confirmed — here's what's coming:</p>
        <ul>${itemsHtml}</ul>
        <p><strong>Total: ${formatINR(order.total)}</strong></p>
        <p>Track it anytime from your account.</p>
      `,
    });
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.ordersRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async findMineForUser(userId: string): Promise<Order[]> {
    return this.ordersRepo.find({ where: { userId }, order: { date: 'DESC' } });
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
      },
    );
  }
}
