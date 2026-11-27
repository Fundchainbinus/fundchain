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

---

## D-005 — Expiry donasi 15 menit + GitHub Actions cron tiap 10 menit (BFD-22)

**Status:** diterima (tech lead) · **Menggantikan:** expiry 30 menit di tiket BFD-22.
**Kode:** `LIMITS.PAYMENT_EXPIRY_MINUTES` (`packages/shared/src/constants.ts`), `PaymentsService.expireStale`,
`GET /api/v1/cron/tick` (`integrity.controller.ts`), `.github/workflows/cron-tick.yml`.

### Konteks

BFD-22 meminta donasi PENDING kedaluwarsa setelah 30 menit. Kode memakai 15 menit, sama dengan masa berlaku QR
yang dibuat adapter pembayaran. Di Vercel tidak ada worker yang berjalan terus (`WORKER_MODE=on-demand`), dan Vercel
Cron di paket Hobby hanya boleh harian, jadi donasi bisa tetap PENDING hingga satu hari.

### Keputusan

1. **Expiry tetap 15 menit.** Lewat dari itu QR sudah tidak bisa dibayar, jadi status PENDING hanya menyesatkan.
2. **Pemicu serverless = GitHub Actions** (`cron-tick.yml`): jadwal `*/10 * * * *` + `workflow_dispatch`, memanggil
   `GET /api/v1/cron/tick` dengan `Authorization: Bearer <CRON_SECRET>`. Secret repo `CRON_SECRET` harus sama dengan
   `CRON_SECRET` di Vercel. Workflow gagal dengan pesan jelas bila secret belum di-set dan tidak pernah mencetaknya.
3. Vercel Cron harian di `vercel.json` tetap ada sebagai cadangan.

### Konsekuensi

- Batas atas status PENDING ≈ 15 menit + 10 menit + keterlambatan jadwal GitHub (bisa beberapa menit, kadang dilewati
  saat beban tinggi). Schedule hanya jalan dari default branch dan dinonaktifkan GitHub bila repo tidak aktif 60 hari.
- Tick yang sama juga memproses antrean notarisasi dan campaign lewat deadline, jadi keduanya ikut lebih cepat.
- Bila pindah ke Vercel Pro (cron per menit) atau worker permanen, workflow ini boleh dihapus.

---

## D-006 — Login Google: GIS popup + verifikasi token di `POST /auth/google` (BFD-10)

**Status:** diterima · **Kode:** `apps/web/src/lib/google.ts`, `UsersController.loginGoogle` (`users.controller.ts`).

### Konteks

Rancangan awal memakai alur redirect OAuth di server (Passport: `/auth/google` → Google → callback). API berjalan
sebagai Vercel Function stateless tanpa session store, dan web di-host terpisah.

### Keputusan

1. Web memakai **Google Identity Services (GIS) token client** (`initTokenClient`, popup, scope `openid email profile`)
   untuk mendapat access token Google.
2. Web mengirim token itu ke **`POST /api/v1/auth/google`** (`{ accessToken }`). Server memverifikasi lewat Google
   `tokeninfo` (audience harus `GOOGLE_CLIENT_ID`) dan `userinfo` (email wajib terverifikasi), lalu menerbitkan token
   sesi FundChain sendiri. Tidak ada Passport dan tidak ada callback URL di API.

### Konsekuensi

- Alur OAuth tidak butuh state/session di server, cocok untuk serverless. Callback URL tidak perlu didaftarkan per
  environment; cukup "Authorized JavaScript origins".
- Setiap login memanggil Google dua kali dari server (endpoint dibatasi 10 request/menit per IP).
- Token Google hanya dipakai sekali saat login; selanjutnya yang berlaku token sesi FundChain.

---

## D-007 — `PaymentGateway` tanpa `refund()` (BFD-19, BFD-108)

**Status:** diterima · **Kode:** `apps/api/src/modules/payments/adapters/payment-gateway.ts`.

### Konteks

