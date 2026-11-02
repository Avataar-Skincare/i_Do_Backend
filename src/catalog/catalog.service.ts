import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import {
  Catalog,
  CatalogSku,
  Quote,
  QuoteInput,
  buildCatalog,
  quote,
} from './pricing';

/** GET /catalog and POST /orders/quote: current settings + stock, priced by `pricing.ts`. */
@Injectable()
export class CatalogService {
  constructor(
    private readonly settings: SettingsService,
    private readonly dataSource: DataSource,
  ) {}

  async getCatalog(): Promise<Catalog> {
    const [s, skus] = await Promise.all([
      this.settings.pricing(),
      this.dataSource.query(
        `SELECT "id", "kind", "finish", "us_size" AS "usSize", "on_hand" AS "onHand", "reserved", "active"
         FROM "skus"`,
      ) as Promise<CatalogSku[]>,
    ]);
    return buildCatalog(s, skus);
  }

  async quote(input: QuoteInput): Promise<Quote> {
    return quote(await this.settings.pricing(), input);
  }
}
