import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { PricingSettings } from '../catalog/pricing';

/**
 * Reads the `settings` table (key → jsonb value, seeded by migration M13).
 * Read fresh on every call: ops change prices and switches from the dashboard
 * and the next request must see them; the table is a few dozen rows.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly dataSource: DataSource) {}

  async getMany<T extends Record<string, unknown>>(
    keys: readonly (keyof T & string)[],
  ): Promise<T> {
    const rows: Array<{ key: string; value: unknown }> =
      await this.dataSource.query(
        'SELECT "key", "value" FROM "settings" WHERE "key" = ANY($1)',
        [keys],
      );
    const found = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const missing = keys.filter((k) => !(k in found));
    if (missing.length)
      throw new Error(`settings missing: ${missing.join(', ')}`);
    return found as T;
  }

  pricing(): Promise<PricingSettings> {
    return this.getMany<PricingSettings & Record<string, unknown>>([
      'ring_price_paise',
      'ring_list_price_paise',
      'cod_enabled',
      'cod_fee_paise',
      'cod_pincode_mode',
      'cod_pincodes',
      'launch_offer',
      'social_proof_enabled',
    ]);
  }
}