BFD-19/BFD-108 menyebut kemampuan refund di adapter gateway. Refund saat ini manual di luar sistem (D-001), dan API
refund Sakurupiah (D-002) belum diketahui.

### Keputusan

Interface `PaymentGateway` **tidak** punya method `refund()`. Refund tetap dicatat lewat
`POST /api/v1/admin/donations/:id/refund` sesuai D-001, tanpa memanggil gateway.

### Konsekuensi

- Adapter `mock`/`pakasir` tidak dipaksa mengimplementasikan method yang tidak didukung gateway-nya.
- **Ditinjau ulang** begitu API refund Sakurupiah diketahui: bila ada, tambahkan `refund?()` opsional di interface dan
  panggil dari `PaymentsService.refund`, lalu ganti D-001/D-007 dengan entri baru.

---

## D-008 — Deploy Sepolia final: `DonationRegistry` di `0x3Aa2…35b2` (BFD-8, BFD-81)

**Status:** diterima (final untuk demo) · **Sumber:** `contracts/deployments/sepolia.json`,
`docs/blockchain/evidence/SEPOLIA-E2E.md`. Disusun oleh tech lead mewakili QA, 22 Nov 2026.

### Konteks

Gate dan dokumen QA butuh satu alamat kontrak yang tidak berubah lagi sampai demo, supaya bukti notarisasi
(16 event `DonationNotarized`) dan konfigurasi production tetap konsisten.

### Keputusan

| Item | Nilai |
| --- | --- |
| Network | Sepolia, chainId `11155111` |
| Kontrak | `DonationRegistry` di `0x3Aa2DA59AAe8490188d84345827eb76d4C4835b2` |
| Blok deploy | `11829714` (`deployedAt` 2026-10-02T14:55:22Z) |
| Admin (`DEFAULT_ADMIN_ROLE`) | `0xfC2D0Cba3EFBfa62AFd17882Fb0281C725A8c1f3` |
| Relayer (`RELAYER_ROLE`) | `0x04ae100476632717De6Fb2A622DB8062c9eBBF89` |

1. Alamat ini **final**: `CONTRACT_ADDRESS` production (dicek lewat `GET /api/v1/config` dan `/blockchain/info`,
   22 Nov 2026) sama dengan nilai di atas. Tidak ada redeploy sebelum demo.
2. Kunci relayer yang bocor ditangani dengan rotasi role (`docs/blockchain/RELAYER-ROLE-RUNBOOK.md`), **bukan**
   redeploy, karena redeploy membuat bukti on-chain lama tidak terbaca dari alamat baru.

### Konsekuensi / item terbuka

- **Source belum diverifikasi** di Etherscan/Sourcify per 21 Nov 2026. Verifikasi wajib sebelum demo
  (`contracts/scripts/verify-contract.ts`, butuh `ETHERSCAN_API_KEY`). Lihat `docs/qa/RISK-REGISTER.md` R-03.
- Bila redeploy tetap terpaksa, entri ini diganti entri baru, dan donasi lama tetap diverifikasi ke alamat lama.

---

## D-009 — Versi canonical final: v1 (BFD-8, BFD-81)

**Status:** diterima (final) · **Sumber:** `packages/shared/README.md` (spesifikasi canonical payload v1),
`packages/shared/src/canonical.test.ts`. Disusun oleh tech lead mewakili QA, 22 Nov 2026.

### Keputusan

1. Format canonical yang berlaku untuk rilis/demo adalah **v1**:
   `v1|<donationId lowercase>|<integritySubjectId>|<amount>|<donatedAt detik Unix>`, di-hash `keccak256(UTF-8)`.
2. `CANONICAL_VERSION=1` di dokumen planning dan prefix runtime `'v1'` berarti hal yang sama. Nilai runtime tidak
   diubah karena prefix ikut di-hash.
3. v1 **beku**: test vector di `canonical.test.ts` tidak boleh diubah agar test hijau. Perubahan format apa pun = v2
   dengan prefix baru, test vector baru, dan review lintas tim (worker, integrity checker, kontrak).

