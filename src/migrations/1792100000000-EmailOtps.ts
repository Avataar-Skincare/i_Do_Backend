import { MigrationInterface, QueryRunner } from "typeorm";

/** Passwordless email login: email_otps (same shape and limits as phone_otps). */
export class EmailOtps1792100000000 implements MigrationInterface {
    name = 'EmailOtps1792100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "email_otps" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "email" character varying(254) NOT NULL,
            "codeHash" character varying NOT NULL,
            "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "usedAt" TIMESTAMP WITH TIME ZONE,
            "attempts" smallint NOT NULL DEFAULT 0,
            "ip" inet,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_email_otps" PRIMARY KEY ("id"),
            CONSTRAINT "CHK_email_otps_attempts" CHECK ("attempts" <= 5)
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_email_otps_email_created" ON "email_otps" ("email", "createdAt")`);
        await queryRunner.query(`CREATE INDEX "IDX_email_otps_ip_created" ON "email_otps" ("ip", "createdAt")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_email_otps_ip_created"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_email_otps_email_created"`);
        await queryRunner.query(`DROP TABLE "email_otps"`);
    }
}
