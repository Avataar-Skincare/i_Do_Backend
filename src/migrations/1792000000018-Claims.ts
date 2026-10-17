import { MigrationInterface, QueryRunner } from "typeorm";

/** LLD v1.4 M18: replacement_claims, claim_attachments, and the shipments.claim_id FK. */
export class Claims1792000000018 implements MigrationInterface {
    name = 'Claims1792000000018'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "replacement_claims" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "order_id" character varying(16) NOT NULL,
            "shipment_id" uuid NOT NULL,
            "kind" character varying(16) NOT NULL,
            "description" text NOT NULL DEFAULT '',
            "status" character varying(10) NOT NULL DEFAULT 'draft',
            "decided_by" uuid,
            "decision_note" text,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "submitted_at" TIMESTAMP WITH TIME ZONE,
            "decided_at" TIMESTAMP WITH TIME ZONE,
            CONSTRAINT "PK_replacement_claims" PRIMARY KEY ("id"),
            CONSTRAINT "FK_replacement_claims_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
            CONSTRAINT "FK_replacement_claims_shipment" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id"),
            CONSTRAINT "FK_replacement_claims_decided_by" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL,
            CONSTRAINT "CHK_replacement_claims_kind" CHECK ("kind" IN ('damaged','wrong_item','warranty_defect')),
            CONSTRAINT "CHK_replacement_claims_status" CHECK ("status" IN ('draft','submitted','approved','rejected','replaced'))
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_replacement_claims_order" ON "replacement_claims" ("order_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_replacement_claims_one_open" ON "replacement_claims" ("order_id") WHERE "status" IN ('draft','submitted','approved')`);

        await queryRunner.query(`CREATE TABLE "claim_attachments" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "claim_id" uuid NOT NULL,
            "kind" character varying(8) NOT NULL,
            "s3_key" character varying(255) NOT NULL,
            "content_type" character varying(64) NOT NULL,
            "size_bytes" bigint NOT NULL,
            "verified_at" TIMESTAMP WITH TIME ZONE,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_claim_attachments" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_claim_attachments_s3_key" UNIQUE ("s3_key"),
            CONSTRAINT "FK_claim_attachments_claim" FOREIGN KEY ("claim_id") REFERENCES "replacement_claims"("id") ON DELETE CASCADE,
            CONSTRAINT "CHK_claim_attachments_kind" CHECK ("kind" IN ('video','photo')),
            CONSTRAINT "CHK_claim_attachments_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 262144000)
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_claim_attachments_claim" ON "claim_attachments" ("claim_id")`);

        await queryRunner.query(`ALTER TABLE "shipments" ADD CONSTRAINT "FK_shipments_claim" FOREIGN KEY ("claim_id") REFERENCES "replacement_claims"("id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "shipments" DROP CONSTRAINT "FK_shipments_claim"`);
        await queryRunner.query(`DROP TABLE "claim_attachments"`);
        await queryRunner.query(`DROP TABLE "replacement_claims"`);
    }

}
