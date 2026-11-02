import type { ActorType } from '../entities/order-event.entity';
import type {
  CancelReason,
  OrderStatus,
  PaymentMethod,
} from '../entities/order.entity';

/**
 * The order state machine — LLD v1.4 §3.1, as pure rules (no database).
 *
 * OrderStateService asks `decideTransition` whether a move is allowed, then
 * applies it with a guarded UPDATE so concurrent callers can't both win.
 * Every allowed move is listed here; anything not listed is forbidden, which
 * is how the LLD's "Forbidden transitions" list holds by construction.
 * Side effects (stock, refunds, entitlements, notifications) are not here —
 * they belong to the service that performs the transition.
 */

export const ALL_ORDER_STATUSES: readonly OrderStatus[] = [
  'pending_payment',
  'cod_pending',
  'confirmed',
  'kit_shipped',
  'kit_delivered',
  'size_submitted',
  'ring_shipped',
  'ring_delivered',
  'cancelled',
];

/** Facts from outside the orders row that some transitions depend on. */
export interface TransitionContext {
  /** 12: the order's first ring shipment is marked delivered. */
  ringShipmentDelivered?: boolean;
  /** 15: the refused ring is physically back at the warehouse (TD-26). */
  ringReceivedBack?: boolean;
}

export interface TransitionRule {
  /** Transition number in LLD §3.1. */
  lld: string;
  from: readonly OrderStatus[];
  to: OrderStatus;
  cancelReason: CancelReason | null;
  actors: readonly ActorType[];
  /** Returns a reason when a context fact is missing. */
  guard?: (ctx: TransitionContext) => string | null;
}

// Cancel is allowed until the ring ships; during kit_shipped it becomes an RTO request.
const CANCELLABLE: readonly OrderStatus[] = [
  'confirmed',
  'kit_shipped',
  'kit_delivered',
  'size_submitted',
];

export type OrderTransition =
  | 'payment_captured'
  | 'unpaid_expired'
  | 'cod_confirmed'
  | 'cod_unconfirmed'
  | 'kit_shipped'
  | 'kit_delivered'
  | 'kit_rto'
  | 'size_submitted'
  | 'size_corrected'
  | 'ring_shipped'
  | 'ring_delivered'
  | 'customer_cancel'
  | 'admin_cancel'
  | 'ring_returned_refused';

export const ORDER_TRANSITIONS: Record<OrderTransition, TransitionRule> = {
  payment_captured: {
    lld: '2',
    from: ['pending_payment'],
    to: 'confirmed',
    cancelReason: null,
    actors: ['webhook', 'system', 'customer'],
  },
  unpaid_expired: {
    lld: '3',
    from: ['pending_payment'],
    to: 'cancelled',
    cancelReason: 'unpaid',
    actors: ['system'],
  },
  cod_confirmed: {
    lld: '5',
    from: ['cod_pending'],
    to: 'confirmed',
    cancelReason: null,
    actors: ['admin'],
  },
  cod_unconfirmed: {
    lld: '6',
    from: ['cod_pending'],
    to: 'cancelled',
    cancelReason: 'cod_unconfirmed',
    actors: ['admin'],
  },
  kit_shipped: {
    lld: '7',
    from: ['confirmed'],
    to: 'kit_shipped',
    cancelReason: null,
    actors: ['admin'],
  },
  kit_delivered: {
    lld: '8',
    from: ['kit_shipped'],
    to: 'kit_delivered',
    cancelReason: null,
    actors: ['admin'],
  },
  kit_rto: {
    lld: '9',
    from: ['kit_shipped'],
    to: 'cancelled',
    cancelReason: 'kit_rto',
    actors: ['admin'],
  },
  size_submitted: {
    lld: '10',
    from: ['kit_delivered'],
    to: 'size_submitted',
    cancelReason: null,
    actors: ['customer'],
  },
  size_corrected: {
    lld: '10b',
    from: ['size_submitted'],
    to: 'size_submitted',
    cancelReason: null,
    actors: ['admin'],
  },
  ring_shipped: {
    lld: '11',
    from: ['size_submitted'],
    to: 'ring_shipped',
    cancelReason: null,
    actors: ['admin'],
  },
  ring_delivered: {
    lld: '12',
    from: ['ring_shipped'],
    to: 'ring_delivered',
    cancelReason: null,
    actors: ['admin'],
    guard: (ctx) =>
      ctx.ringShipmentDelivered
        ? null
        : 'the ring shipment is not marked delivered',
  },
  customer_cancel: {
    lld: '14',
    from: CANCELLABLE,
    to: 'cancelled',
    cancelReason: 'customer',
    actors: ['customer'],
  },
  admin_cancel: {
    lld: '14',
    from: CANCELLABLE,
    to: 'cancelled',
    cancelReason: 'admin',
    actors: ['admin'],
  },
  ring_returned_refused: {
    lld: '15',
    from: ['ring_shipped'],
    to: 'cancelled',
    cancelReason: 'ring_refused',
    actors: ['admin'],
    guard: (ctx) =>
      ctx.ringReceivedBack ? null : 'the ring is not back at the warehouse yet',
  },
};

export type TransitionDecision =
  | {
      ok: true;
      to: OrderStatus;
      cancelReason: CancelReason | null;
      /** false when the request is accepted but the status stays (cancel during kit_shipped). */
      statusChange: boolean;
      outcome?: 'rto_requested';
      lld: string;
    }
  | { ok: false; code: 'INVALID_TRANSITION' | 'FORBIDDEN'; reason: string };

/** Transitions 1 and 4: the status a new order is created in. */
export function initialStatus(paymentMethod: PaymentMethod): OrderStatus {
  return paymentMethod === 'cod' ? 'cod_pending' : 'pending_payment';
}

export function decideTransition(
  transition: OrderTransition,
  from: OrderStatus,
  actor: ActorType,
  ctx: TransitionContext = {},
): TransitionDecision {
  const rule: TransitionRule = ORDER_TRANSITIONS[transition];

  if (!rule.actors.includes(actor)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      reason: `${actor} cannot perform ${transition}`,
    };
  }
  if (!rule.from.includes(from)) {
    return {
      ok: false,
      code: 'INVALID_TRANSITION',
      reason: `${transition} is not allowed from ${from}`,
    };
  }
  const blocked = rule.guard?.(ctx);
  if (blocked) {
    return { ok: false, code: 'INVALID_TRANSITION', reason: blocked };
  }

  // A cancel while the kit is in transit is recorded as an RTO request; the
  // order stays kit_shipped until the kit is delivered (8) or returned (9).
  if (
    (transition === 'customer_cancel' || transition === 'admin_cancel') &&
    from === 'kit_shipped'
  ) {
    return {
      ok: true,
      to: 'kit_shipped',
      cancelReason: null,
      statusChange: false,
      outcome: 'rto_requested',
      lld: rule.lld,
    };
  }

  return {
    ok: true,
    to: rule.to,
    cancelReason: rule.cancelReason,
    statusChange: rule.to !== from,
    lld: rule.lld,
  };
}
