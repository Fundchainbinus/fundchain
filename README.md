# FundChain

Platform fundraising mahasiswa BINUS dengan **blockchain sebagai immutable proof layer**.
Data operasional ada di database; setiap donasi yang lunas di-hash (Keccak-256) dan hash-nya dicatat di smart contract.
Integrity checker menghitung ulang hash dari database dan membandingkannya dengan hash on-chain. Jika berbeda → `TAMPERED` → campaign `FROZEN` → pencairan dana terkunci.

> **Mode demo tanpa login.** Pengguna dipilih lewat pemilih persona di pojok kanan atas (header `X-Acting-User`). Role tetap ditentukan backend dari database. Untuk produksi, ganti dengan Microsoft SSO BINUS (lihat `docs`/`FundChain_Complete_Planning_Docs`).

## Menjalankan

Butuh **Node 20+** dan **pnpm**. `apps/api/.env` **tidak ada di repo** (berisi password database) — setelah clone, pilih salah satu cara di bawah.

### Cara A — Hanya frontend (paling cepat, tanpa `.env`)

Web lokal memakai API production (`fundchain-api.vercel.app`). Cocok untuk mengerjakan tampilan.

```bash
pnpm install
```

Command ini juga membangun package `@fundchain/shared` dan membuat Prisma Client dari
`apps/api/prisma/schema.prisma`. Jika editor masih menampilkan tipe Prisma yang hilang
setelah berpindah branch atau mengubah schema, jalankan ulang:

```bash
pnpm prisma:generate
```

```bash
pnpm dev:web:remote
```

Buka http://localhost:5173. Data yang dibuat masuk ke database production.

### Cara B — Full stack (API + blockchain lokal)

1. Salin `apps/api/.env.example` menjadi `apps/api/.env`.
2. Isi `DATABASE_URL` dan `DIRECT_URL` (minta ke pemilik project, atau pakai project Supabase sendiri — langkah di bawah).
3. Jalankan `pnpm install`, `pnpm bootstrap`, lalu `pnpm dev`.

`pnpm bootstrap` selalu membuat ulang Prisma Client sebelum menjalankan migration dan
seed, sehingga tipe generated tetap sinkron dengan schema project.

Kalau `.env` belum diisi, API berhenti dengan pesan yang menjelaskan langkahnya. Gejalanya di web: "Tidak dapat terhubung ke server".

File upload (proposal & bukti pencairan) **hanya** disimpan di database (tabel `stored_files`) — tidak ada file di laptop, jadi semua orang dan Vercel melihat file yang sama. Pernah mengunggah dengan versi lama (file tertinggal di `apps/api/uploads`)? Jalankan `pnpm --filter @fundchain/api files:sync` di laptop tersebut.

### 1. Siapkan Supabase (untuk Cara B)

