import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { apiError } from '../common/api-error';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderCreationService } from './create/order-creation.service';
import { PaymentVerifyService } from './payment/payment-verify.service';

// OrdersService pulls in @nestjs/typeorm (ESM, which this Jest setup can't parse); the HTTP layer only needs its shape.
jest.mock('./orders.service', () => ({
  OrdersService: class OrdersService {},
}));
jest.mock('./create/order-creation.service', () => ({
  OrderCreationService: class OrderCreationService {},
}));
jest.mock('./payment/payment-verify.service', () => ({
  PaymentVerifyService: class PaymentVerifyService {},
}));

/** HTTP layer for POST /orders and GET /orders/:id: status codes, headers, validation (as in main.ts). */
describe('OrdersController', () => {
  let app: INestApplication;
  const KEY = '3f1c2a9e-7b4d-4c1e-9a2b-5d6e7f8a9b0c';
  const body = {
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
  };
  const created = {
    order: { id: 'IDO-7K2M9Q4X1B' },
    razorpay: {
      id: 'order_X',
      amount: 1499900,
      currency: 'INR',
      keyId: 'rzp_test',
    },
  };
  const creation = { create: jest.fn() };
  const orders = { findOneForUser: jest.fn(), findMineForUser: jest.fn() };
  const verify = { verify: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: orders },
        { provide: OrderCreationService, useValue: creation },
        { provide: PaymentVerifyService, useValue: verify },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { userId: 'user-1' };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => jest.resetAllMocks());
  afterAll(() => app.close());

  const post = (b: object, key: string | null = KEY) => {
    const r = request(app.getHttpServer()).post('/orders');
    return (key === null ? r : r.set('Idempotency-Key', key)).send(b);
  };

  it('new order → 201 with {order, razorpay}; the service gets the caller, the key and the details', async () => {
    creation.create.mockResolvedValue({ created: true, body: created });
    const res = await post(body).expect(201);
    expect(res.body).toEqual(created);
    expect(creation.create).toHaveBeenCalledWith(
      'user-1',
      KEY,
      expect.objectContaining(body),
    );
  });

  it('same Idempotency-Key replay → 200 (not 201) with the same body', async () => {
    creation.create.mockResolvedValue({ created: false, body: created });
    const res = await post(body).expect(200);
    expect(res.body).toEqual(created);
  });

  it.each([
    ['missing', null],
    ['not a UUID', 'retry-1'],
  ])(
    'Idempotency-Key %s → 400 VALIDATION_FAILED, no order',
    async (_n, key) => {
      const res = await post(body, key).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(creation.create).not.toHaveBeenCalled();
    },
  );

  it('prices from the browser are rejected (the server quotes them)', async () => {
    await post({ ...body, total: 100 }).expect(400);
    expect(creation.create).not.toHaveBeenCalled();
  });

  it.each([
    ['finish', { finish: 'rose' }],
    ['pin', { address: { ...body.address, pin: '41100' } }],
    ['phone', { customer: { ...body.customer, phone: '+919800000001' } }],
  ])('bad %s → 400', async (_n, change) => {
    await post({ ...body, ...change }).expect(400);
    expect(creation.create).not.toHaveBeenCalled();
  });

  it('malformed GST number → 400 GSTIN_INVALID', async () => {
    const res = await post({
      ...body,
      buyerGstin: '27AAACM1234',
      buyerLegalName: 'Acme Pvt Ltd',
    }).expect(400);
    expect(res.body.code).toBe('GSTIN_INVALID');
  });

  it('GST number without the legal name → 400 VALIDATION_FAILED', async () => {
    const res = await post({ ...body, buyerGstin: '27AAACM1234A1Z5' }).expect(
      400,
    );
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('valid GST number + legal name → passed through', async () => {
    creation.create.mockResolvedValue({ created: true, body: created });
    await post({
      ...body,
      buyerGstin: '27AAACM1234A1Z5',
      buyerLegalName: 'Acme Pvt Ltd',
    }).expect(201);
    expect(creation.create).toHaveBeenCalledWith(
      'user-1',
      KEY,
      expect.objectContaining({
        buyerGstin: '27AAACM1234A1Z5',
        buyerLegalName: 'Acme Pvt Ltd',
      }),
    );
  });

  it("service errors keep the contract's shape (e.g. 503 STORE_NOT_LIVE)", async () => {
    creation.create.mockRejectedValue(
      apiError(503, 'STORE_NOT_LIVE', 'not yet'),
    );
    const res = await post(body).expect(503);
    expect(res.body).toEqual({
      statusCode: 503,
      code: 'STORE_NOT_LIVE',
      message: 'not yet',
    });
  });

  it("GET /orders/:id looks the order up for the caller only (someone else's → the service's 404)", async () => {
    orders.findOneForUser.mockResolvedValue({ id: 'IDO-7K2M9Q4X1B' });
    await request(app.getHttpServer())
      .get('/orders/IDO-7K2M9Q4X1B')
      .expect(200);
    expect(orders.findOneForUser).toHaveBeenCalledWith(
      'IDO-7K2M9Q4X1B',
      'user-1',
    );
  });

  it('the old POST /orders/razorpay-order is gone (Razorpay orders are created by POST /orders)', async () => {
    await request(app.getHttpServer())
      .post('/orders/razorpay-order')
      .send({ amount: 1499900 })
      .expect(404);
  });

  describe('POST /orders/:id/payment/verify', () => {
    const vbody = {
      razorpayOrderId: 'order_X',
      razorpayPaymentId: 'pay_X',
      razorpaySignature: 'a'.repeat(64),
    };

    it('→ 200 (not 201) with the order; the service gets the caller, the order id and the Checkout result', async () => {
      verify.verify.mockResolvedValue({
        id: 'IDO-7K2M9Q4X1B',
        status: 'confirmed',
      });
      const res = await request(app.getHttpServer())
        .post('/orders/IDO-7K2M9Q4X1B/payment/verify')
        .send(vbody)
        .expect(200);
      expect(res.body.status).toBe('confirmed');
      expect(verify.verify).toHaveBeenCalledWith(
        'user-1',
        'IDO-7K2M9Q4X1B',
        vbody,
      );
    });

    it('missing signature → 400 before the service is called', async () => {
      const { razorpaySignature, ...rest } = vbody;
      void razorpaySignature;
      await request(app.getHttpServer())
        .post('/orders/IDO-7K2M9Q4X1B/payment/verify')
        .send(rest)
        .expect(400);
      expect(verify.verify).not.toHaveBeenCalled();
    });
  });
});
