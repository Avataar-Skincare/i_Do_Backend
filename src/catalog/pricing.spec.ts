import { buildCatalog, quote, PricingSettings } from './pricing';

/**
 * Server-side pricing (LLD §5 GET /catalog, POST /orders/quote). The browser
 * never sends prices; POST /orders re-runs `quote` on the server.
 */
const settings: PricingSettings = {
  ring_price_paise: 1499900,
  ring_list_price_paise: 1999900,
  cod_enabled: true,
  cod_fee_paise: 10000,
  cod_pincode_mode: 'all',
  cod_pincodes: [],
  launch_offer: { enabled: false, kind: null, amount_paise: 0, code: null },
  social_proof_enabled: false,
};

describe('quote', () => {
  it('online: ring price only, no COD fee', () => {
    expect(
      quote(settings, {
        finish: 'gold',
        paymentMethod: 'online',
        pin: '122001',
      }),
    ).toEqual({
      subtotal: 1499900,
      codFee: 0,
      discount: 0,
      total: 1499900,
      codAvailable: true,
    });
  });

  it('COD adds the ₹100 fee to the total', () => {
    expect(
      quote(settings, {
        finish: 'silver',
        paymentMethod: 'cod',
        pin: '122001',
      }),
    ).toEqual({
      subtotal: 1499900,
      codFee: 10000,
      discount: 0,
      total: 1509900,
      codAvailable: true,
    });
  });

  it('COD switched off: not available, reason cod_disabled, no fee', () => {
    const q = quote(
      { ...settings, cod_enabled: false },
      { finish: 'gold', paymentMethod: 'cod', pin: '122001' },
    );
    expect(q).toEqual(
      expect.objectContaining({
        codAvailable: false,
        codReason: 'cod_disabled',
        codFee: 0,
        total: 1499900,
      }),
    );
  });

  it('allow-list mode: COD only for listed pincodes', () => {
    const s = {
      ...settings,
      cod_pincode_mode: 'allow',
      cod_pincodes: ['411001'],
    };
    expect(
      quote(s, { finish: 'gold', paymentMethod: 'cod', pin: '411001' })
        .codAvailable,
    ).toBe(true);
    expect(
      quote(s, { finish: 'gold', paymentMethod: 'cod', pin: '122001' }),
    ).toEqual(
      expect.objectContaining({
        codAvailable: false,
        codReason: 'pincode_not_serviceable',
        codFee: 0,
      }),
    );
  });

  it('an unknown pincode mode fails safe: COD not serviceable', () => {
    const s = { ...settings, cod_pincode_mode: 'something-new' };
    expect(
      quote(s, { finish: 'gold', paymentMethod: 'cod', pin: '411001' })
        .codAvailable,
    ).toBe(false);
  });

  it('online quotes still report COD availability (so checkout can show the option)', () => {
    const q = quote(
      { ...settings, cod_enabled: false },
      { finish: 'gold', paymentMethod: 'online', pin: '122001' },
    );
    expect(q).toEqual(
      expect.objectContaining({
        codAvailable: false,
        codReason: 'cod_disabled',
        codFee: 0,
      }),
    );
  });

  it('launch offer is parked: an offer code gives no discount while the offer is off', () => {
    const q = quote(settings, {
      finish: 'gold',
      paymentMethod: 'online',
      pin: '122001',
      offerCode: 'LAUNCH10',
    });
    expect(q.discount).toBe(0);
    expect(q.total).toBe(1499900);
  });

  it('always satisfies total = subtotal + codFee − discount', () => {
    for (const paymentMethod of ['online', 'cod'] as const) {
      const q = quote(settings, {
        finish: 'black',
        paymentMethod,
        pin: '560001',
      });
      expect(q.total).toBe(q.subtotal + q.codFee - q.discount);
    }
  });
});

describe('buildCatalog', () => {
  const skus = [
    {
      id: 'ring-gold-8',
      kind: 'ring',
      finish: 'gold',
      usSize: 8,
      onHand: 3,
      reserved: 1,
      active: true,
    },
    {
      id: 'ring-gold-9',
      kind: 'ring',
      finish: 'gold',
      usSize: 9,
      onHand: 1,
      reserved: 1,
      active: true,
    },
    {
      id: 'ring-silver-8',
      kind: 'ring',
      finish: 'silver',
      usSize: 8,
      onHand: 0,
      reserved: 0,
      active: true,
    },
    {
      id: 'ring-black-10',
      kind: 'ring',
      finish: 'black',
      usSize: 10,
      onHand: 5,
      reserved: 0,
      active: false,
    },
    {
      id: 'kit',
      kind: 'kit',
      finish: null,
      usSize: null,
      onHand: 50,
      reserved: 0,
      active: true,
    },
  ] as const;

  const c = buildCatalog(settings, [...skus]);

  it('carries prices and switches from settings', () => {
    expect(c).toEqual(
      expect.objectContaining({
        pricePaise: 1499900,
        listPricePaise: 1999900,
        kitIncluded: true,
        codFeePaise: 10000,
        codEnabled: true,
        offer: { enabled: false },
        socialProof: false,
      }),
    );
  });

  it('lists finishes in a fixed order with display names, kit excluded', () => {
    expect(c.finishes.map((f) => [f.id, f.name])).toEqual([
      ['gold', 'Gold'],
      ['silver', 'Silver'],
    ]);
  });

  it('a size is in stock only when on hand minus reserved is at least 1', () => {
    const gold = c.finishes.find((f) => f.id === 'gold')!;
    expect(gold.sizes).toEqual([
      { us: 8, inStock: true }, // 3 − 1 = 2
      { us: 9, inStock: false }, // 1 − 1 = 0
    ]);
    expect(c.finishes.find((f) => f.id === 'silver')!.sizes).toEqual([
      { us: 8, inStock: false },
    ]);
  });

  it('inactive SKUs are hidden (a finish with none active is not listed)', () => {
    expect(c.finishes.find((f) => f.id === 'black')).toBeUndefined();
  });
});
