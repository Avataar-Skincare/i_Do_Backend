import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrderStateService } from './state/order-state.service';
import { OrderCreationService } from './create/order-creation.service';
import { SettingsModule } from '../settings/settings.module';
import { PaymentCaptureService } from './payment/payment-capture.service';
import { PaymentVerifyService } from './payment/payment-verify.service';
import { RazorpayWebhookService } from './payment/razorpay-webhook.service';
import { RazorpayWebhookController } from './payment/razorpay-webhook.controller';
import { PaymentSweepService } from './payment/payment-sweep.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    MailModule,
    UsersModule,
    PaymentsModule,
    SettingsModule,
  ],
  controllers: [OrdersController, RazorpayWebhookController],
  providers: [
    OrdersService,
    OrderStateService,
    OrderCreationService,
    PaymentCaptureService,
    PaymentVerifyService,
    RazorpayWebhookService,
    PaymentSweepService,
  ],
  exports: [OrdersService, OrderStateService],
})
export class OrdersModule {}
