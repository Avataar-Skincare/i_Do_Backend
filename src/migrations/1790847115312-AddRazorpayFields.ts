import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRazorpayFields1790847115312 implements MigrationInterface {
    name = 'AddRazorpayFields1790847115312'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" ADD "razorpayOrderId" character varying`);
        await queryRunner.query(`ALTER TABLE "orders" ADD "razorpayPaymentId" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "razorpayPaymentId"`);
        await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "razorpayOrderId"`);
    }

}
