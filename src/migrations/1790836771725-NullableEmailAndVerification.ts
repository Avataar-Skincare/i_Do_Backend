import { MigrationInterface, QueryRunner } from "typeorm";

export class NullableEmailAndVerification1790836771725 implements MigrationInterface {
    name = 'NullableEmailAndVerification1790836771725'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "email_verification_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "codeHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5bb1cbeebcbcb38996911bff8d4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_76301e46c4b49e6ac5a918cc9b" ON "email_verification_codes" ("userId", "codeHash") `);
        await queryRunner.query(`ALTER TABLE "users" ADD "email_verified_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_verified_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_76301e46c4b49e6ac5a918cc9b"`);
        await queryRunner.query(`DROP TABLE "email_verification_codes"`);
    }

}
