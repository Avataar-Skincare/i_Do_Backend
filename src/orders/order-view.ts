import type { Order } from './entities/order.entity';

/**
 * The contract's `Order` (customer view, owner only). Built from the orders
 * row; shipments, refund, claim, invoice, credit notes and the consult window
 * are empty here — they exist only once the order moves past payment, and
 * GET /orders/:id will fill them in when those modules land.
 */
export function toOrderView(o: Order) {
  return {
    id: o.id,
    status: o.status,
    cancelReason: o.cancelReason,
    paymentMethod: o.paymentMethod,
    finish: o.finish,
    usSize: o.usSize,
    unitPrice: o.unitPrice,
    listPrice: o.listPrice,
    subtotal: o.subtotal,
    codFee: o.codFee,
    discount: o.discount,
    total: o.total,
    amountPaid: o.amountPaid,
    kitPriceSnapshot: o.kitPriceSnapshot,
    customer: o.customer,
    address: o.address,
    shipments: [] as unknown[],
    refund: null,
    claim: null,
    invoice: null,
    creditNotes: [] as unknown[],
    consultWindow: null,
    sizeDueAt: o.sizeDueAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

export type OrderView = ReturnType<typeof toOrderView>;
