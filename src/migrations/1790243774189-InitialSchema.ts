import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1790243774189 implements MigrationInterface {
    name = 'InitialSchema1790243774189'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "orders" ("id" character varying NOT NULL, "date" TIMESTAMP NOT NULL DEFAULT now(), "items" jsonb NOT NULL, "subtotal" integer NOT NULL, "codFee" integer NOT NULL, "total" integer NOT NULL, "paymentMethod" character varying NOT NULL, "customer" jsonb NOT NULL, "address" jsonb NOT NULL, "status" character varying NOT NULL DEFAULT 'placed', "userId" character varying, CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "consults" ("id" character varying NOT NULL, "clientId" character varying NOT NULL, "userId" character varying, "type" character varying NOT NULL, "dayLabel" character varying NOT NULL, "timeSlot" character varying NOT NULL, "concern" text NOT NULL DEFAULT '', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f1dfb48f1617b7b774fd4da7a97" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."user_role" AS ENUM('user', 'admin')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "password_hash" character varying(255) NOT NULL, "full_name" character varying(120), "role" "public"."user_role" NOT NULL DEFAULT 'user', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."user_role"`);
        await queryRunner.query(`DROP TABLE "consults"`);
        await queryRunner.query(`DROP TABLE "orders"`);
    }

}
