-- BUG-014 / #32: index yang direkomendasikan docs/PERFORMANCE.md.
-- Additive saja (IF NOT EXISTS), tidak ada data yang berubah. Nama = nama default Prisma.

-- Daftar kampanye publik & admin: WHERE status IN (...) ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS "campaigns_status_created_at_idx" ON "campaigns"("status", "created_at");

-- Proposal terbaru per kampanye: WHERE campaign_id = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS "campaign_documents_campaign_id_created_at_idx" ON "campaign_documents"("campaign_id", "created_at");

-- Riwayat review per kampanye (FK campaign_id)
CREATE INDEX IF NOT EXISTS "campaign_reviews_campaign_id_idx" ON "campaign_reviews"("campaign_id");

-- Pencairan per pengaju (FK requester_id)
CREATE INDEX IF NOT EXISTS "disbursements_requester_id_idx" ON "disbursements"("requester_id");