### Konsekuensi

- Semua 16 notarisasi di Sepolia dan hash di DB memakai v1; integrity checker cukup memakai builder v1.
- Test `prefix versi runtime tetap "v1"` dan test vector beku menjaga keputusan ini (CI run 44928137356 ✅).

---

## D-010 — Pencairan bertahap 20/40/60/80/100% (BR-DIS-006)

**Status:** diterima · **Kode:** `packages/shared/src/constants.ts` (`nextTranche`),
`apps/api/src/modules/disbursements/disbursements.service.ts`.

### Konteks

BFD-97 membuat pencairan bertahap (satu milestone terbuka dalam satu waktu), tetapi nominal tiap milestone bebas
diisi pembuat campaign. Product owner meminta pencairan dibatasi per 20% dana terkumpul.

### Keputusan

1. Maksimal **5 tahap**. Tahap ke-n membuka dana sampai **n × 20% dari dana terkumpul** (`currentAmount`), kumulatif.
2. Nominal tahap = `floor(terkumpul × persen / 100) − jumlah pengajuan sebelumnya yang REQUESTED/APPROVED/PAID`.
   Dihitung backend; field `amount` dari klien diterima tapi diabaikan.
3. Pengajuan yang **ditolak tidak memakai tahap**: tahap yang sama bisa diajukan ulang.
4. Basisnya dana **terkumpul**, bukan target. Donasi yang masuk setelah tahap tertentu ikut terbuka di tahap
   berikutnya; tahap ke-5 mengambil seluruh sisa.
5. Bila dana turun (refund) sampai tahap berikutnya bernilai 0 → `DISBURSEMENT_TRANCHE_EMPTY`. Kelima tahap
   terpakai → `DISBURSEMENT_TRANCHES_EXHAUSTED`.

### Konsekuensi

- `GET /campaigns/:id` menambah `funds.nextTranche { step, percent, amount }`; `GET /campaigns/:id/milestones`
  menambah `percent` per tahap dan `maxSteps`.
- Form pencairan di web tidak lagi punya input nominal; nominal tampil otomatis.
- Data seed "Air Bersih" disesuaikan: tahap 1 dan 2 masing-masing Rp270.000 (20% dari Rp1.350.000).
- Pengajuan lama di production yang dibuat sebelum aturan ini tetap dihitung sebagai tahap yang sudah terpakai.

---

## D-011 — Adapter Sakurupiah (BFD-108 – BFD-110, melanjutkan D-002)

**Status:** diterima, **belum diuji ke sandbox** · **Kode:** `apps/api/src/modules/payments/adapters/sakurupiah.adapter.ts`,
test `apps/api/src/sakurupiah.test.ts`. Sumber: https://sakurupiah.id/developers/api-dokumentasi (dibaca 26 Nov 2026).

### Keputusan

1. `PAYMENT_PROVIDER=sakurupiah` memakai `create.php` (QRIS, form-urlencoded, `Authorization: Bearer <api_key>`),
   signature `HMAC-SHA256(api_id + method + merchant_ref + amount, api_key)`. `merchant_ref` = `donation.id`.
2. Callback diverifikasi dengan `X-Callback-Signature = HMAC-SHA256(raw body, api_key)` (perbandingan waktu-konstan),
   dan `X-Callback-Event` harus `payment_status`.
3. Callback tidak membawa nominal. Status `berhasil` dikonfirmasi ulang ke `status-transaction.php` (pakai `trx_id`)
   untuk mengambil nominal yang dibandingkan dengan DB (BR-DON-002).
4. Field `phone` wajib di Sakurupiah, tetapi FundChain tidak menyimpan nomor HP donatur. Dipakai nomor
   merchant dari `SAKURUPIAH_PHONE`. Nama/email donatur tidak dikirim (minim PII).
