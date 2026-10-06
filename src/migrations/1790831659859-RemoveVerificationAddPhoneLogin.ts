import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveVerificationAddPhoneLogin1790831659859 implements MigrationInterface {
    name = 'RemoveVerificationAddPhoneLogin1790831659859'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // email/phone OTP verification removed entirely (2026-10-01) — login
        // already requires an account for everything that matters (orders,
        // consults), so a second "prove you own this contact method" layer
        // isn't needed. These two tables' entity classes were deleted before
        // this migration was generated, so TypeORM's diff can't see them —
        // dropped explicitly here instead.
        await queryRunner.query(`DROP TABLE "email_verification_codes"`);
        await queryRunner.query(`DROP TABLE "phone_verification_codes"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_verified_at"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone_verified_at"`);
        // Phone is now a login identifier alongside email (see AuthService.login) — must be unique.
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_a000cca60bcf04454e727699490" UNIQUE ("phone")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_a000cca60bcf04454e727699490"`);
        await queryRunner.query(`ALTER TABLE "users" ADD "phone_verified_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "users" ADD "email_verified_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE TABLE "phone_verification_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "codeHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b279f888c7b835cd371d69d95fa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9d8ea188b5dafc3074832751bd" ON "phone_verification_codes" ("userId", "codeHash") `);
        await queryRunner.query(`CREATE TABLE "email_verification_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "codeHash" character varying NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_5bb1cbeebcbcb38996911bff8d4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_76301e46c4b49e6ac5a918cc9b" ON "email_verification_codes" ("userId", "codeHash") `);
    }

}
