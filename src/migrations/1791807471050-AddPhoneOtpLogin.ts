import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPhoneOtpLogin1791807471050 implements MigrationInterface {
    name = 'AddPhoneOtpLogin1791807471050'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "phone_otps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "phone" character varying(10) NOT NULL, "codeHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_85b52fddfc8ab6d13f1a2cf48e1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c02d482e9b6c13f6334757f3b6" ON "phone_otps" ("phone", "codeHash") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "phone_verified_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone_verified_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c02d482e9b6c13f6334757f3b6"`);
        await queryRunner.query(`DROP TABLE "phone_otps"`);
    }

}
