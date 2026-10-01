# FundChain

Platform fundraising mahasiswa BINUS dengan **blockchain sebagai immutable proof layer**.
Data operasional ada di database; setiap donasi yang lunas di-hash (Keccak-256) dan hash-nya dicatat di smart contract.
Integrity checker menghitung ulang hash dari database dan membandingkannya dengan hash on-chain. Jika berbeda → `TAMPERED` → campaign `FROZEN` → pencairan dana terkunci.

> **Mode demo tanpa login.** Pengguna dipilih lewat pemilih persona di pojok kanan atas (header `X-Acting-User`). Role tetap ditentukan backend dari database. Untuk produksi, ganti dengan Microsoft SSO BINUS (lihat `docs`/`FundChain_Complete_Planning_Docs`).

## Menjalankan

Butuh **Node 20+**, **pnpm**, dan project **Supabase** (database PostgreSQL).

### 1. Siapkan Supabase

1. Buat project di [supabase.com](https://supabase.com) dan catat password database.
2. Dashboard → **Connect** → tab **ORMs** → **Prisma**. Salin dua connection string ke `apps/api/.env`:
   - `DATABASE_URL` → *Transaction pooler* (port **6543**, dengan `?pgbouncer=true`)
   - `DIRECT_URL` → *Session pooler* (port **5432**), dipakai untuk migrate
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

| Proses | Alamat |
|---|---|
| Hardhat node (blockchain lokal) | `http://127.0.0.1:8545` |
| Deploy `DonationRegistry` | otomatis → `contracts/deployments/localhost.json` |
| API NestJS + worker notarisasi | `http://localhost:3000/api/v1` |
| Web React | **http://localhost:5173** |

Blockchain lokal Hardhat kosong setiap restart. Worker otomatis menotarisasi ulang hash yang **tersimpan saat pembayaran**, sehingga data yang sudah dimanipulasi tetap terdeteksi.

## Skenario demo

1. Pilih **Budi Santoso** → *Campaign Saya* → *Buat campaign* → unggah `samples/proposal-contoh.pdf` → *Ajukan*.
2. Pilih **Admin BINUS** → *Admin → Review campaign* → buka → *Setujui*.
3. Pilih **Siti Rahma** → buka campaign → *Donasi* → *Simulasi bayar berhasil*. Lihat langkahnya: lunas → hash → tx → blok → terverifikasi.
4. Buka *Bukti donasi*: canonical payload, hash, tx hash, dan tombol hitung ulang hash di browser.
5. Manipulasi data langsung di database:
   ```bash
   pnpm demo:tamper --latest 900000
   ```
6. Admin → *Integritas* → *Verifikasi semua donasi* → **TAMPERED** → campaign **FROZEN**.
7. Budi coba *Ajukan pencairan* → ditolak `CAMPAIGN_FROZEN`.

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

| Dokumen | Implementasi | Alasan |
|---|---|---|
| PostgreSQL | PostgreSQL di Supabase (Prisma, pooler + direct URL) | Sesuai rencana deploy; RLS aktif di semua tabel |
| Redis + BullMQ | Tabel `blockchain_transactions` sebagai antrean (outbox) + worker polling | Tanpa Redis; retry/backoff/FAILED tetap sesuai spec |
| Microsoft SSO | Persona switcher (`DEMO_MODE`) | Permintaan: tanpa login |
| Midtrans | `mock` (default) + adapter `pakasir` | Sesuai keputusan Pakasir + Mock |
| Worker app terpisah | Worker di dalam proses API | Satu perintah untuk jalan |

## Konfigurasi

Salin `apps/api/.env.example` → `apps/api/.env` (sudah dibuat). Variabel penting:

- `PAYMENT_PROVIDER=mock|pakasir`, `PAKASIR_PROJECT`, `PAKASIR_API_KEY`. Webhook diarahkan ke `POST /api/v1/webhooks/payment`.
- `BLOCKCHAIN_NETWORK`, `BLOCKCHAIN_RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`, `RELAYER_PRIVATE_KEY`, `BLOCKCHAIN_CONFIRMATIONS`.
- `DEMO_MODE`, `ENABLE_DEV_TOOLS`: **matikan di produksi.**

### Pindah ke Sepolia

1. Isi `contracts/.env` (`DEPLOYER_PRIVATE_KEY` = wallet admin, `RELAYER_ADDRESS` = wallet lain), lalu jalankan `pnpm --filter @fundchain/contracts deploy:sepolia`.
2. Di `apps/api/.env`: `BLOCKCHAIN_NETWORK=sepolia`, `CHAIN_ID=11155111`, `BLOCKCHAIN_RPC_URL=<rpc sepolia>`, `RELAYER_PRIVATE_KEY=<kunci relayer>`, `BLOCKCHAIN_CONFIRMATIONS=2`.
3. Isi relayer dengan Sepolia ETH dari faucet. Link Etherscan otomatis muncul di UI.

## Test

```bash
pnpm test
```

Mencakup: canonical hash (deterministik & avalanche), smart contract (9 test), state machine, aturan pencairan, dan signature webhook.
