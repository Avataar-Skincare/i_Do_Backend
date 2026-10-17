import { MigrationInterface, QueryRunner } from "typeorm";

/** LLD v1.4 M13: settings + skus (with `reserved`), seeded. */
export class LaunchConfig1792000000013 implements MigrationInterface {
    name = 'LaunchConfig1792000000013'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "settings" (
            "key" character varying(64) NOT NULL,
            "value" jsonb NOT NULL,
            "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "updated_by" uuid,
            CONSTRAINT "PK_settings" PRIMARY KEY ("key"),
            CONSTRAINT "FK_settings_updated_by" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL
        )`);

        await queryRunner.query(`CREATE TABLE "skus" (
            "id" character varying(32) NOT NULL,
            "kind" character varying(4) NOT NULL,
            "finish" character varying(8),
            "us_size" smallint,
            "on_hand" integer NOT NULL DEFAULT 0,
            "reserved" integer NOT NULL DEFAULT 0,
            "active" boolean NOT NULL DEFAULT true,
            "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_skus" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_skus_finish_us_size" UNIQUE ("finish", "us_size"),
            CONSTRAINT "CHK_skus_kind" CHECK ("kind" IN ('ring','kit')),
            CONSTRAINT "CHK_skus_finish" CHECK ("finish" IN ('gold','silver','black')),
            CONSTRAINT "CHK_skus_us_size" CHECK ("us_size" BETWEEN 6 AND 13),
            CONSTRAINT "CHK_skus_on_hand" CHECK ("on_hand" >= 0),
            CONSTRAINT "CHK_skus_reserved" CHECK ("reserved" >= 0 AND "reserved" <= "on_hand"),
            CONSTRAINT "CHK_skus_ring_shape" CHECK (("kind" = 'ring') = ("finish" IS NOT NULL AND "us_size" IS NOT NULL))
        )`);

        const settings: [string, unknown][] = [
            ['ring_price_paise', 1499900],
            ['ring_list_price_paise', 1999900],
            ['kit_price_paise', null],
            ['cod_enabled', true],
            ['cod_fee_paise', 10000],
            ['cod_pincode_mode', 'all'],
            ['cod_pincodes', []],
            ['max_rings_per_order', 1],
            ['size_window_days', 15],
            ['consult_window_days', 30],
            ['replacement_window_days', 7],
            ['warranty_months', 12],
            ['cod_reply_timeout_hours', 24],
            ['cod_max_call_attempts', 2],
            ['size_reminder_days', [10, 14]],
            ['pending_payment_ttl_hours', 24],
            ['staff_session_hours', 12],
            ['step_up_minutes', 15],
            ['invoice_prefix', 'IDO'],
            ['credit_note_prefix', 'IDOCN'],
            ['hsn_code', null],
            ['gst_rate_bp', 1800],
            ['refund_full_before_kit_ship', true],
            ['kit_rto_refund_full', true],
            ['launch_offer', { enabled: false, kind: null, amount_paise: 0, code: null }],
            ['social_proof_enabled', false],
            ['default_courier', 'shiprocket'],
            ['support_hours', { days: 'Mon–Sat', open: '10:00', close: '18:00' }],
            ['consult_hours', { open: '10:00', close: '18:00' }],
            ['seller', { legal_name: 'Misya Beauty Tech Pvt. Ltd.', gstin: null, cin: null, state: null, address: null }],
            ['support_contacts', { email: null, phone: null, whatsapp: null }],
            ['launch_at', null],
        ];
        for (const [key, value] of settings) {
            await queryRunner.query(`INSERT INTO "settings" ("key", "value") VALUES ($1, $2::jsonb)`, [key, JSON.stringify(value)]);
        }

        await queryRunner.query(`INSERT INTO "skus" ("id", "kind") VALUES ('kit', 'kit')`);
        await queryRunner.query(`INSERT INTO "skus" ("id", "kind", "finish", "us_size")
            SELECT 'ring-' || f || '-' || s, 'ring', f, s
            FROM unnest(ARRAY['gold','silver','black']) AS f, generate_series(6, 13) AS s`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "skus"`);
        await queryRunner.query(`DROP TABLE "settings"`);
    }

}
