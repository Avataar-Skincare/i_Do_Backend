import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPhoneVerification1790830513626 implements MigrationInterface {
    name = 'AddPhoneVerification1790830513626'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "phone_verification_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "codeHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b279f888c7b835cd371d69d95fa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9d8ea188b5dafc3074832751bd" ON "phone_verification_codes" ("userId", "codeHash") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "phone" character varying(10)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "phone_verified_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone_verified_at"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9d8ea188b5dafc3074832751bd"`);
        await queryRunner.query(`DROP TABLE "phone_verification_codes"`);
    }

}
