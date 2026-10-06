import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export interface OrderCartItem {
  id: string;
  name: string;
  finish: string;
  size: string;
  price: number; // paise
  qty: number;
  image: string;
}

export interface OrderCustomer {
  name: string;
  email: string;
  phone: string;
}

export interface OrderAddress {
  line: string;
  city: string;
  state: string;
  pin: string;
}

export type OrderStatus =
  | 'placed'
  | 'confirmed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'returned';

export type PaymentMethod = 'online' | 'cod';

/** Mirrors the `Order` shape in i_Do_Frontend/lib/orders-storage.ts — keep the two in sync. */
@Entity('orders')
export class Order {
  @PrimaryColumn()
  id: string; // e.g. "IDO-XXXXXX"

  @CreateDateColumn({ type: 'timestamptz' })
  date: Date;

  @Column({ type: 'jsonb' })
  items: OrderCartItem[];

  @Column({ type: 'int' })
  subtotal: number; // paise

  @Column({ type: 'int' })
  codFee: number; // paise

  @Column({ type: 'int' })
  total: number; // paise

  @Column({ type: 'varchar' })
  paymentMethod: PaymentMethod;

  /** Null for COD orders — only ever set after a real Razorpay payment is verified (see OrdersService.create). */
  @Column({ type: 'varchar', nullable: true })
  razorpayOrderId: string | null;

  @Column({ type: 'varchar', nullable: true })
  razorpayPaymentId: string | null;

  @Column({ type: 'jsonb' })
  customer: OrderCustomer;

  @Column({ type: 'jsonb' })
  address: OrderAddress;

  @Column({ type: 'varchar', default: 'placed' })
  status: OrderStatus;

  /**
   * Always set on a new order (placing one requires an account — see
   * OrdersController). Nullable only because of historical guest rows from
   * before that requirement, and because account deletion nulls it out again.
   */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  userId: string | null;
}
