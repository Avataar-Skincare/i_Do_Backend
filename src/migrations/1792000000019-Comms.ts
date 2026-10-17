import { MigrationInterface, QueryRunner } from "typeorm";

/** LLD v1.4 M19: notifications outbox; newsletter launch-offer columns. */
export class Comms1792000000019 implements MigrationInterface {
    name = 'Comms1792000000019'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "notifications" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "channel" character varying(10) NOT NULL,
            "template" character varying(64) NOT NULL,
            "recipient" character varying(255) NOT NULL,
            "order_id" character varying(16),
            "user_id" uuid,
            "vars" jsonb NOT NULL DEFAULT '{}'::jsonb,
            "dedupe_key" character varying(160) NOT NULL,
            "status" character varying(8) NOT NULL DEFAULT 'queued',
            "attempts" smallint NOT NULL DEFAULT 0,
            "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "provider_msg_id" character varying(128),
            "error" text,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_notifications" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_notifications_dedupe_key" UNIQUE ("dedupe_key"),
            CONSTRAINT "FK_notifications_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
            CONSTRAINT "FK_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL,
            CONSTRAINT "CHK_notifications_channel" CHECK ("channel" IN ('sms','whatsapp','email')),
            CONSTRAINT "CHK_notifications_status" CHECK ("status" IN ('queued','sent','failed','skipped'))
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_notifications_order" ON "notifications" ("order_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_notifications_queue" ON "notifications" ("next_attempt_at") WHERE "status" = 'queued'`);
        await queryRunner.query(`CREATE INDEX "IDX_notifications_provider_msg" ON "notifications" ("provider_msg_id")`);

        await queryRunner.query(`ALTER TABLE "newsletter_subscribers" ADD "source" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "newsletter_subscribers" ADD "offer_code_sent_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "newsletter_subscribers" DROP COLUMN "offer_code_sent_at"`);
        await queryRunner.query(`ALTER TABLE "newsletter_subscribers" DROP COLUMN "source"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
    }

}
