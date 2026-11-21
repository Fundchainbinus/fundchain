# Bug log (BFD-41)

Bug yang ditemukan di audit backend dan statusnya. Entri baru ditambahkan di bawah. Commit dirujuk dengan hash pendek
(`git show <hash>`).

Severity: **High** = uang/integritas/data salah · **Medium** = error 500, kebocoran data kecil, atau beban berlebih ·
**Low** = kosmetik atau risiko kecil.

## Diperbaiki

| ID | Bug | Severity | Status | Fix | Test |
| -- | --- | -------- | ------ | --- | ---- |
| BUG-001 | **Race Idempotency-Key.** Dua request donasi bersamaan dengan `Idempotency-Key` sama: yang kalah kena unique violation Prisma `P2002` dan dapat 500, bukan replay donasi pemenang (BFD-17/46) | Medium | FIXED | `7ba11ee`: P2002 ditangkap; key + isi sama → replay detail donasi pemenang; isi beda → konflik | `apps/api/src/domain.test.ts` › *DonationsService.create — race Idempotency-Key (BFD-17/46)* |
| BUG-002 | **Webhook SETTLED diputar ulang setelah refund** menghidupkan donasi REFUNDED lagi: hash baru dibuat, `current_amount` naik dua kali, job notarisasi baru | High | FIXED | `f64358e`: payment `REFUNDED` dianggap final di `applyEvent` (replay), dan guard `updateMany` mengecualikan `REFUNDED` | `apps/api/src/payments-flow.test.ts` › *webhook SETTLED yang diputar ulang setelah refund → replayed, donasi tetap REFUNDED* |
| BUG-003 | **`PAYMENT_STATUSES` di `@fundchain/shared` tanpa `REFUNDED`**, padahal refund (D-001) menulis `payments.status = 'REFUNDED'`. Validasi atau tipe yang memakai konstanta itu menolak status valid | Medium | FIXED | `2154a7f`: `REFUNDED` ditambahkan ke `PAYMENT_STATUSES` | Belum ada test khusus untuk konstanta. Alur refund di `apps/api/src/payments.test.ts` (*PAID -> REFUNDED ...*) |
| BUG-004 | **`GET /admin/audit-logs?limit=abc`** → `Number('abc') = NaN` lolos `??` dan clamp, jadi `take: NaN` dan Prisma error (500) | Medium | FIXED | Commit `ec9017a`: `clampAuditLimit` (NaN → 50, batas 1..200) | `apps/api/src/perf.test.ts` › *AuditService.list* |
| BUG-005 | **`GET /admin/audit-logs?from=<bukan tanggal>`** → `new Date()` menghasilkan Invalid Date, Prisma error (500) | Low | FIXED | Commit `ec9017a`: `from`/`to` tidak valid → `400 VALIDATION_ERROR` tanpa query DB | `apps/api/src/perf.test.ts` › *tanggal tidak valid → VALIDATION_ERROR* |
| BUG-006 | **Verify-all / verify per campaign tanpa batas.** Satu RPC + satu transaksi per donasi untuk SEMUA donasi PAID, sehingga request admin bisa timeout di Vercel dan berhenti di tengah jalan | Medium | FIXED (API) · UI: BUG-015 | Commit `ec9017a`: maks 100 per panggilan, urut PENDING/TAMPERED dulu lalu `last_checked_at`, field tambahan `hasMore` | `apps/api/src/perf.test.ts` › *IntegrityService.verifyMany* |
| BUG-007 | **`recoverStuck` worker tanpa batas.** Kalau banyak tx macet di SUBMITTED, satu tick memanggil RPC untuk semuanya dan bisa melewati batas waktu fungsi | Low | FIXED | Commit `ec9017a`: `take: 20` per scan, terlama dulu | `apps/api/src/perf.test.ts` › *NotarizationWorker scan* |
| BUG-008 | **Integrity checker & settlement memuat seluruh baris `users`** (email, nama) hanya untuk `integrity_subject_id`. Data pribadi dimuat tanpa perlu | Low | FIXED | Commit `ec9017a`: `select: { integritySubjectId: true }` | `apps/api/src/perf.test.ts` |

