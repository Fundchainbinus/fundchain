# Performa query (BFD-76)

Review query Prisma di hot read path terhadap index di `apps/api/prisma/schema.prisma`. Index baru ada di
migrasi `apps/api/prisma/migrations/20261121000200_perf_indexes/`. Guard test: `apps/api/src/perf.test.ts`.

## Index yang ditambahkan

Semuanya additive (`CREATE INDEX IF NOT EXISTS`) dan tidak ada index yang dihapus. Nama index diambil dari output
`prisma migrate diff`, jadi schema dan migrasi tidak drift. `perf.test.ts` memeriksa bahwa setiap `@@index` di
schema punya `CREATE INDEX` bernama sama di salah satu migrasi.

| Index | Query yang dilayani | Kode |
| ----- | ------------------- | ---- |
| `payments(status, expires_at)` | `expireStale`: `status = 'PENDING' AND expires_at < now() ORDER BY expires_at LIMIT 100`. Jalan tiap housekeeping tick; tanpa index ini query-nya seq scan seluruh `payments` | `payments.service.ts` |
| `donations(donor_id, created_at)` | "Donasi Saya": `donor_id = ? ORDER BY created_at DESC` | `donations.service.ts` (`listMine`) |
| `donations(status, created_at)` | Admin donations: `status = ? ORDER BY created_at DESC LIMIT 200` | `donations.service.ts` (`listAll`) |
| `donations(status, last_checked_at)` | Hash checker terjadwal `verifyStale`: `status = 'PAID' AND (last_checked_at IS NULL OR last_checked_at < ?)`. Index hanya membantu filter; sort `NULLS FIRST` tetap dikerjakan planner | `integrity.service.ts` |
| `disbursements(status, requested_at)` | Admin disbursements: `status = ? ORDER BY requested_at DESC LIMIT 200` | `disbursements.service.ts` (`listAdmin`) |
| `audit_logs(actor_id, created_at)` | Filter audit log per aktor + urut waktu. Sekaligus jadi index untuk FK `actor_id` | `audit.service.ts` (`list`) |

**Tidak memakai `CONCURRENTLY`.** Prisma menjalankan setiap migrasi di dalam transaksi, sedangkan
`CREATE INDEX CONCURRENTLY` tidak bisa jalan di dalam transaksi. Akibatnya tabel terkunci untuk tulis selama
index dibuat. Dengan ukuran data sekarang (ratusan sampai ribuan baris) waktunya hanya milidetik. Kalau tabel
sudah besar, buat index secara manual dengan `CONCURRENTLY` di luar Prisma lebih dulu; `IF NOT EXISTS` membuat
migrasi ini otomatis menjadi no-op.

Index lama yang sekarang tumpang tindih (`donations(donor_id)` adalah prefix dari `donations(donor_id, created_at)`)
sengaja tidak dihapus supaya migrasi tetap additive. Index itu bisa dihapus di migrasi terpisah kalau overhead
tulisnya terasa.

## Perbaikan query (file yang dimiliki BFD-76)

| Masalah | Perbaikan | Test |
| ------- | --------- | ---- |
| `verifyMany` (verify-all / verify per campaign) tanpa batas. Tiap donasi = 1 panggilan RPC + 1 transaksi, jadi request admin bisa melewati batas waktu fungsi Vercel | Maks `VERIFY_MANY_MAX` (100) per panggilan, urut `last_checked_at` naik (panggilan berikutnya maju ke donasi lain), field tambahan `hasMore`. Donasi yang gagal dicek digeser ke belakang | `perf.test.ts` › `IntegrityService.verifyMany` |
| `recoverStuck` (worker): dua scan `SUBMITTED` tanpa `take`, dan tiap baris memanggil RPC | `take: RECOVER_BATCH` (20), urut `submitted_at` naik | `perf.test.ts` › `NotarizationWorker scan` |
| `alertStuck`: lookup audit `action + entity_id IN (...)` tidak memakai index | Tambah `entityType: 'Donation'` agar memakai `audit_logs(entity_type, entity_id)` | `perf.test.ts` › `alertStuck` |
| `verifyDonation` & `applyEvent` memuat seluruh baris `users` (termasuk email/nama) padahal hanya butuh `integrity_subject_id` | `donor: { select: { integritySubjectId: true } }` | `perf.test.ts` |
| Worker `process()` memuat seluruh baris donasi | `select: { status, hash }` | `notarization.worker.test.ts` (tetap lulus) |
| `audit.list`: `?limit=abc` → `take: NaN`; `from`/`to` tidak valid → Invalid Date. Keduanya membuat Prisma error (500) | `clampAuditLimit` (NaN → default 50, batas 1..200); tanggal tidak valid → `400 VALIDATION_ERROR` | `perf.test.ts` › `AuditService.list` |

## Yang dicek dan sudah cukup

- **Antrean notarisasi** (`status IN (QUEUED, RETRYING) AND next_attempt_at <= now()`, `take 5`): dilayani
  `blockchain_transactions(status, next_attempt_at)`. Scan `alertStuck` (`take 20`) dan `recoverStuck` memakai
  prefix `status` yang sama. Baris non-CONFIRMED selalu sedikit.
- **Donasi per campaign** (`campaign_id = ? AND status = 'PAID' ORDER BY donated_at DESC`, `take <= 200`), plus
  `_count`/`groupBy` di detail & list campaign: dilayani `donations(campaign_id, status)`.
- **Detail campaign** by PK, ringkasan disbursement `disbursements(campaign_id, status)`.
- **Audit log list**: `ORDER BY created_at DESC, id DESC LIMIT n+1` dilayani `audit_logs(created_at)`.
  `campaignActivity` dilayani `audit_logs(entity_type, entity_id)` dan dibatasi 50.
- **Admin stats**: `groupBy` di seluruh tabel kecil, jadi seq scan wajar.

## Tidak ditambahkan / rekomendasi (di luar file BFD-76)

- **`audit_logs(action, created_at)` tidak ditambahkan.** Filter `action` di `audit.list` memakai
  `contains` + `insensitive` (`ILIKE '%x%'`), dan btree tidak bisa melayani pola itu. Kalau perlu, pakai
  `pg_trgm` + GIN, atau ubah filter menjadi exact match dengan dropdown action di UI.
- **Campaign list publik** (`status IN (...) AND deleted_at IS NULL ORDER BY created_at DESC`): belum ada
  `campaigns(status, created_at)`. Model `Campaign` milik modul campaigns, jadi ini hanya rekomendasi.
  Pencarian `q` (`ILIKE` di title/description) butuh trigram kalau data membesar.
- **FK tanpa index**: `campaign_documents(campaign_id)` dan `campaign_reviews(campaign_id)` (di-load di detail
  campaign), serta `disbursements(requester_id)`. Direkomendasikan untuk modul campaigns/disbursements.
- **Query tanpa batas** di modul lain dicatat sebagai OPEN di [`BUGS.md`](BUGS.md).
