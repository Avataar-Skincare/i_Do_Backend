import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * LLD v1.4 M15: drop the old cart-style orders (test data only) and create
 * orders, shipments (claim FK added in M18) and order_events.
 */
export class OrdersRebuild1792000000015 implements MigrationInterface {
    name = 'OrdersRebuild1792000000015'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "orders"`);

        await queryRunner.query(`CREATE TABLE "orders" (
            "id" character varying(16) NOT NULL,
            "user_id" uuid,
            "idempotency_key" uuid NOT NULL,
            "status" character varying(20) NOT NULL DEFAULT 'pending_payment',
            "cancel_reason" character varying(16),
            "payment_method" character varying(6) NOT NULL,
            "finish" character varying(8) NOT NULL,
            "us_size" smallint,
            "unit_price" integer NOT NULL,
            "list_price" integer NOT NULL,
            "subtotal" integer NOT NULL,
            "cod_fee" integer NOT NULL DEFAULT 0,
            "discount" integer NOT NULL DEFAULT 0,
            "total" integer NOT NULL,
            "amount_paid" integer NOT NULL DEFAULT 0,
            "kit_price_snapshot" integer NOT NULL,
            "offer_code" character varying(32),
            "customer" jsonb NOT NULL,
            "address" jsonb NOT NULL,
            "buyer_gstin" character varying(15),
            "buyer_legal_name" character varying(160),
            "stock_reserved" boolean NOT NULL DEFAULT false,
            "cod_confirm_sent_at" TIMESTAMP WITH TIME ZONE,
            "cod_confirmed_at" TIMESTAMP WITH TIME ZONE,
            "cod_confirm_via" character varying(16),
            "cod_call_attempts" smallint NOT NULL DEFAULT 0,
            "cod_call_due_at" TIMESTAMP WITH TIME ZONE,
            "kit_delivered_at" TIMESTAMP WITH TIME ZONE,
            "size_due_at" TIMESTAMP WITH TIME ZONE,
            "size_submitted_at" TIMESTAMP WITH TIME ZONE,
            "ring_delivered_at" TIMESTAMP WITH TIME ZONE,
            "damage_window_until" TIMESTAMP WITH TIME ZONE,
            "warranty_until" TIMESTAMP WITH TIME ZONE,
            "cancelled_at" TIMESTAMP WITH TIME ZONE,
            "pii_scrubbed_at" TIMESTAMP WITH TIME ZONE,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_orders" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_orders_user_idempotency" UNIQUE ("user_id", "idempotency_key"),
            CONSTRAINT "FK_orders_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL,
            CONSTRAINT "FK_orders_sku" FOREIGN KEY ("finish", "us_size") REFERENCES "skus"("finish", "us_size") MATCH SIMPLE,
            CONSTRAINT "CHK_orders_status" CHECK ("status" IN ('pending_payment','cod_pending','confirmed','kit_shipped','kit_delivered','size_submitted','ring_shipped','ring_delivered','cancelled')),
            CONSTRAINT "CHK_orders_cancel_reason" CHECK ("cancel_reason" IN ('unpaid','cod_unconfirmed','customer','kit_rto','ring_refused','admin')),
            CONSTRAINT "CHK_orders_cancelled_has_reason" CHECK (("status" = 'cancelled') = ("cancel_reason" IS NOT NULL)),
            CONSTRAINT "CHK_orders_payment_method" CHECK ("payment_method" IN ('online','cod')),
            CONSTRAINT "CHK_orders_finish" CHECK ("finish" IN ('gold','silver','black')),
            CONSTRAINT "CHK_orders_us_size" CHECK ("us_size" BETWEEN 6 AND 13),
            CONSTRAINT "CHK_orders_money_nonneg" CHECK ("unit_price" >= 0 AND "list_price" >= 0 AND "subtotal" >= 0 AND "cod_fee" >= 0 AND "discount" >= 0 AND "total" >= 0 AND "kit_price_snapshot" >= 0),
            CONSTRAINT "CHK_orders_total" CHECK ("total" = "subtotal" + "cod_fee" - "discount"),
            CONSTRAINT "CHK_orders_amount_paid" CHECK ("amount_paid" >= 0 AND "amount_paid" <= "total"),
            CONSTRAINT "CHK_orders_buyer_gstin" CHECK ("buyer_gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
            CONSTRAINT "CHK_orders_buyer_pair" CHECK (("buyer_gstin" IS NULL) = ("buyer_legal_name" IS NULL)),
            CONSTRAINT "CHK_orders_cod_confirm_via" CHECK ("cod_confirm_via" IN ('whatsapp_manual','whatsapp_auto','call')),
            CONSTRAINT "CHK_orders_cod_call_attempts" CHECK ("cod_call_attempts" BETWEEN 0 AND 2)
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_orders_user_created" ON "orders" ("user_id", "created_at" DESC)`);
        await queryRunner.query(`CREATE INDEX "IDX_orders_cod_call_due" ON "orders" ("cod_call_due_at") WHERE "status" = 'cod_pending'`);
        await queryRunner.query(`CREATE INDEX "IDX_orders_size_due" ON "orders" ("size_due_at") WHERE "status" = 'kit_delivered'`);

        await queryRunner.query(`CREATE TABLE "shipments" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "order_id" character varying(16) NOT NULL,
            "kind" character varying(12) NOT NULL,
            "claim_id" uuid,
            "sku_id" character varying(32) NOT NULL,
            "status" character varying(10) NOT NULL DEFAULT 'pending',
            "courier" character varying(32),
            "awb" character varying(40),
            "tracking_url" text,
            "serial_number" character varying(40),
            "cod_amount" integer NOT NULL DEFAULT 0,
            "cod_collected_at" TIMESTAMP WITH TIME ZONE,
            "attempt" smallint NOT NULL DEFAULT 1,
            "rto_reason" character varying(16),
            "returned_at" TIMESTAMP WITH TIME ZONE,
            "return_condition" character varying(8),
            "shipped_at" TIMESTAMP WITH TIME ZONE,
            "delivered_at" TIMESTAMP WITH TIME ZONE,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_shipments" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_shipments_courier_awb" UNIQUE ("courier", "awb"),
            CONSTRAINT "UQ_shipments_serial_number" UNIQUE ("serial_number"),
            CONSTRAINT "FK_shipments_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
            CONSTRAINT "FK_shipments_sku" FOREIGN KEY ("sku_id") REFERENCES "skus"("id"),
            CONSTRAINT "CHK_shipments_kind" CHECK ("kind" IN ('kit','ring','replacement')),
            CONSTRAINT "CHK_shipments_claim" CHECK (("kind" = 'replacement') = ("claim_id" IS NOT NULL)),
            CONSTRAINT "CHK_shipments_status" CHECK ("status" IN ('pending','shipped','delivered','rto','lost')),
            CONSTRAINT "CHK_shipments_serial_required" CHECK ("kind" = 'kit' OR "status" = 'pending' OR "serial_number" IS NOT NULL),
            CONSTRAINT "CHK_shipments_cod_amount" CHECK ("cod_amount" >= 0),
            CONSTRAINT "CHK_shipments_attempt" CHECK ("attempt" BETWEEN 1 AND 2),
            CONSTRAINT "CHK_shipments_rto_reason" CHECK ("rto_reason" IN ('refused','undeliverable')),
            CONSTRAINT "CHK_shipments_rto_has_reason" CHECK (("status" = 'rto') = ("rto_reason" IS NOT NULL)),
            CONSTRAINT "CHK_shipments_return_condition" CHECK ("return_condition" IN ('sealed','damaged')),
            CONSTRAINT "CHK_shipments_return_pair" CHECK (("returned_at" IS NULL) = ("return_condition" IS NULL)),
            CONSTRAINT "CHK_shipments_delivered_after_shipped" CHECK ("delivered_at" >= "shipped_at")
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_shipments_order" ON "shipments" ("order_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_shipments_one_kit" ON "shipments" ("order_id") WHERE "kind" = 'kit'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_shipments_one_live_ring" ON "shipments" ("order_id") WHERE "kind" = 'ring' AND "status" IN ('pending','shipped','delivered')`);

        await queryRunner.query(`CREATE TABLE "order_events" (
            "id" BIGSERIAL NOT NULL,
            "order_id" character varying(16) NOT NULL,
            "actor_type" character varying(10) NOT NULL,
            "actor_user_id" uuid,
            "from_status" character varying(20),
            "to_status" character varying(20),
            "event" character varying(40) NOT NULL,
            "note" text,
            "meta" jsonb,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_order_events" PRIMARY KEY ("id"),
            CONSTRAINT "FK_order_events_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
            CONSTRAINT "CHK_order_events_actor_type" CHECK ("actor_type" IN ('customer','admin','system','webhook','partner'))
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_order_events_order_created" ON "order_events" ("order_id", "created_at")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "order_events"`);
        await queryRunner.query(`DROP TABLE "shipments"`);
        await queryRunner.query(`DROP TABLE "orders"`);

        await queryRunner.query(`CREATE TABLE "orders" ("id" character varying NOT NULL, "date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "items" jsonb NOT NULL, "subtotal" integer NOT NULL, "codFee" integer NOT NULL, "total" integer NOT NULL, "paymentMethod" character varying NOT NULL, "customer" jsonb NOT NULL, "address" jsonb NOT NULL, "status" character varying NOT NULL DEFAULT 'placed', "userId" character varying, "razorpayOrderId" character varying, "razorpayPaymentId" character varying, CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_151b79a83ba240b0cb31b2302d" ON "orders" ("userId") `);
    }

}
