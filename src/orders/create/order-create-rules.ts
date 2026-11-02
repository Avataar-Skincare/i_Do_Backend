import * as crypto from 'crypto';
import type { Finish } from '../../catalog/entities/sku.entity';
import type {
  OrderAddress,
  OrderCustomer,
  PaymentMethod,
} from '../entities/order.entity';

/** Pure rules for POST /orders (LLD §3.1 transitions 1 and 4, §5, §9). */

// Crockford base32: no I, L, O, U — readable over the phone.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Order id: 'IDO-' + 10 random Crockford characters (50 bits; the PK rejects the rare clash). */
export function newOrderId(): string {
  const bytes = crypto.randomBytes(10);
  let id = 'IDO-';
  for (const b of bytes) id += CROCKFORD[b & 31];
  return id;
}

export interface LaunchGateSettings {
  kit_price_paise: number | null;
  /** Printed on every invoice (TD-14). */
  hsn_code: string | null;
  /** state decides intra- vs inter-state GST (CGST+SGST or IGST) on the invoice. */
  seller: { gstin: string | null; state: string | null } & Record<
    string,
    unknown
  >;
  support_contacts: { email: string | null; phone: string | null } & Record<
    string,
    unknown
  >;
}

/**
 * LLD §9 launch gate: POST /orders answers 503 STORE_NOT_LIVE while any of
 * these is unset. Returns the missing setting names (empty = open for orders).
 */
export function launchGateMissing(s: LaunchGateSettings): string[] {
  const missing: string[] = [];
  if (s.kit_price_paise === null || s.kit_price_paise === undefined)
    missing.push('kit_price_paise');
  if (!s.hsn_code) missing.push('hsn_code');
  if (!s.seller?.gstin) missing.push('seller.gstin');
  if (!s.seller?.state) missing.push('seller.state');
  if (!s.support_contacts?.email) missing.push('support_contacts.email');
  if (!s.support_contacts?.phone) missing.push('support_contacts.phone');
  return missing;
}

/** What the customer chose: the fields an Idempotency-Key replay must match exactly. */
export interface OrderDetails {
  finish: Finish;
  paymentMethod: PaymentMethod;
  customer: OrderCustomer;
  address: OrderAddress;
  buyerGstin?: string | null;
  buyerLegalName?: string | null;
  offerCode?: string | null;
}

function canonical(d: OrderDetails) {
  return JSON.stringify([
    d.finish,
    d.paymentMethod,
    [d.customer.name, d.customer.email, d.customer.phone],
    [d.address.line, d.address.city, d.address.state, d.address.pin],
    d.buyerGstin ?? null,
    d.buyerLegalName ?? null,
    d.offerCode ?? null,
  ]);
}

/**
 * Same Idempotency-Key with the same details → it's a retry: return the
 * existing order. Same key with different details → 409
 * IDEMPOTENCY_KEY_REUSED (decided 22 Oct): never silently return an order
 * the customer didn't choose (e.g. Gold after they switched to Silver).
 */
export function sameOrderDetails(
  existing: OrderDetails,
  incoming: OrderDetails,
): boolean {
  return canonical(existing) === canonical(incoming);
}