5. Fee: default `SAKURUPIAH_FEE_BY=merchant` (FundChain menanggung fee, donatur membayar persis nominal donasi).
   `customer` membuat donatur membayar fee di atas nominal; nominal yang dibandingkan memakai `amount`, bukan `total`.
6. Kedaluwarsa: Sakurupiah memakai satuan jam (minimal 1 jam). Batas 15 menit FundChain (D-005) tetap berlaku di DB;
   pembayaran yang masuk setelah itu tetap diterima (`applyEvent` men-settle payment EXPIRED).
7. Sakurupiah tidak punya API pembatalan di dokumentasi, jadi `cancelCharge` tidak diimplementasikan.

### Perlu dicek manusia sebelum production

- Akun merchant + KYC (BFD-107), `SAKURUPIAH_API_ID`/`SAKURUPIAH_API_KEY`, dan URL callback di dashboard.
- Uji sandbox end-to-end (BFD-111): dokumentasi tidak menyebut parameter pasti `status-transaction.php` dan bentuk
  respons errornya. Bila berbeda, sesuaikan `statusByTrx()`.
- Keputusan fee (poin 5) oleh PM/bendahara.

---

## D-012 — Mitra CSR perusahaan (BFD-101, BFD-102)

**Status:** diterima · **Kode:** `apps/api/src/modules/csr/`, `apps/web/src/pages/CsrPage.tsx`,
`apps/web/src/pages/admin/AdminCsrPage.tsx`, migrasi `20261126000000_csr_companies`.

### Keputusan

1. Perusahaan tidak login. Admin mendaftarkan mitra (`POST /admin/csr/companies`); sistem membuat akun pencatat
   role `COMPANY` dengan email sintetis `@fundchain.invalid` dan pseudonim `CSR-…` untuk canonical payload.
2. Dana CSR masuk lewat transfer bank sesuai MoU (bukan QRIS; batas QRIS Sakurupiah Rp2.000.000). Setelah dana diterima,
   admin mencatatnya (`POST /admin/csr/contributions`) dengan nomor referensi transfer/MoU yang unik.
3. Pencatatan memakai jalur settlement yang sama dengan webhook (`PaymentsService.applyEvent`): donasi PAID,
   hash, saldo campaign, antre notarisasi. Kontribusi CSR punya bukti blockchain yang sama dan ikut D-010.
4. Publik: `GET /csr/companies` (halaman `/csr`) dan `GET /campaigns/:id/csr-sponsors` (panel di halaman campaign).

### Perlu manusia

- Template MoU dan proposal kemitraan untuk perusahaan (BFD-102, BizDev).
- Desain final halaman sponsor (BFD-101); halaman saat ini memakai komponen yang sudah ada.
- Rekening penampung dana CSR dan siapa yang berwenang mencatat kontribusi.

---

## D-013 — Pindah dari Sepolia publik ke jaringan privat Binusian (menggantikan sebagian D-008)

**Status:** kode siap, **jaringan belum dibangun** · **Kode:** `apps/api/src/modules/blockchain/blockchain.service.ts`
(`readContractFor`), `contracts/hardhat.config.ts` (network `binusian`), `infra/binusian-chain/`.

### Konteks

Product owner meminta notarisasi pindah dari Sepolia (publik) ke jaringan privat untuk Binusian. Kode lama selalu
membaca bukti dari contract yang sedang dikonfigurasi, jadi setelah pindah, 16+ donasi yang sudah dinotarisasi di
Sepolia akan gagal diverifikasi ("hash tidak ditemukan").

### Keputusan

1. Jaringan privat = Hyperledger Besu QBFT, 4 validator milik BINUS, chainId default 2026, gas price 0.
2. Verifikasi membaca hash dari **chain & contract tempat donasi dinotarisasi** (`blockchain_transactions.chain_id`,
   `contract_address`). Chain lama dibaca lewat `BLOCKCHAIN_READ_RPCS` (Sepolia publik sudah default).
