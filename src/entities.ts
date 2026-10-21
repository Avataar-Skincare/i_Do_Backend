import { User } from './users/entities/user.entity';
import { PasswordResetToken } from './auth/entities/password-reset-token.entity';
import { EmailVerificationCode } from './auth/entities/email-verification-code.entity';
import { PhoneOtp } from './auth/entities/phone-otp.entity';
import { EmailOtp } from './auth/entities/email-otp.entity';
import { RefreshToken } from './auth/entities/refresh-token.entity';
import { Setting } from './settings/entities/setting.entity';
import { Sku } from './catalog/entities/sku.entity';
import { Order } from './orders/entities/order.entity';
import { Shipment } from './orders/entities/shipment.entity';
import { OrderEvent } from './orders/entities/order-event.entity';
import { Payment } from './payments/entities/payment.entity';
import { PaymentEvent } from './payments/entities/payment-event.entity';
import { Refund } from './payments/entities/refund.entity';
import { ConsultEntitlement } from './consults/entities/consult-entitlement.entity';
import { Consult } from './consults/entities/consult.entity';
import { ReplacementClaim } from './claims/entities/replacement-claim.entity';
import { ClaimAttachment } from './claims/entities/claim-attachment.entity';
import { Notification } from './notifications/entities/notification.entity';
import { DocumentSeries } from './invoices/entities/document-series.entity';
import { Invoice } from './invoices/entities/invoice.entity';
import { CreditNote } from './invoices/entities/credit-note.entity';
import { NewsletterSubscriber } from './newsletter/entities/newsletter-subscriber.entity';

/**
 * Every TypeORM entity, shared by app.module.ts and data-source.ts so the two
 * lists can never drift. Add new entities here only.
 */
export const ENTITIES = [
  User,
  PasswordResetToken,
  EmailVerificationCode,
  PhoneOtp,
  EmailOtp,
  RefreshToken,
  Setting,
  Sku,
  Order,
  Shipment,
  OrderEvent,
  Payment,
  PaymentEvent,
  Refund,
  ConsultEntitlement,
  Consult,
  ReplacementClaim,
  ClaimAttachment,
  Notification,
  DocumentSeries,
  Invoice,
  CreditNote,
  NewsletterSubscriber,
];
