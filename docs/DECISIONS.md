# Log Keputusan (Decision Log)

Keputusan implementasi yang menyimpang dari, atau melengkapi, dokumen di `FundChain_Complete_Planning_Docs/`.
Ringkasannya juga ada di tabel _Keputusan implementasi vs dokumen planning_ di `README.md`.

Format: konteks → keputusan → konsekuensi. Entri baru ditambahkan di bawah; entri lama tidak diedit,
melainkan diganti dengan entri baru yang menyebut entri yang digantikan.

---

## D-001 — Kebijakan refund donasi (BFD-75)

**Status:** diterima · **Kode:** `apps/api/src/modules/payments/payments.service.ts` (`refund`, `assertRefundable`,
`assertCampaignFrozen`), endpoint `POST /api/v1/admin/donations/:id/refund` (`donations.controller.ts`, `@Roles('ADMIN')`).

### Konteks

Setiap donasi PAID punya canonical payload + hash yang dinotarisasi ke blockchain. Bukti on-chain itu
permanen dan tidak bisa diubah. Pakasir (gateway saat kebijakan ini dibuat) tidak punya API refund, jadi
uang tidak bisa dikembalikan otomatis. Refund dibutuhkan terutama saat campaign dibekukan (FROZEN) karena
masalah integritas atau laporan penyalahgunaan.

### Keputusan

1. **Manual.** Refund dicatat oleh admin; uangnya dikembalikan ke donatur **di luar sistem** (transfer manual).
   Sistem hanya mencatat status dan mengoreksi saldo.
2. **Hanya donasi PAID.** Donasi PENDING/FAILED/EXPIRED/REFUNDED ditolak (`DONATION_NOT_REFUNDABLE`).
   Refund kedua untuk donasi yang sama juga ditolak karena status sudah REFUNDED (guard atomik `updateMany ... status: 'PAID'`).
3. **Hanya campaign FROZEN.** Di campaign ACTIVE/COMPLETED (dan status lain) refund ditolak
   (`REFUND_CAMPAIGN_NOT_FROZEN`). Status campaign dicek di dalam transaksi setelah baris campaign dikunci.
4. **Admin saja, wajib alasan.** Endpoint dijaga `@Roles('ADMIN')`; `reason` wajib 5–500 karakter.
5. **Penuh, dibatasi saldo bebas.** Refund selalu sebesar nominal donasi (tidak ada refund sebagian) dan tidak boleh
   melebihi `currentAmount` dikurangi pencairan yang sudah terikat (REQUESTED/APPROVED/PAID); bila kurang →
   `REFUND_EXCEEDS_AVAILABLE`, dan pencairan terkait harus ditolak/diselesaikan dulu.
6. **Catatan notaris tidak disentuh.** Refund adalah **status baru + entri audit**, bukan edit catatan yang
   dinotarisasi. `hash`, `canonicalPayload`, `donatedAt`, dan baris `blockchain_transactions` tetap seperti semula;
   tidak ada transaksi on-chain baru. Yang berubah hanya: `donations.status` → REFUNDED,
   `payments.status` → REFUNDED, `campaigns.current_amount` dikurangi nominal donasi.
7. **Audit.** Satu entri `DONATION_REFUNDED` dengan `actorId` admin, IP, alasan, nominal, status & alasan freeze
   campaign, hash donasi, dan status on-chain saat refund. Semua langkah di atas berjalan dalam satu transaksi
   (gagal di tengah = rollback penuh).

### Konsekuensi

- Integrity checker hanya memverifikasi donasi PAID, sehingga donasi REFUNDED tidak terdeteksi TAMPERED walaupun
  hash-nya masih tercatat on-chain. Bukti on-chain tetap membuktikan bahwa donasi itu pernah dibayar.
- Bukti pengembalian dana (mis. bukti transfer) belum disimpan sistem; admin menyimpannya di luar sistem dan
  merujuknya di `reason`.
- Webhook SETTLED yang datang lagi setelah refund diperlakukan sebagai replay dan tidak menghidupkan donasi kembali
  (pembayaran REFUNDED dianggap final di `applyEvent`).

---

## D-002 — Payment gateway: Pakasir → Sakurupiah (BFD-107 – BFD-111)

**Status:** diterima, implementasi berjalan.

### Konteks

Integrasi awal memakai adapter `pakasir` (QRIS) di samping adapter `mock`.

### Keputusan

