import {
  launchGateMissing,
  newOrderId,
  sameOrderDetails,
  OrderDetails,
} from './order-create-rules';

describe('newOrderId', () => {
  it("is 'IDO-' + 10 Crockford base32 characters (no I, L, O, U)", () => {
    for (let i = 0; i < 500; i++) {
      expect(newOrderId()).toMatch(/^IDO-[0-9A-HJKMNP-TV-Z]{10}$/);
    }
  });

  it('does not repeat across many draws', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newOrderId()));
    expect(ids.size).toBe(5000);
  });
});

describe('launchGateMissing (LLD §9: no orders until the store is configured)', () => {
  const ready = {
    kit_price_paise: 99900,
    hsn_code: '85176290',
    seller: {
      legal_name: 'Misya Beauty Tech Pvt. Ltd.',
      gstin: '27AAACM1234A1Z5',
      state: 'MH',
      address: 'Pune',
    },
    support_contacts: {
      email: 'support@idowellness.ai',
      phone: '9800000001',
      whatsapp: null,
    },
  };

  it('nothing missing when kit price, HSN, seller GSTIN + state and support email + phone are set', () => {
    expect(launchGateMissing(ready)).toEqual([]);
  });

  it('lists every missing setting (the seeded launch state)', () => {
    expect(
      launchGateMissing({
        kit_price_paise: null,
        hsn_code: null,
        seller: {
          legal_name: 'Misya Beauty Tech Pvt. Ltd.',
          gstin: null,
          state: null,
          address: null,
        },
        support_contacts: { email: null, phone: null, whatsapp: null },
      }),
    ).toEqual([
      'kit_price_paise',
      'hsn_code',
      'seller.gstin',
      'seller.state',
      'support_contacts.email',
      'support_contacts.phone',
    ]);
  });

  it('a kit price of 0 is a valid price (the kit can be free)', () => {
    expect(launchGateMissing({ ...ready, kit_price_paise: 0 })).toEqual([]);
  });
});

describe('sameOrderDetails (Idempotency-Key: same key must mean the same order)', () => {
  const base: OrderDetails = {
    finish: 'gold',
    paymentMethod: 'online',
    customer: {
      name: 'Ananya Sharma',
      email: 'ananya@example.com',
      phone: '9800000001',
    },
    address: {
      line: '12 MG Road',
      city: 'Pune',
      state: 'Maharashtra',
      pin: '411001',
    },
    buyerGstin: null,
    buyerLegalName: null,
    offerCode: null,
  };

  it('identical details → same order', () => {
    expect(sameOrderDetails(base, structuredClone(base))).toBe(true);
  });

  it('missing optional fields equal null (the browser may omit them)', () => {
    const { buyerGstin, buyerLegalName, offerCode, ...rest } = base;
    void buyerGstin;
    void buyerLegalName;
    void offerCode;
    expect(sameOrderDetails(base, rest as OrderDetails)).toBe(true);
  });

  it.each<[string, Partial<OrderDetails>]>([
    ['a different finish (Gold → Silver)', { finish: 'silver' }],
    ['a different payment method', { paymentMethod: 'cod' }],
    ['a different pincode', { address: { ...base.address, pin: '411002' } }],
    ['a different name', { customer: { ...base.customer, name: 'Ananya S' } }],
    [
      'a GST number added',
      { buyerGstin: '27AAACM1234A1Z5', buyerLegalName: 'Acme Pvt Ltd' },
    ],
    ['an offer code added', { offerCode: 'LAUNCH10' }],
  ])('%s → not the same order', (_name, change) => {
    expect(sameOrderDetails(base, { ...base, ...change })).toBe(false);
  });
});
