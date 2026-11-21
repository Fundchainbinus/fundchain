-- BFD-76: index untuk hot read path (lihat docs/PERFORMANCE.md).
-- Additive saja: tidak ada index yang dihapus. Nama index = nama yang dihasilkan Prisma
-- (prisma migrate diff) supaya tidak ada drift di migrate berikutnya.
-- Catatan: Prisma menjalankan migrasi di dalam transaksi, jadi CREATE INDEX CONCURRENTLY tidak bisa
-- dipakai di sini. Tabel masih kecil; lock tulis singkat saat deploy bisa diterima.

-- "Donasi Saya": WHERE donor_id = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS "donations_donor_id_created_at_idx" ON "donations"("donor_id", "created_at");

-- Admin donations: WHERE status = ? ORDER BY created_at DESC LIMIT 200
CREATE INDEX IF NOT EXISTS "donations_status_created_at_idx" ON "donations"("status", "created_at");

-- Hash checker terjadwal (verifyStale): WHERE status = 'PAID' AND (last_checked_at IS NULL OR last_checked_at < ?)
CREATE INDEX IF NOT EXISTS "donations_status_last_checked_at_idx" ON "donations"("status", "last_checked_at");

-- expireStale (tiap housekeeping tick): WHERE status = 'PENDING' AND expires_at < now() ORDER BY expires_at
CREATE INDEX IF NOT EXISTS "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- Admin disbursements: WHERE status = ? ORDER BY requested_at DESC LIMIT 200
CREATE INDEX IF NOT EXISTS "disbursements_status_requested_at_idx" ON "disbursements"("status", "requested_at");

-- Audit log filter per aktor: WHERE actor_id = ? ORDER BY created_at DESC (juga index FK actor_id)
CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");