- Tim pindah dari Pakasir ke gateway **Sakurupiah**; pekerjaannya ada di BFD-107 sampai BFD-111.
- Adapter `pakasir` tidak dikembangkan lagi.

### Pertanyaan terbuka

- Kapan adapter `pakasir` dihapus dari kode.
- Apakah Sakurupiah punya API refund, dan apakah D-001 (refund manual di luar sistem) perlu ditinjau ulang.
  Sampai ada keputusan baru, D-001 tetap berlaku.

---

## D-003 — RLS deny-all tetap dipakai (BFD-23)

**Status:** diterima (tech lead) · **Kode:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` di setiap migrasi
(`apps/api/prisma/migrations/`), guard `apps/api/src/rls.test.ts`.

### Konteks

Supabase otomatis mengekspos semua tabel di schema `public` lewat Data API (PostgREST) ke role `anon` dan
`authenticated`. Pertanyaannya: perlukah policy RLS per tabel (mis. donatur hanya melihat donasinya sendiri)?

### Keputusan

1. **RLS aktif tanpa policy (deny-all) di semua tabel**, termasuk `_prisma_migrations`. Role `anon`/`authenticated`
   tidak bisa membaca atau menulis apa pun lewat Data API.
2. **Aplikasi hanya mengakses DB lewat Prisma** di backend, dengan role owner yang mem-bypass RLS. Frontend tidak
   memakai Supabase client, anon key, maupun PostgREST.
3. **Kontrol akses ada di service NestJS** (`@Roles`, cek kepemilikan di service). Aturannya tidak diduplikasi
   menjadi policy SQL.
4. **Dijaga test.** `rls.test.ts` membaca semua file migrasi. Test gagal kalau ada tabel yang di-`CREATE TABLE`
   tanpa `ENABLE ROW LEVEL SECURITY`, kalau RLS di-`DISABLE`, atau kalau ada `CREATE POLICY` untuk
   `anon`/`authenticated`/`public` (policy tanpa klausa `TO` dihitung `public`).

### Konsekuensi

- Setiap migrasi yang menambah tabel **wajib** menambahkan `ALTER TABLE "<tabel>" ENABLE ROW LEVEL SECURITY;`.
  Prisma tidak menulisnya otomatis.
- Role database lain selain owner (mis. role read-only untuk backup, lihat `docs/BACKUP.md`) ikut terkena deny-all
  dan butuh `BYPASSRLS` atau policy khusus untuk role itu.
- Satu lapis pertahanan saja: kalau connection string owner bocor, RLS tidak melindungi apa pun.

### Kapan ditinjau ulang

- Begitu ada fitur yang memakai Supabase client, PostgREST, Realtime, atau Storage langsung dari browser. Saat itu
  policy per tabel wajib ditulis dan diuji sebelum anon key dipakai.
- Kalau backend pindah dari role owner ke role terbatas (mis. role per service).

---

## D-004 — Envelope response tetap `{ success, data }` (BFD-40)

**Status:** diterima (tech lead) · **Menggantikan:** usulan envelope `{ data, meta }` di tiket BFD-40.
**Kode:** `apps/api/src/common/http.ts` (interceptor sukses + exception filter).

### Konteks

BFD-40 mengusulkan mengganti envelope response menjadi `{ data, meta }`, dengan metadata pagination di `meta`.
Implementasi saat ini, dan dokumen `08-API-SPEC.md` / `API SPEC DETAIL.md`, memakai `{ success: true, data }`
untuk sukses dan `{ success: false, error: { code, message, details? } }` untuk error. Frontend (`apps/web`) sudah
bergantung pada bentuk ini, termasuk `nextCursor` untuk infinite query.

### Keputusan

1. **Envelope tidak diubah.** Sukses → `{ success: true, data }`; error → `{ success: false, error: { code, message, details? } }`.
2. **Endpoint list tetap menaruh cursor di dalam `data`**, mis. `{ success: true, data: { logs: [...], nextCursor } }`.
   Tidak ada field `meta` di level atas.
3. Usulan `{ data, meta }` di BFD-40 **tidak dipakai**. Tidak ada perubahan kode.

### Konsekuensi

- Tidak ada breaking change untuk frontend maupun koleksi Postman/OpenAPI.
- Endpoint list baru mengikuti pola yang sama (`nextCursor` atau `hasMore` di dalam `data`).
- Kalau kelak ada konsumen API eksternal yang butuh `meta` standar, buat versi API baru (`/api/v2`). Jangan ubah
  envelope v1.
