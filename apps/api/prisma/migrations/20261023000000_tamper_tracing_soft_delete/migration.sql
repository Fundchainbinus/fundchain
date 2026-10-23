-- Tamper tracing: simpan User-Agent di audit log.
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" TEXT;

-- Auto-freeze & soft-delete campaign.
ALTER TABLE "campaigns" ADD COLUMN "frozen_at" TIMESTAMP(3);
ALTER TABLE "campaigns" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Campaign yang sudah FROZEN sebelum kolom ini ada: anggap dibekukan saat update terakhir.
UPDATE "campaigns" SET "frozen_at" = "updated_at" WHERE "status" = 'FROZEN' AND "frozen_at" IS NULL;