3. Notarisasi baru selalu ke chain aktif. Tidak ada migrasi hash lama: bukti Sepolia tetap sah di Sepolia.
4. Link explorer: `BLOCKCHAIN_EXPLORER_URL` untuk chain aktif; tx Sepolia tetap ke Etherscan. Teks UI diganti
   "block explorer".

### Konsekuensi / perlu manusia

- Siapa yang mengoperasikan validator (BINUS IT?), server, VPN untuk RPC, dan backup kunci validator.
- Trade-off yang harus disetujui: jaringan privat tidak bisa diaudit publik seperti Etherscan; transparansi bergantung
  pada explorer yang dibuka BINUS. Pertimbangkan tetap menulis checkpoint berkala ke chain publik.
- Redeploy contract di jaringan baru dan ganti env production (langkah di `infra/binusian-chain/README.md`).

## D-014 — Repo tetap public walau workflow backup mengunggah dump terenkripsi (QA-001, issue #33)

**Status:** diterima sebagai risiko (27 Nov 2026) · **Kode:** `.github/workflows/backup.yml`, `docs/BACKUP.md`

> **PENTING — wajib ditindaklanjuti bila FundChain dipakai sungguhan (bukan proyek kelas):**
> jadikan repo **private**, atau pindahkan backup ke storage privat lalu hapus semua artifact lama.
> Selama repo public, siapa pun bisa mengunduh dump database (berisi data pribadi donatur) dan
> satu-satunya pengaman adalah `BACKUP_PASSPHRASE`.

### Konteks

Repo `Fundchainbinus/fundchain` public agar bisa dinilai dosen dan diakses anggota tim tanpa undangan. Workflow
`DB backup` mengunggah dump harian sebagai artifact Actions (retensi 14 hari). Dump dienkripsi AES256 (gpg), tetapi
artifact repo public bisa diunduh siapa saja.

### Keputusan

1. Untuk fase proyek kelas, repo tetap public dan backup tetap sebagai artifact.
2. Mitigasi yang dipertahankan: enkripsi gpg, `BACKUP_PASSPHRASE` panjang dan acak (≥ 32 karakter), tidak pernah
   ditulis di repo/log, dan dirotasi bila ada anggota tim yang keluar.
3. Data di production adalah data demo/uji coba mahasiswa, bukan donatur publik.

### Konsekuensi

