import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConsultStatusFields1790318656024 implements MigrationInterface {
    name = 'AddConsultStatusFields1790318656024'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Staff-queue status, set by partner-app-server once a doctor is actually booked.
        await queryRunner.query(`ALTER TABLE "consults" ADD "status" character varying NOT NULL DEFAULT 'PENDING'`);
        await queryRunner.query(`ALTER TABLE "consults" ADD "doctorName" character varying`);
        await queryRunner.query(`ALTER TABLE "consults" ADD "meetingLink" character varying`);
        await queryRunner.query(`ALTER TABLE "consults" ADD "confirmedAt" TIMESTAMP`);

        // Booking now requires a logged-in account (see ConsultsController) — the
        // anonymous clientId path is gone, replaced by real contact details staff
        // can actually use. Existing rows get '' placeholders; there's no reliable
        // way to backfill a real name/phone for old anonymous bookings.
        await queryRunner.query(`ALTER TABLE "consults" ADD "name" character varying NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "consults" ADD "phone" character varying NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "consults" ADD "email" character varying NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "name" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "phone" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "email" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "clientId"`);
        await queryRunner.query(`UPDATE "consults" SET "userId" = '' WHERE "userId" IS NULL`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "userId" SET NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "userId" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "consults" ADD "clientId" character varying NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "clientId" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "email"`);
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "phone"`);
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "confirmedAt"`);
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "meetingLink"`);
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "doctorName"`);
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "status"`);
    }

}
