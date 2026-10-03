import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIndexesAndFixTimestamps1790770379247 implements MigrationInterface {
    name = 'AddIndexesAndFixTimestamps1790770379247'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Converted in place (ALTER ... TYPE ... USING), not dropped and re-added —
        // this database runs in UTC (confirmed via `SHOW timezone`), so reinterpreting
        // the existing naive values as UTC preserves the real moment they recorded,
        // instead of wiping the 1 existing order's and 3 existing consults' rows to
        // the migration's own run time.
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "date" TYPE TIMESTAMP WITH TIME ZONE USING "date" AT TIME ZONE 'UTC'`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "date" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "confirmedAt" TYPE TIMESTAMP WITH TIME ZONE USING "confirmedAt" AT TIME ZONE 'UTC'`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "createdAt" SET DEFAULT now()`);
        await queryRunner.query(`CREATE INDEX "IDX_151b79a83ba240b0cb31b2302d" ON "orders" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_ac26e220df2e8a1d1aa1d840f7" ON "consults" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_1143abb8c3fad8b06dd857a8c9" ON "password_reset_tokens" ("tokenHash") `);
        await queryRunner.query(`CREATE INDEX "IDX_76301e46c4b49e6ac5a918cc9b" ON "email_verification_codes" ("userId", "codeHash") `);
        await queryRunner.query(`CREATE INDEX "IDX_cc7020dae336a62bbbb4d4f341" ON "order_claim_tokens" ("tokenHash") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_cc7020dae336a62bbbb4d4f341"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_76301e46c4b49e6ac5a918cc9b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1143abb8c3fad8b06dd857a8c9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ac26e220df2e8a1d1aa1d840f7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_151b79a83ba240b0cb31b2302d"`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "createdAt" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`);
        await queryRunner.query(`ALTER TABLE "consults" ALTER COLUMN "confirmedAt" TYPE TIMESTAMP USING "confirmedAt" AT TIME ZONE 'UTC'`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "date" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "date" TYPE TIMESTAMP USING "date" AT TIME ZONE 'UTC'`);
    }

}