## OPEN (di luar file yang dimiliki BFD-41/76; perlu pemilik modul)

Bug terbuka dilacak sebagai GitHub Issues berlabel `qa-triage` (BFD-64); severity S1–S4 dan aturan triase ada di
[`qa/BUG-TRIAGE.md`](qa/BUG-TRIAGE.md). Temuan QA baru: [#33](https://github.com/Fundchainbinus/fundchain/issues/33)
(QA-001), [#34](https://github.com/Fundchainbinus/fundchain/issues/34) (QA-002).

| ID | Bug | Severity | Lokasi | Saran |
| -- | --- | -------- | ------ | ----- |
| BUG-009 ([#27](https://github.com/Fundchainbinus/fundchain/issues/27)) | "Donasi Saya" tanpa batas: `findMany` tanpa `take`, dan memuat seluruh baris `blockchain` + `payment` | Medium | `apps/api/src/modules/donations/donations.service.ts` › `listMine` | Pagination cursor seperti audit log (`take`, `nextCursor` di dalam `data`, lihat D-004) dan `select` kolom yang dipakai. Index `donations(donor_id, created_at)` sudah ada |
| BUG-010 ([#28](https://github.com/Fundchainbinus/fundchain/issues/28)) | Poin comserve tanpa batas: semua donasi PAID donatur dimuat untuk dihitung di JS | Low | `donations.service.ts` › `pointsMine` | Agregasi di DB (`groupBy`/`aggregate`), atau batasi |
| BUG-011 ([#29](https://github.com/Fundchainbinus/fundchain/issues/29)) | Housekeeping tanpa batas: `completeExpired` dan `softDeleteFrozen` memproses semua campaign sekaligus (1 transaksi per campaign) dalam satu tick | Low | `apps/api/src/modules/campaigns/campaigns.service.ts` | `take` per tick (mis. 50) seperti `expireStale` |
| BUG-012 ([#30](https://github.com/Fundchainbinus/fundchain/issues/30)) | Daftar disbursement per campaign (`listForCampaign`, `milestones`) tanpa `take` | Low | `apps/api/src/modules/disbursements/disbursements.service.ts` | Batasi atau paginasi. Saat ini jumlah per campaign kecil |
| BUG-013 ([#31](https://github.com/Fundchainbinus/fundchain/issues/31)) | `expireStale`: kalau `fetchStatus` gateway mengembalikan SETTLED dengan nominal salah, `applyEvent` melempar `PAYMENT_AMOUNT_MISMATCH` (ditelan `catch`) dan payment tetap PENDING. Baris itu diambil lagi setiap tick (urut `expires_at`), menulis audit `PAYMENT_AMOUNT_MISMATCH` berulang, dan kalau jumlahnya ≥ 100 baris lain tidak pernah diproses | Low | `apps/api/src/modules/payments/payments.service.ts` › `expireStale` | Butuh keputusan bisnis (tandai FAILED/EXPIRED + alert?). Bukan perubahan query, jadi tidak diubah di BFD-76 |
| BUG-015 | Banner hasil verify-all di dashboard admin menulis "Semua {checked} donasi cocok" tanpa melihat `hasMore`. Sejak BUG-006 diperbaiki, satu panggilan hanya mengecek ≤ 100 donasi, jadi pesan itu bisa memberi rasa aman palsu | Medium | `apps/web/src/pages/admin/AdminPages.tsx` (~baris 337–388) | Tampilkan "N donasi lagi belum dicek, jalankan lagi" kalau `hasMore`, atau ulangi otomatis sampai `hasMore: false`. **FIXED**: banner sekarang membaca `hasMore` dan meminta admin menjalankan batch berikutnya |
| BUG-014 ([#32](https://github.com/Fundchainbinus/fundchain/issues/32)) | Index yang direkomendasikan untuk model di luar BFD-76: `campaigns(status, created_at)` (list publik), FK `campaign_documents(campaign_id)`, `campaign_reviews(campaign_id)`, `disbursements(requester_id)` | Low | `schema.prisma` model Campaign/CampaignDocument/CampaignReview | Lihat [`PERFORMANCE.md`](PERFORMANCE.md) |