- Bila passphrase bocor, seluruh backup 14 hari terakhir bisa dibuka.
- Sebelum menerima donasi dari publik: jalankan salah satu opsi di catatan PENTING di atas (lihat issue #33).

## D-015 — Cron tick tetap lewat GitHub Actions walau hanya jalan tiap 5–11 jam (QA-002, issue #34)

**Status:** diterima sebagai risiko (27 Nov 2026), **digantikan oleh D-017** (27 Nov 2026) · **Kode:** `.github/workflows/cron-tick.yml`,
`GET /api/v1/cron/tick` (`integrity.controller.ts`), `NotarizationWorker.tick()` · Memperbarui D-005.

> **PENTING — wajib ditindaklanjuti bila FundChain dipakai sungguhan:** pindahkan pemicu cron ke scheduler
> yang bisa diandalkan (tugas backend: [`docs/tasks/EXTERNAL-SCHEDULER.md`](tasks/EXTERNAL-SCHEDULER.md)).

### Konteks

D-005 mengandalkan `cron-tick.yml` dengan jadwal `*/10 * * * *`. Data GitHub 21–27 Nov 2026: 17 run terjadwal dalam
6 hari, jarak antar-run 5–11 jam. GitHub menunda/melewati schedule pada repo dengan beban rendah; ini perilaku
GitHub, bukan bug kode.

### Keputusan

Untuk fase proyek kelas, jarak 5–11 jam diterima. Sebelum demo, jalankan **Cron tick** manual sekali
(Actions → Cron tick → Run workflow).

### Dampak yang diterima

| Pekerjaan di tick | Yang terjadi bila tick terlambat | Jaring pengaman yang sudah ada |
|---|---|---|
| Expire donasi PENDING > 15 menit | Donasi tetap tampil "Pending" berjam-jam | QR sudah kedaluwarsa di gateway, jadi tidak bisa dibayar; halaman donasi melakukan polling |
| Antrean notarisasi | Hash baru tercatat di chain terlambat | Worker juga dipicu setelah pembayaran lunas, saat halaman donasi polling, dan saat admin retry |
| Campaign lewat deadline → COMPLETED | Status "Berakhir" terlambat sampai beberapa jam | Donasi baru ditolak oleh pengecekan deadline saat membuat donasi |
| Integrity checker berkala | Data yang diubah terdeteksi lebih lambat | Admin bisa verifikasi manual |

## D-016 — Nominal pembayaran tidak cocok → donasi FAILED, dicatat & di-alert sekali (BUG-013, issue #31)

**Status:** diterapkan (27 Nov 2026) · **Kode:** `PaymentsService.applyEvent` (`payments.service.ts`),
test di `payments-flow.test.ts`

### Konteks

Dengan QRIS dinamis, nominal terkunci di QR, jadi donatur tidak bisa membayar nominal lain. Selisih hanya muncul dari
sistem di sekitarnya: pengaturan fee Sakurupiah (`SAKURUPIAH_FEE_BY`) diganti saat masih ada pembayaran PENDING,
perubahan arti field di API gateway, atau dua environment memakai akun merchant yang sama. Sebelumnya pembayaran
seperti ini tetap PENDING, diambil lagi oleh `expireStale` setiap tick, menulis audit berulang, dan 100 baris macet
bisa menutup seluruh antrean.

### Keputusan

1. Payment PENDING/EXPIRED yang dilaporkan SETTLED dengan nominal berbeda → payment & donasi **FAILED**.
2. `PAYMENT_AMOUNT_MISMATCH` ditulis di audit log **sekali** (dalam transaksi yang sama), dan alert dikirim sekali
   (log + `ALERT_WEBHOOK_URL` bila diisi). Notifikasi berikutnya untuk donasi yang sama tidak menulis audit lagi.
3. Saldo campaign tidak bertambah dan tidak ada notarisasi.
4. Bila kemudian gateway melaporkan SETTLED dengan nominal yang benar, donasi tetap diterima (jalur settle biasa).

### Konsekuensi

- Admin harus memeriksa transaksi di dashboard gateway: bila uang benar-benar masuk, selesaikan di luar sistem
  (refund ke donatur, atau minta donatur berdonasi ulang). Belum ada tombol admin untuk ini.
- Donatur melihat donasinya "Failed".

---

## D-017 — Pemicu cron tick: Supabase `pg_cron` + `pg_net` (BFD-128, issue #34)

**Status:** diterapkan (27 Nov 2026) · **Menggantikan:** D-015 · **Memperbarui:** D-005 ·
**Kode:** `apps/api/supabase/cron-scheduler.sql`, `apps/api/src/modules/blockchain/tick-lease.ts`,
`NotarizationWorker.tick()`, migrasi `20261127000100_system_state` · **Runbook:** `docs/infra/CRON-SCHEDULER.md`

### Konteks

`GET /api/v1/cron/tick` harus dipanggil tiap 5–10 menit. GitHub Actions hanya menjalankannya tiap 5–11 jam (D-015)
dan Vercel Cron paket Hobby hanya harian. Opsi yang dibandingkan ada di `docs/tasks/EXTERNAL-SCHEDULER.md`.

### Keputusan

Pemicu utama = **Supabase `pg_cron` + `pg_net`** di project database yang sudah dipakai:

| Job | Jadwal | Isi |
|---|---|---|
| `fundchain-cron-tick` | `*/5 * * * *` | `fundchain_ops.cron_tick()`: GET `/api/v1/cron/tick` dengan `Authorization: Bearer` dari Vault |
| `fundchain-tick-watchdog` | `*/10 * * * *` | `fundchain_ops.tick_watchdog()`: alert Discord bila `last_tick_at` > 30 menit (maks. sekali per jam) |

Alasan dibanding opsi lain:

- **Tanpa vendor & akun baru.** Database sudah di Supabase; tidak menambah pemilik akun yang bisa hilang saat
  anggota tim lulus (bus factor). cron-job.org / QStash / Cloudflare butuh akun terpisah dan menyimpan secret di vendor
  lain. Vercel Pro berbayar (± US$20/bulan per anggota).
- **Secret tidak di repo maupun di tabel.** `CRON_SECRET` disimpan di Supabase Vault (terenkripsi), dibaca oleh fungsi
  `security definer` di schema `fundchain_ops` yang tidak diekspos PostgREST; EXECUTE dicabut dari `anon`/`authenticated`.
- **Riwayat dan status gratis.** `cron.job_run_details` (jalan/tidak) dan `net._http_response` (status HTTP) menjadi
  riwayat scheduler.

Pemicu lain tetap ada sebagai cadangan: `cron-tick.yml` (GitHub, tidak tepat waktu), Vercel Cron harian, dan
`kick()` setelah pembayaran/polling/retry. Semua aman berjalan bersamaan karena **lease lintas instance** (BFD-127):

- `system_state(key='cron_tick')` diklaim dengan `UPDATE … WHERE locked_until IS NULL OR locked_until < now()`;
  hanya satu instance yang mendapat baris. Lease 55 detik (< `maxDuration` 60 dtk), jadi instance yang mati di
  tengah tick melepas lease sendiri. Advisory lock tidak dipakai karena koneksi lewat pooler Supabase tidak menjamin
  sesi yang sama antara lock dan unlock.
- Bagian tick yang tetap bisa tumpang-tindih di jendela ≤ 5 detik setelah lease kedaluwarsa sudah idempoten:
  klaim notarisasi memakai `updateMany` bersyarat + `isNotarized()` + revert `AlreadyNotarized`; `expireStale`,
  `completeExpired`, dan `softDeleteFrozen` adalah UPDATE bersyarat status; integrity checker hanya membaca dan
  menulis status hasil hitungan yang sama.

### Monitoring

- Setiap tick menyimpan `last_tick_at`, durasi total dan per langkah, sumber, dan ok/gagal; durasi juga di-log
  (`Tick cron selesai …ms`).
- `GET /api/v1/health` → `tick.stale` (> 30 menit) untuk uptime monitor apa pun; kartu **Cron tick** di dashboard admin.
- Watchdog di database mengirim alert ke `fundchain_alert_webhook_url` (Vault).

### Kepemilikan & risiko

| Hal | Jawaban |
|---|---|
| Pemilik akun/secret | Project Supabase "Fundchain" (org tim). Tech lead mengisi Vault; anggota org dengan akses owner bisa merotasi |
| Bila pemilik keluar/lulus | Tambahkan minimal satu anggota lain sebagai Owner org Supabase sebelum serah terima; jadwal & fungsi ikut database, tidak terikat akun pribadi |
| Biaya | Rp0 di paket gratis Supabase (pg_cron & pg_net termasuk). Volume 288 tick/hari jauh di bawah batas |
| Scheduler berhenti | Watchdog + `health.tick.stale` + kartu admin. Bila seluruh project di-pause, API juga mati (DB sama) sehingga gejalanya langsung terlihat |
| Paket gratis di-pause setelah 7 hari tanpa aktivitas | Tick tiap 5 menit sendiri sudah menjadi aktivitas database |

### Konsekuensi

- `README.md`: catatan PENTING cron dihapus.
- Durasi p95 tick dan hasil uji alarm dicatat di bawah setelah 24 jam berjalan di production.

### Hasil di production

_Diisi setelah ≥ 24 jam: jarak antar-tick maksimum, p95 `last_tick_ms`, hasil uji alarm._

