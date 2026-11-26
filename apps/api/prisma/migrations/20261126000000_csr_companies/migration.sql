-- Mitra CSR perusahaan. Kontribusi CSR dicatat sebagai donasi biasa (PAID → hash → notarisasi) atas nama
-- user khusus perusahaan (role COMPANY, email sintetis yang tidak bisa login), jadi bukti blockchain-nya sama.
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "website" TEXT,
    "description" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");
CREATE UNIQUE INDEX "companies_user_id_key" ON "companies"("user_id");

ALTER TABLE "companies" ADD CONSTRAINT "companies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D-003: semua tabel deny-all untuk Data API Supabase; backend mengakses lewat role owner.
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
