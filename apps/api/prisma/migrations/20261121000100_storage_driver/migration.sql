-- BFD-42 / BFD-15: driver penyimpanan (db | supabase) + upload langsung ke Supabase Storage.
-- Aditif & kompatibel mundur: baris lama tetap storage_driver='db' dengan bytea di kolom data;
-- kode lama yang insert tanpa kolom baru tetap jalan (semua kolom baru punya default / nullable).

-- Id stabil untuk GET /files/:id. Default volatile → Postgres mengisi uuid berbeda untuk tiap baris lama.
ALTER TABLE "stored_files" ADD COLUMN "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;
CREATE UNIQUE INDEX "stored_files_id_key" ON "stored_files"("id");

-- File di Supabase Storage tidak menyimpan isinya di Postgres.
ALTER TABLE "stored_files" ALTER COLUMN "data" DROP NOT NULL;

ALTER TABLE "stored_files" ADD COLUMN "storage_driver" TEXT NOT NULL DEFAULT 'db';
ALTER TABLE "stored_files" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'CONFIRMED';
ALTER TABLE "stored_files" ADD COLUMN "purpose" TEXT;
ALTER TABLE "stored_files" ADD COLUMN "owner_id" TEXT;
ALTER TABLE "stored_files" ADD COLUMN "original_name" TEXT;
