import {
  ALL_ORDER_STATUSES,
  ORDER_TRANSITIONS,
  OrderTransition,
  decideTransition,
  initialStatus,
} from './order-transitions';
import type { ActorType } from '../entities/order-event.entity';
import type { OrderStatus } from '../entities/order.entity';

/**
 * The order state machine from LLD v1.4 §3.1. Transitions are named after the
 * LLD numbers; the "Forbidden transitions" list there says "a unit test
 * enumerates all of these" — this file is that test.
 */

// [transition, from, actor, expected to, expected cancel reason]
const ALLOWED: Array<
  [OrderTransition, OrderStatus, ActorType, OrderStatus, string | null]
> = [
  // 2: capture via webhook, the sweep job, or the customer's /payment/verify
  ['payment_captured', 'pending_payment', 'webhook', 'confirmed', null],
  ['payment_captured', 'pending_payment', 'system', 'confirmed', null],
  ['payment_captured', 'pending_payment', 'customer', 'confirmed', null],
  // 3: 24 h unpaid
  ['unpaid_expired', 'pending_payment', 'system', 'cancelled', 'unpaid'],
  // 5 / 6: COD confirmation (manual at launch)
  ['cod_confirmed', 'cod_pending', 'admin', 'confirmed', null],
  ['cod_unconfirmed', 'cod_pending', 'admin', 'cancelled', 'cod_unconfirmed'],
  // 7 / 8 / 9: sizing kit
  ['kit_shipped', 'confirmed', 'admin', 'kit_shipped', null],
  ['kit_delivered', 'kit_shipped', 'admin', 'kit_delivered', null],
  ['kit_rto', 'kit_shipped', 'admin', 'cancelled', 'kit_rto'],
  // 10 / 10b: size locks on submit; only ops can correct it, with a reason
  ['size_submitted', 'kit_delivered', 'customer', 'size_submitted', null],
  ['size_corrected', 'size_submitted', 'admin', 'size_submitted', null],
  // 11 / 12: ring
  ['ring_shipped', 'size_submitted', 'admin', 'ring_shipped', null],
  ['ring_delivered', 'ring_shipped', 'admin', 'ring_delivered', null],
  // 14: cancel before the ring ships (customer, or ops with reason admin)
  ['customer_cancel', 'confirmed', 'customer', 'cancelled', 'customer'],
  ['customer_cancel', 'kit_delivered', 'customer', 'cancelled', 'customer'],
  ['customer_cancel', 'size_submitted', 'customer', 'cancelled', 'customer'],
  ['admin_cancel', 'confirmed', 'admin', 'cancelled', 'admin'],
  ['admin_cancel', 'kit_delivered', 'admin', 'cancelled', 'admin'],
  ['admin_cancel', 'size_submitted', 'admin', 'cancelled', 'admin'],
  // 15: refused ring, once it is physically back
  [
    'ring_returned_refused',
    'ring_shipped',
    'admin',
    'cancelled',
    'ring_refused',
  ],
];

// Context that satisfies the physical-world guards (12 and 15).
const OK_CTX = { ringShipmentDelivered: true, ringReceivedBack: true };

