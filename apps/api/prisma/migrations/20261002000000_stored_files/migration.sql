-- CreateTable
CREATE TABLE "stored_files" (
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("key")
);


-- Supabase: tutup akses Data API (anon/authenticated); backend tetap bisa.
ALTER TABLE "stored_files" ENABLE ROW LEVEL SECURITY;
