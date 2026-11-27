-- BFD-127 / BFD-128 (issue #34): lease cron tick lintas instance + jejak tick terakhir untuk monitoring.
-- Additive: tabel baru, tidak ada data lama yang berubah.
CREATE TABLE IF NOT EXISTS "system_state" (
    "key" TEXT NOT NULL,
    "locked_until" TIMESTAMP(3),
    "lock_owner" TEXT,
    "last_tick_at" TIMESTAMP(3),
    "last_tick_ms" INTEGER,
    "last_tick_ok" BOOLEAN,
    "last_tick_steps" JSONB,
    "last_tick_source" TEXT,
    "last_stale_alert_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_state_pkey" PRIMARY KEY ("key")
);

-- D-003: semua tabel deny-all untuk role anon/authenticated (API memakai koneksi langsung).
ALTER TABLE "system_state" ENABLE ROW LEVEL SECURITY;

-- Baris lease dibuat di sini supaya klaim lease cukup satu UPDATE bersyarat.
INSERT INTO "system_state" ("key") VALUES ('cron_tick') ON CONFLICT ("key") DO NOTHING;
