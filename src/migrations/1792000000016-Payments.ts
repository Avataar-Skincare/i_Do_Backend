import { MigrationInterface, QueryRunner } from "typeorm";

/** LLD v1.4 M16: payments, payment_events, refunds. */
export class Payments1792000000016 implements MigrationInterface {
    name = 'Payments1792000000016'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "payments" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "order_id" character varying(16) NOT NULL,
            "method" character varying(8) NOT NULL,
            "razorpay_order_id" character varying(64),
            "razorpay_payment_id" character varying(64),
            "amount" integer NOT NULL,
            "currency" character(3) NOT NULL DEFAULT 'INR',
            "status" character varying(12) NOT NULL DEFAULT 'created',
            "captured_at" TIMESTAMP WITH TIME ZONE,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_payments_razorpay_order_id" UNIQUE ("razorpay_order_id"),
            CONSTRAINT "UQ_payments_razorpay_payment_id" UNIQUE ("razorpay_payment_id"),
            CONSTRAINT "FK_payments_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
            CONSTRAINT "CHK_payments_method" CHECK ("method" IN ('razorpay','cod_cash')),
            CONSTRAINT "CHK_payments_amount" CHECK ("amount" > 0),
            CONSTRAINT "CHK_payments_status" CHECK ("status" IN ('created','authorized','captured','failed'))
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_payments_order" ON "payments" ("order_id")`);

        await queryRunner.query(`CREATE TABLE "payment_events" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "provider" character varying(16) NOT NULL DEFAULT 'razorpay',
            "event_id" character varying(64) NOT NULL,
            "event_type" character varying(64) NOT NULL,
            "payload" jsonb NOT NULL,
            "signature_ok" boolean NOT NULL,
            "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "processed_at" TIMESTAMP WITH TIME ZONE,
            "error" text,
            CONSTRAINT "PK_payment_events" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_payment_events_provider_event" UNIQUE ("provider", "event_id")
        )`);

        await queryRunner.query(`CREATE TABLE "refunds" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "order_id" character varying(16) NOT NULL,
            "reason" character varying(16) NOT NULL,
            "amount_paid" integer NOT NULL,
            "kit_deduction" integer NOT NULL DEFAULT 0,
            "fee_deduction" integer NOT NULL DEFAULT 0,
            "amount" integer NOT NULL,
            "method" character varying(8) NOT NULL,
            "dest_enc" bytea,
            "dest_last4" character(4),
            "account_holder" character varying(120),
            "status" character varying(16) NOT NULL DEFAULT 'requested',
            "reference" character varying(64),
            "requested_by" uuid,
            "processed_by" uuid,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "paid_at" TIMESTAMP WITH TIME ZONE,
            "dest_purged_at" TIMESTAMP WITH TIME ZONE,
            CONSTRAINT "PK_refunds" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_refunds_reference" UNIQUE ("reference"),
            CONSTRAINT "FK_refunds_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
            CONSTRAINT "CHK_refunds_reason" CHECK ("reason" IN ('customer_cancel','kit_rto','ring_refused','late_capture','admin')),
            CONSTRAINT "CHK_refunds_deductions" CHECK ("kit_deduction" >= 0 AND "fee_deduction" >= 0),
            CONSTRAINT "CHK_refunds_amount" CHECK ("amount" = "amount_paid" - "kit_deduction" - "fee_deduction" AND "amount" > 0),
            CONSTRAINT "CHK_refunds_method" CHECK ("method" IN ('razorpay','bank','upi')),
            CONSTRAINT "CHK_refunds_razorpay_no_dest" CHECK ("method" <> 'razorpay' OR "dest_enc" IS NULL),
            CONSTRAINT "CHK_refunds_status" CHECK ("status" IN ('requested','processing','paid','rejected'))
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_refunds_order" ON "refunds" ("order_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_refunds_one_active" ON "refunds" ("order_id") WHERE "status" <> 'rejected'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "refunds"`);
        await queryRunner.query(`DROP TABLE "payment_events"`);
        await queryRunner.query(`DROP TABLE "payments"`);
    }

}
