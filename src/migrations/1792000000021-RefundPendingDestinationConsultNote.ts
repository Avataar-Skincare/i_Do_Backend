import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * M21 — API contract v1.0.0 decisions (20 Oct):
 * - refunds.method may be NULL until a COD customer gives UPI/bank details
 *   for a refused-ring refund (clients branch on destinationRequired).
 *   CHK_refunds_method still restricts it to razorpay|bank|upi once set.
 * - consults.note holds the partner's completion / no-show note.
 *
 * down() re-adds NOT NULL, which fails while any refund still has no method —
 * by design: those rows need a method before this can be reverted.
 */
export class RefundPendingDestinationConsultNote1792000000021 implements MigrationInterface {
    name = 'RefundPendingDestinationConsultNote1792000000021'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "refunds" ALTER COLUMN "method" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "consults" ADD "note" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "consults" DROP COLUMN "note"`);
        await queryRunner.query(`ALTER TABLE "refunds" ALTER COLUMN "method" SET NOT NULL`);
    }
}
