import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

/** HTTP layer for GET /catalog and POST /orders/quote: routes, status codes, validation (as in main.ts). */
describe('CatalogController', () => {
  let app: INestApplication;
  const catalog = { pricePaise: 1499900 };
  const q = {
    subtotal: 1499900,
    codFee: 0,
    discount: 0,
    total: 1499900,
    codAvailable: true,
  };
  const svc = {
    getCatalog: jest.fn().mockResolvedValue(catalog),
    quote: jest.fn().mockResolvedValue(q),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: svc }],
    }).compile();
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

  afterAll(async () => {
    await app.close();
  });

  it('GET /catalog → 200 with the catalog', async () => {
    const res = await request(app.getHttpServer()).get('/catalog').expect(200);
    expect(res.body).toEqual(catalog);
  });

  it('POST /orders/quote → 200 (not 201: nothing is created) with the quote', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders/quote')
      .send({ finish: 'gold', paymentMethod: 'cod', pin: '122001' })
      .expect(200);
    expect(res.body).toEqual(q);
    expect(svc.quote).toHaveBeenCalledWith(
      expect.objectContaining({
        finish: 'gold',
        paymentMethod: 'cod',
        pin: '122001',
      }),
    );
  });

  it.each([
    ['bad finish', { finish: 'rose', paymentMethod: 'online', pin: '122001' }],
    [
      'bad payment method',
      { finish: 'gold', paymentMethod: 'upi', pin: '122001' },
    ],
    ['5-digit pin', { finish: 'gold', paymentMethod: 'online', pin: '12200' }],
    ['missing pin', { finish: 'gold', paymentMethod: 'online' }],
    [
      'a price sent by the browser',
      { finish: 'gold', paymentMethod: 'online', pin: '122001', total: 1 },
    ],
  ])('POST /orders/quote rejects %s with 400', async (_name, body) => {
    await request(app.getHttpServer())
      .post('/orders/quote')
      .send(body)
      .expect(400);
  });
});