1. Buat project di [supabase.com](https://supabase.com) dan catat password database.
2. Dashboard → **Connect** → tab **ORMs** → **Prisma**. Salin dua connection string ke `apps/api/.env`:
   - `DATABASE_URL` → _Transaction pooler_ (port **6543**, dengan `?pgbouncer=true`)
   - `DIRECT_URL` → _Session pooler_ (port **5432**), dipakai untuk migrate
3. Password yang mengandung karakter khusus (`@ # / ?`) harus di-URL-encode.

Migration otomatis mengaktifkan **Row Level Security** di semua tabel. Data tidak bisa diakses lewat REST API Supabase memakai anon key; hanya backend (role postgres) yang bisa.

### 2. Install, migrate, jalankan

```bash
pnpm install
```

```bash
pnpm bootstrap
```

```bash
pnpm dev
```

`pnpm bootstrap` menjalankan migration ke Supabase dan mengisi data seed. Aman diulang: seed dilewati kalau campaign sudah ada. `pnpm dev` menjalankan sekaligus:

| Proses                          | Alamat                                            |
| ------------------------------- | ------------------------------------------------- |
| Hardhat node (blockchain lokal) | `http://127.0.0.1:8545`                           |
| Deploy `DonationRegistry`       | otomatis → `contracts/deployments/localhost.json` |
| API NestJS + worker notarisasi  | `http://localhost:3000/api/v1`                    |
| Web React                       | **http://localhost:5173**                         |

Blockchain lokal Hardhat kosong setiap restart. Worker otomatis menotarisasi ulang hash yang **tersimpan saat pembayaran**, sehingga data yang sudah dimanipulasi tetap terdeteksi.

### 3. Set Up Prisma (Optional / kalau error aja)

Buat yang baru clone terus udah jalanin semua step di atas tapi masih error karena koneksi API, bisa aja karena prisma belum ke install, caranya buka cmd di folder besar fundchain, lalu :

```bash
cd apps/api
```

```bash
pnpm prisma generate
```

setelah install, balik lagi ke folder besar fundchain dan jalan `pnpm dev` disana

## Skenario demo

1. Pilih **Budi Santoso** → _Campaign Saya_ → _Buat campaign_ → unggah `samples/proposal-contoh.pdf` → _Ajukan_.
2. Pilih **Admin BINUS** → _Admin → Review campaign_ → buka → _Setujui_.
3. Pilih **Siti Rahma** → buka campaign → _Donasi_ → _Simulasi bayar berhasil_. Lihat langkahnya: lunas → hash → tx → blok → terverifikasi.
4. Buka _Bukti donasi_: canonical payload, hash, tx hash, dan tombol hitung ulang hash di browser.
5. Manipulasi data langsung di database:
   ```bash
   pnpm demo:tamper --latest 900000
   ```
6. Admin → _Integritas_ → _Verifikasi semua donasi_ → **TAMPERED** → campaign **FROZEN**.
7. Budi coba _Ajukan pencairan_ → ditolak `CAMPAIGN_FROZEN`.

## Struktur

```
apps/api          NestJS + Prisma (PostgreSQL Supabase) + worker notarisasi in-process
apps/web          React + Vite + Tailwind + React Query
packages/shared   canonical payload & hash (sumber tunggal), konstanta, ABI, error codes
contracts         Hardhat + DonationRegistry.sol (AccessControl, admin ≠ relayer)
samples           PDF contoh untuk upload
FundChain_Complete_Planning_Docs   dokumen perencanaan (PRD, API spec, dll.)
```

## Keputusan implementasi vs dokumen planning

| Dokumen             | Implementasi                                                              | Alasan                                              |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| PostgreSQL          | PostgreSQL di Supabase (Prisma, pooler + direct URL)                      | Sesuai rencana deploy; RLS aktif di semua tabel     |
| Redis + BullMQ      | Tabel `blockchain_transactions` sebagai antrean (outbox) + worker polling | Tanpa Redis; retry/backoff/FAILED tetap sesuai spec |
| Microsoft SSO       | Persona switcher (`DEMO_MODE`)                                            | Permintaan: tanpa login                             |
| Midtrans            | `mock` (default) + adapter `sakurupiah` (QRIS, belum diuji ke sandbox) + `pakasir` (deprecated) | Keputusan tim; detail di [D-002](docs/DECISIONS.md#d-002--payment-gateway-pakasir--sakurupiah-bfd-107--bfd-111) |
| Worker app terpisah | Worker di dalam proses API                                                | Satu perintah untuk jalan                           |
| Refund (BFD-75)     | Manual oleh admin (wajib alasan), hanya donasi PAID di campaign FROZEN; status REFUNDED + audit, hash & catatan on-chain tidak diubah; uang dikembalikan di luar sistem | Bukti on-chain permanen; Pakasir tidak punya API refund. Detail di [D-001](docs/DECISIONS.md#d-001--kebijakan-refund-donasi-bfd-75) |
| RLS (BFD-23)        | RLS deny-all di semua tabel tanpa policy; akses hanya lewat Prisma (role owner), kontrol akses di service; dijaga `rls.test.ts` | Tidak ada akses Supabase/PostgREST dari browser. Ditinjau ulang kalau itu berubah. Detail di [D-003](docs/DECISIONS.md#d-003--rls-deny-all-tetap-dipakai-bfd-23) |
| Envelope `{ data, meta }` (BFD-40) | Tetap `{ success, data }` / `{ success: false, error }`; cursor list (`nextCursor`) di dalam `data` | Frontend sudah bergantung pada bentuk ini. Detail di [D-004](docs/DECISIONS.md#d-004--envelope-response-tetap--success-data--bfd-40) |
| Expiry donasi 30 menit (BFD-22) | 15 menit (= masa berlaku QR); GitHub Actions `cron-tick.yml` memanggil `/api/v1/cron/tick` tiap 10 menit | Vercel Cron Hobby hanya harian. Detail di [D-005](docs/DECISIONS.md#d-005--expiry-donasi-15-menit--github-actions-cron-tiap-10-menit-bfd-22) |
| Login Google via Passport redirect (BFD-10) | GIS popup (token client) di web + `POST /auth/google` memverifikasi access token ke Google | Tanpa state/callback di server, cocok untuk serverless. Detail di [D-006](docs/DECISIONS.md#d-006--login-google-gis-popup--verifikasi-token-di-post-authgoogle-bfd-10) |
| `refund()` di PaymentGateway (BFD-19, BFD-108) | Tidak ada; refund manual sesuai D-001 | API refund Sakurupiah belum diketahui; ditinjau ulang setelahnya. Detail di [D-007](docs/DECISIONS.md#d-007--paymentgateway-tanpa-refund-bfd-19-bfd-108) |
| Backup (BFD-25)     | GitHub Actions harian 02:00 WIB: `pg_dump` terenkripsi GPG (artifact 14 hari) + uji restore otomatis | Tanpa infrastruktur tambahan. Detail di [docs/BACKUP.md](docs/BACKUP.md) |

Log keputusan lengkap: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Konfigurasi

Salin `apps/api/.env.example` → `apps/api/.env` (file ini tidak di-commit). Variabel penting:

- `PAYMENT_PROVIDER=mock|sakurupiah|pakasir`. Sakurupiah: `SAKURUPIAH_API_ID`, `SAKURUPIAH_API_KEY`, `SAKURUPIAH_SANDBOX`, `SAKURUPIAH_CALLBACK_URL`, `SAKURUPIAH_PHONE` (lihat `apps/api/.env.example` dan D-011). Webhook diarahkan ke `POST /api/v1/webhooks/payment`.
- `BLOCKCHAIN_NETWORK`, `BLOCKCHAIN_RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`, `RELAYER_PRIVATE_KEY`, `BLOCKCHAIN_CONFIRMATIONS`.
- `DEMO_MODE`, `ENABLE_DEV_TOOLS`: **matikan di produksi.**

### Pindah ke Sepolia

1. Isi `contracts/.env` (`DEPLOYER_PRIVATE_KEY` = wallet admin, `RELAYER_ADDRESS` = wallet lain), lalu jalankan `pnpm --filter @fundchain/contracts deploy:sepolia`.
2. Di `apps/api/.env`: `BLOCKCHAIN_NETWORK=sepolia`, `CHAIN_ID=11155111`, `BLOCKCHAIN_RPC_URL=<rpc sepolia>`, `RELAYER_PRIVATE_KEY=<kunci relayer>`, `BLOCKCHAIN_CONFIRMATIONS=2`.
3. Isi relayer dengan Sepolia ETH dari faucet. Link Etherscan otomatis muncul di UI.

## Kontribusi & Jira

Repo ini terhubung ke Jira (`fundchain.atlassian.net`, project **BFD**) lewat GitHub for Atlassian. Branch, commit, dan PR otomatis muncul di panel _Development_ issue Jira **kalau ada key issue-nya** (`BFD-<nomor>`, huruf besar):

| Tempat   | Contoh                                          |
| -------- | ----------------------------------------------- |
| Branch   | `feat/BFD-56-campaign-filter`                   |
| Commit   | `BFD-56 feat(web): filter campaign berdasar SDG` |
| Judul PR | `BFD-56 feat(web): filter campaign berdasar SDG` |

Satu PR bisa menyebut beberapa key (`BFD-56 BFD-57 ...`). Kalau lupa, cukup edit judul PR-nya; Jira akan menautkan ulang.

## Test

```bash
pnpm test
```

Mencakup: canonical hash (deterministik & avalanche), smart contract (9 test), state machine, aturan pencairan, dan signature webhook. Guard skema: `rls.test.ts` (setiap tabel di migrasi wajib RLS, lihat D-003) dan `perf.test.ts` (setiap `@@index` punya `CREATE INDEX` di migrasi, query hot path dibatasi).

### QA

Dokumen QA (test matrix, risk register, integration contract, bug triage, fallback plan, metrics, release
readiness) ada di [`docs/qa/`](docs/qa/README.md). Bug terbuka dilacak sebagai GitHub Issues berlabel
[`qa-triage`](https://github.com/Fundchainbinus/fundchain/issues?q=label%3Aqa-triage) dengan severity S1–S4.

## Deploy (Vercel)

Live: **https://fundchain-web.vercel.app** (web) · **https://fundchain-api.vercel.app/api/v1** (API)

Dua project Vercel dari repo yang sama:

| Project         | Root Directory | Isi                                                                                                 |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `fundchain-web` | `apps/web`     | Static Vite; `/api/*` di-proxy ke `fundchain-api` (same-origin)                                     |
| `fundchain-api` | `apps/api`     | NestJS sebagai Vercel Function (`api/index.js` → `src/serverless.ts`), region `sin1` dekat Supabase |

Perbedaan mode serverless (diatur lewat env di project `fundchain-api`):

- `WORKER_MODE=on-demand`: tidak ada polling. Worker notarisasi dipicu setelah pembayaran lunas, saat halaman donasi melakukan polling, saat admin retry, oleh GitHub Actions `cron-tick.yml` tiap 10 menit (juga meng-expire donasi PENDING > 15 menit), dan oleh Vercel Cron harian sebagai cadangan (`/api/v1/cron/tick`). Workflow GitHub butuh secret repo `CRON_SECRET` yang sama dengan `CRON_SECRET` di Vercel (D-005).
- Upload disimpan di tabel `stored_files` (disk Vercel tidak permanen). Batas upload 4MB (batas body request Vercel 4,5MB).
- Blockchain: Sepolia (`BLOCKCHAIN_NETWORK=sepolia`, `CHAIN_ID=11155111`, `RELAYER_PRIVATE_KEY`, `CONTRACT_ADDRESS`).

Deploy ulang dari root repo:

```bash
vercel deploy --prod --project fundchain-api
```

```bash
vercel deploy --prod --project fundchain-web
```
