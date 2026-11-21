-- BFD-11: versi sesi untuk revokasi token. Additive + DEFAULT 0: kode lama tetap jalan,
-- dan token lama (tanpa versi) dianggap versi 0 sehingga user yang sedang login tidak ter-logout.
ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;
