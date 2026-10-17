import { MigrationInterface, QueryRunner } from "typeorm";

/** LLD v1.4 M17: drop the old free-booking consults (test data only); create consult_entitlements and entitlement-backed consults. */
export class ConsultsRebuild1792000000017 implements MigrationInterface {
    name = 'ConsultsRebuild1792000000017'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "consults"`);

        await queryRunner.query(`CREATE TABLE "consult_entitlements" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "order_id" character varying(16) NOT NULL,
            "user_id" uuid NOT NULL,
            "type" character varying(10) NOT NULL,
            "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
            "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_consult_entitlements" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_consult_entitlements_order_type" UNIQUE ("order_id", "type"),
            CONSTRAINT "FK_consult_entitlements_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
            CONSTRAINT "FK_consult_entitlements_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
            CONSTRAINT "CHK_consult_entitlements_type" CHECK ("type" IN ('derm','dietician')),
            CONSTRAINT "CHK_consult_entitlements_window" CHECK ("expires_at" > "starts_at")
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_consult_entitlements_user" ON "consult_entitlements" ("user_id")`);

        await queryRunner.query(`CREATE TABLE "consults" (
            "id" character varying(40) NOT NULL,
            "user_id" uuid NOT NULL,
            "entitlement_id" uuid NOT NULL,
            "type" character varying(10) NOT NULL,
            "name" character varying(120) NOT NULL,
            "phone" character varying(10) NOT NULL,
            "email" character varying(255) NOT NULL,
            "appointment_date" date NOT NULL,
            "time_slot" character varying(8) NOT NULL,
            "appointment_at" TIMESTAMP WITH TIME ZONE,
            "concern" text NOT NULL DEFAULT '',
            "status" character varying(10) NOT NULL DEFAULT 'PENDING',
            "doctor_name" character varying(120),
            "meeting_link" text,
            "confirmed_at" TIMESTAMP WITH TIME ZONE,
            "completed_at" TIMESTAMP WITH TIME ZONE,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_consults" PRIMARY KEY ("id"),
            CONSTRAINT "FK_consults_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_consults_entitlement" FOREIGN KEY ("entitlement_id") REFERENCES "consult_entitlements"("id"),
            CONSTRAINT "CHK_consults_type" CHECK ("type" IN ('derm','dietician')),
            CONSTRAINT "CHK_consults_status" CHECK ("status" IN ('PENDING','CONFIRMED','COMPLETED','CANCELLED'))
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_consults_user" ON "consults" ("user_id")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_consults_one_active" ON "consults" ("entitlement_id") WHERE "status" <> 'CANCELLED'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "consults"`);
        await queryRunner.query(`DROP TABLE "consult_entitlements"`);

        await queryRunner.query(`CREATE TABLE "consults" ("id" character varying NOT NULL, "userId" character varying NOT NULL, "type" character varying NOT NULL, "dayLabel" character varying NOT NULL, "timeSlot" character varying NOT NULL, "concern" text NOT NULL DEFAULT '', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "status" character varying NOT NULL DEFAULT 'PENDING', "doctorName" character varying, "meetingLink" character varying, "confirmedAt" TIMESTAMP WITH TIME ZONE, "name" character varying NOT NULL, "phone" character varying NOT NULL, "email" character varying NOT NULL, CONSTRAINT "PK_f1dfb48f1617b7b774fd4da7a97" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ac26e220df2e8a1d1aa1d840f7" ON "consults" ("userId") `);
    }

}
