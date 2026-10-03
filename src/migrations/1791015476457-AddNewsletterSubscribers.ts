import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNewsletterSubscribers1791015476457 implements MigrationInterface {
    name = 'AddNewsletterSubscribers1791015476457'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "newsletter_subscribers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "subscribedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "unsubscribedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_0dc48416511f011f7de7b2a8f83" UNIQUE ("email"), CONSTRAINT "PK_38f9333e9961b2fdb589128d19b" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "newsletter_subscribers"`);
    }

}
