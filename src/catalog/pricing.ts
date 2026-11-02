import type { Finish } from './entities/sku.entity';
import type { PaymentMethod } from '../orders/entities/order.entity';

/**
 * Server-side pricing (LLD §5: GET /catalog, POST /orders/quote).
 * Pure functions over the `settings` values — no database — so the rules are
 * tested exhaustively. The browser never sends prices; POST /orders calls
 * `quote` again and stores what the server computed.
 */

/** The settings keys pricing reads (seeded by migration M13). */
export interface PricingSettings {
  ring_price_paise: number;
  ring_list_price_paise: number;
  cod_enabled: boolean;
  cod_fee_paise: number;
  /** 'all' = any pincode; 'allow' = only `cod_pincodes`. Anything else = not serviceable (fail safe). */
  cod_pincode_mode: string;
  cod_pincodes: string[];
  launch_offer: {
    enabled: boolean;
    kind: string | null;
    amount_paise: number;
    code: string | null;
  };
  social_proof_enabled: boolean;
}

export interface QuoteInput {
  finish: Finish;
  paymentMethod: PaymentMethod;
  pin: string;
  offerCode?: string;
}

export interface Quote {
  subtotal: number;
  codFee: number;
  discount: number;
  total: number;
  codAvailable: boolean;
  codReason?: 'cod_disabled' | 'pincode_not_serviceable';
}

export interface CatalogSku {
  id: string;
  kind: string;
  finish: string | null;
  usSize: number | null;
  onHand: number;
  reserved: number;
  active: boolean;
}

export interface Catalog {
  pricePaise: number;
  listPricePaise: number;
  kitIncluded: true;
  codFeePaise: number;
  codEnabled: boolean;
  finishes: Array<{
    id: Finish;
    name: string;
    sizes: Array<{ us: number; inStock: boolean }>;
  }>;
  offer: { enabled: boolean };
  socialProof: boolean;
}

const FINISHES: ReadonlyArray<{ id: Finish; name: string }> = [
  { id: 'gold', name: 'Gold' },
  { id: 'silver', name: 'Silver' },
  { id: 'black', name: 'Black' },
];

/** Whether COD can be offered at this pincode, and why not. */
export function codAvailability(
  s: PricingSettings,
  pin: string,
): Pick<Quote, 'codAvailable' | 'codReason'> {
  if (!s.cod_enabled) return { codAvailable: false, codReason: 'cod_disabled' };
  const serviceable =
    s.cod_pincode_mode === 'all' ||
    (s.cod_pincode_mode === 'allow' && s.cod_pincodes.includes(pin));
  return serviceable
    ? { codAvailable: true }
    : { codAvailable: false, codReason: 'pincode_not_serviceable' };
}

/** One ring per order; the sizing kit is included at ₹0. Launch offer is parked (always 0 while off). */
export function quote(s: PricingSettings, input: QuoteInput): Quote {
  const subtotal = s.ring_price_paise;
  const cod = codAvailability(s, input.pin);
  const codFee =
    input.paymentMethod === 'cod' && cod.codAvailable ? s.cod_fee_paise : 0;
  const discount = 0;
  return {
    subtotal,
    codFee,
    discount,
    total: subtotal + codFee - discount,
    ...cod,
  };
}

export function buildCatalog(s: PricingSettings, skus: CatalogSku[]): Catalog {
  const finishes = FINISHES.map(({ id, name }) => ({
    id,
    name,
    sizes: skus
      .filter(
        (k) =>
          k.kind === 'ring' && k.finish === id && k.active && k.usSize !== null,
      )
      .sort((a, b) => (a.usSize as number) - (b.usSize as number))
      .map((k) => ({
        us: k.usSize as number,
        inStock: k.onHand - k.reserved >= 1,
      })),
  })).filter((f) => f.sizes.length > 0);

  return {
    pricePaise: s.ring_price_paise,
    listPricePaise: s.ring_list_price_paise,
    kitIncluded: true,
    codFeePaise: s.cod_fee_paise,
    codEnabled: s.cod_enabled,
    finishes,
    offer: { enabled: s.launch_offer.enabled },
    socialProof: s.social_proof_enabled,
  };
}
