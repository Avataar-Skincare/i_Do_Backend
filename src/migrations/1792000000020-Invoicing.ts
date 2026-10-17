import { MigrationInterface, QueryRunner } from "typeorm";

/** LLD v1.4 M20 (TD-14): document_series, invoices, credit_notes. */
export class Invoicing1792000000020 implements MigrationInterface {
    name = 'Invoicing1792000000020'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "document_series" (
            "key" character varying(16) NOT NULL,
            "financial_year" character(5) NOT NULL,
            "prefix" character varying(8) NOT NULL,
            "next_no" integer NOT NULL DEFAULT 1,
            CONSTRAINT "PK_document_series" PRIMARY KEY ("key", "financial_year"),
            CONSTRAINT "CHK_document_series_key" CHECK ("key" IN ('invoice','credit_note')),
            CONSTRAINT "CHK_document_series_fy" CHECK ("financial_year" ~ '^[0-9]{2}-[0-9]{2}$'),
            CONSTRAINT "CHK_document_series_next_no" CHECK ("next_no" >= 1)
        )`);

        await queryRunner.query(`CREATE TABLE "invoices" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "order_id" character varying(16) NOT NULL,
            "number" character varying(16) NOT NULL,
            "type" character varying(3) NOT NULL,
            "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL,
            "place_of_supply_state" character varying(64) NOT NULL,
            "taxable_value" integer NOT NULL,
            "cgst" integer NOT NULL DEFAULT 0,
            "sgst" integer NOT NULL DEFAULT 0,
            "igst" integer NOT NULL DEFAULT 0,
            "total" integer NOT NULL,
            "lines" jsonb NOT NULL,
            "buyer_gstin" character varying(15),
            "buyer_legal_name" character varying(160),
            "irn" character varying(64),
            "pdf_s3_key" character varying(255),
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_invoices" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_invoices_order" UNIQUE ("order_id"),
            CONSTRAINT "UQ_invoices_number" UNIQUE ("number"),
            CONSTRAINT "FK_invoices_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
            CONSTRAINT "CHK_invoices_type" CHECK ("type" IN ('b2c','b2b')),
            CONSTRAINT "CHK_invoices_b2b_gstin" CHECK (("type" = 'b2b') = ("buyer_gstin" IS NOT NULL)),
            CONSTRAINT "CHK_invoices_tax_nonneg" CHECK ("taxable_value" >= 0 AND "cgst" >= 0 AND "sgst" >= 0 AND "igst" >= 0),
            CONSTRAINT "CHK_invoices_tax_split" CHECK ("igst" = 0 OR ("cgst" = 0 AND "sgst" = 0)),
            CONSTRAINT "CHK_invoices_total" CHECK ("total" = "taxable_value" + "cgst" + "sgst" + "igst")
        )`);

        await queryRunner.query(`CREATE TABLE "credit_notes" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "invoice_id" uuid NOT NULL,
            "refund_id" uuid NOT NULL,
            "number" character varying(20) NOT NULL,
            "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL,
            "amount" integer NOT NULL,
            "taxable_value" integer NOT NULL,
            "cgst" integer NOT NULL DEFAULT 0,
            "sgst" integer NOT NULL DEFAULT 0,
            "igst" integer NOT NULL DEFAULT 0,
            "pdf_s3_key" character varying(255),
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_credit_notes" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_credit_notes_refund" UNIQUE ("refund_id"),
            CONSTRAINT "UQ_credit_notes_number" UNIQUE ("number"),
            CONSTRAINT "FK_credit_notes_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id"),
            CONSTRAINT "FK_credit_notes_refund" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id"),
            CONSTRAINT "CHK_credit_notes_tax_nonneg" CHECK ("taxable_value" >= 0 AND "cgst" >= 0 AND "sgst" >= 0 AND "igst" >= 0),
            CONSTRAINT "CHK_credit_notes_tax_split" CHECK ("igst" = 0 OR ("cgst" = 0 AND "sgst" = 0)),
            CONSTRAINT "CHK_credit_notes_amount" CHECK ("amount" > 0 AND "amount" = "taxable_value" + "cgst" + "sgst" + "igst")
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_credit_notes_invoice" ON "credit_notes" ("invoice_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "credit_notes"`);
        await queryRunner.query(`DROP TABLE "invoices"`);
        await queryRunner.query(`DROP TABLE "document_series"`);
    }

}
