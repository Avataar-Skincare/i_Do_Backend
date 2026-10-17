import { MigrationInterface, QueryRunner } from "typeorm";

/** LLD v1.4 M14: refresh_tokens; phone_otps attempts/ip; users consent + soft-delete columns; drop order_claim_tokens. */
export class AuthHardening1792000000014 implements MigrationInterface {
    name = 'AuthHardening1792000000014'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "refresh_tokens" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "user_id" uuid NOT NULL,
            "family_id" uuid NOT NULL,
            "parent_id" uuid,
            "token_hash" character(64) NOT NULL,
            "client" character varying(4) NOT NULL,
            "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
            "rotated_at" TIMESTAMP WITH TIME ZONE,
            "revoked_at" TIMESTAMP WITH TIME ZONE,
            "revoked_reason" character varying(16),
            "ip" inet,
            "user_agent" text,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_refresh_tokens_token_hash" UNIQUE ("token_hash"),
            CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_refresh_tokens_parent" FOREIGN KEY ("parent_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL,
            CONSTRAINT "CHK_refresh_tokens_client" CHECK ("client" IN ('web','app','ops')),
            CONSTRAINT "CHK_refresh_tokens_revoked_reason" CHECK ("revoked_reason" IN ('reuse','logout','admin'))
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_family" ON "refresh_tokens" ("family_id")`);
        await queryRunner.query(`CREATE INDEX "IDX_refresh_tokens_user_active" ON "refresh_tokens" ("user_id") WHERE "revoked_at" IS NULL`);

        await queryRunner.query(`ALTER TABLE "phone_otps" ADD "attempts" smallint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "phone_otps" ADD CONSTRAINT "CHK_phone_otps_attempts" CHECK ("attempts" <= 5)`);
        await queryRunner.query(`ALTER TABLE "phone_otps" ADD "ip" inet`);
        await queryRunner.query(`CREATE INDEX "IDX_phone_otps_phone_created" ON "phone_otps" ("phone", "createdAt")`);
        await queryRunner.query(`CREATE INDEX "IDX_phone_otps_ip_created" ON "phone_otps" ("ip", "createdAt")`);

        await queryRunner.query(`ALTER TABLE "users" ADD "deleted_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ADD "terms_version" character varying(16)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "health_consent_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ADD "health_consent_version" character varying(16)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "health_consent_withdrawn_at" TIMESTAMP WITH TIME ZONE`);

        await queryRunner.query(`DROP TABLE "order_claim_tokens"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "order_claim_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "orderId" character varying NOT NULL, "email" character varying NOT NULL, "tokenHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_22a877337c41db9f500ac5d3f7e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cc7020dae336a62bbbb4d4f341" ON "order_claim_tokens" ("tokenHash") `);

        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "health_consent_withdrawn_at"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "health_consent_version"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "health_consent_at"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "terms_version"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "deleted_at"`);

        await queryRunner.query(`DROP INDEX "public"."IDX_phone_otps_ip_created"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_phone_otps_phone_created"`);
        await queryRunner.query(`ALTER TABLE "phone_otps" DROP COLUMN "ip"`);
        await queryRunner.query(`ALTER TABLE "phone_otps" DROP CONSTRAINT "CHK_phone_otps_attempts"`);
        await queryRunner.query(`ALTER TABLE "phone_otps" DROP COLUMN "attempts"`);

        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    }

}
