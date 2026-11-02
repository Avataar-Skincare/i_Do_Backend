import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { RazorpayWebhookController } from './razorpay-webhook.controller';
import { RazorpayWebhookService } from './razorpay-webhook.service';

jest.mock('./razorpay-webhook.service', () => ({
  RazorpayWebhookService: class RazorpayWebhookService {},
}));

/** HTTP layer for POST /webhooks/razorpay: the service must get the exact bytes Razorpay signed. */
describe('RazorpayWebhookController', () => {
  let app: INestApplication;
  const svc = { handle: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RazorpayWebhookController],
      providers: [{ provide: RazorpayWebhookService, useValue: svc }],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true }); // as main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(() => app.close());

  it('passes the raw body byte-for-byte (spacing and key order kept), the signature and the event id; answers 200', async () => {
    svc.handle.mockResolvedValue({ received: true });
    const raw =
      '{"event":"payment.captured",  "payload":{"payment":{"entity":{"id":"pay_1","amount":1499900}}}}';

    const res = await request(app.getHttpServer())
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'sig123')
      .set('X-Razorpay-Event-Id', 'evt_1')
      .send(raw)
      .expect(200);

    expect(res.body).toEqual({ received: true });
    const [body, signature, eventId] = svc.handle.mock.calls[0];
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.toString('utf8')).toBe(raw);
    expect(signature).toBe('sig123');
    expect(eventId).toBe('evt_1');
  });
});