describe('order state machine (LLD §3.1)', () => {
  describe('initial status (transitions 1 and 4)', () => {
    it('an online order starts in pending_payment', () => {
      expect(initialStatus('online')).toBe('pending_payment');
    });

    it('a COD order starts in cod_pending', () => {
      expect(initialStatus('cod')).toBe('cod_pending');
    });
  });

  describe('allowed transitions', () => {
    it.each(ALLOWED)(
      '%s: %s → %s by %s',
      (transition, from, actor, to, cancelReason) => {
        const d = decideTransition(transition, from, actor, OK_CTX);
        expect(d).toEqual(
          expect.objectContaining({ ok: true, to, cancelReason }),
        );
      },
    );
  });

  describe('every other (transition, status) pair is rejected', () => {
    const allowedPairs = new Set(ALLOWED.map(([t, from]) => `${t}|${from}`));
    // customer/admin cancel during kit_shipped is not a status change (see below)
    allowedPairs.add('customer_cancel|kit_shipped');
    allowedPairs.add('admin_cancel|kit_shipped');

    const pairs: Array<[OrderTransition, OrderStatus]> = [];
    for (const t of Object.keys(ORDER_TRANSITIONS) as OrderTransition[]) {
      for (const s of ALL_ORDER_STATUSES) {
        if (!allowedPairs.has(`${t}|${s}`)) pairs.push([t, s]);
      }
    }

    it.each(pairs)('%s from %s → INVALID_TRANSITION', (transition, from) => {
      const actor = ORDER_TRANSITIONS[transition].actors[0];
      const d = decideTransition(transition, from, actor, OK_CTX);
      expect(d).toEqual(
        expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
      );
    });
  });

  describe('forbidden transitions listed in the LLD', () => {
    it('nothing leaves cancelled', () => {
      for (const t of Object.keys(ORDER_TRANSITIONS) as OrderTransition[]) {
        const actor = ORDER_TRANSITIONS[t].actors[0];
        expect(decideTransition(t, 'cancelled', actor, OK_CTX)).toEqual(
          expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
        );
      }
    });

    it.each<OrderStatus>(['ring_shipped', 'ring_delivered'])(
      'no customer cancel from %s',
      (from) => {
        expect(
          decideTransition('customer_cancel', from, 'customer', OK_CTX),
        ).toEqual(
          expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
        );
      },
    );

    it('no transition leads from size_submitted back to kit_delivered', () => {
      for (const [t, rule] of Object.entries(ORDER_TRANSITIONS)) {
        if (rule.from.includes('size_submitted')) {
          expect(`${t} → ${rule.to}`).not.toMatch(/→ kit_delivered$/);
        }
      }
    });

    it.each<[OrderTransition, OrderStatus]>([
      ['kit_delivered', 'confirmed'], // skipping kit_shipped
      ['size_submitted', 'kit_shipped'], // skipping kit_delivered
      ['ring_shipped', 'kit_delivered'], // skipping size_submitted
      ['ring_delivered', 'size_submitted'], // skipping ring_shipped
    ])('cannot skip a step: %s from %s', (t, from) => {
      const actor = ORDER_TRANSITIONS[t].actors[0];
      expect(decideTransition(t, from, actor, OK_CTX)).toEqual(
        expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
      );
    });

    it('ring_delivered needs a delivered ring shipment', () => {
      expect(
        decideTransition('ring_delivered', 'ring_shipped', 'admin', {
          ringShipmentDelivered: false,
        }),
      ).toEqual(
        expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
      );
    });

    it('a customer cannot change a submitted size', () => {
      expect(
        decideTransition(
          'size_submitted',
          'size_submitted',
          'customer',
          OK_CTX,
        ),
      ).toEqual(
        expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
      );
      expect(
        decideTransition(
          'size_corrected',
          'size_submitted',
          'customer',
          OK_CTX,
        ),
      ).toEqual(expect.objectContaining({ ok: false, code: 'FORBIDDEN' }));
    });

    it.each<OrderStatus>(['ring_shipped', 'ring_delivered'])(
      'ops cannot correct the size once the ring is %s',
      (from) => {
        expect(
          decideTransition('size_corrected', from, 'admin', OK_CTX),
        ).toEqual(
          expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
        );
      },
    );

    it('no refused-ring refund before the ring is physically back', () => {
      expect(
        decideTransition('ring_returned_refused', 'ring_shipped', 'admin', {
          ringReceivedBack: false,
        }),
      ).toEqual(
        expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
      );
    });

    it('no ring refund once the ring is delivered', () => {
      expect(
        decideTransition(
          'ring_returned_refused',
          'ring_delivered',
          'admin',
          OK_CTX,
        ),
      ).toEqual(
        expect.objectContaining({ ok: false, code: 'INVALID_TRANSITION' }),
      );
    });

    it('replacement shipments have no order transition (they never change the status)', () => {
      expect(
        Object.keys(ORDER_TRANSITIONS).filter((t) => t.includes('replacement')),
      ).toEqual([]);
    });
  });

  describe('actors', () => {
    it.each<[OrderTransition, OrderStatus, ActorType]>([
      ['kit_shipped', 'confirmed', 'customer'],
      ['ring_shipped', 'size_submitted', 'customer'],
      ['cod_confirmed', 'cod_pending', 'customer'],
      ['size_submitted', 'kit_delivered', 'admin'],
      ['unpaid_expired', 'pending_payment', 'customer'],
      ['customer_cancel', 'confirmed', 'admin'],
      ['admin_cancel', 'confirmed', 'customer'],
      ['payment_captured', 'pending_payment', 'partner'],
    ])('%s from %s by %s → FORBIDDEN', (t, from, actor) => {
      expect(decideTransition(t, from, actor, OK_CTX)).toEqual(
        expect.objectContaining({ ok: false, code: 'FORBIDDEN' }),
      );
    });
  });

  describe('cancel while the kit is in transit (transition 14 note)', () => {
    it.each<[OrderTransition, ActorType]>([
      ['customer_cancel', 'customer'],
      ['admin_cancel', 'admin'],
    ])(
      '%s during kit_shipped is an RTO request, not a status change',
      (t, actor) => {
        expect(decideTransition(t, 'kit_shipped', actor, OK_CTX)).toEqual({
          ok: true,
          to: 'kit_shipped',
          cancelReason: null,
          statusChange: false,
          outcome: 'rto_requested',
          lld: '14',
        });
      },
    );
  });

  it('every transition records its LLD number', () => {
    for (const rule of Object.values(ORDER_TRANSITIONS)) {
      expect(rule.lld).toMatch(/^\d+b?$/);
    }
  });
});
