# FundChain — Execution Plan

Rencana eksekusi pembuatan FundChain dari nol sampai siap demo, disusun dari 26 dokumen planning di folder ini.

**Ringkasan produk:** platform fundraising mahasiswa BINUS. Data operasional di PostgreSQL, uang lewat payment gateway (QRIS/VA), dan blockchain (Sepolia) cuma menyimpan **hash Keccak-256** tiap donasi `PAID` sebagai bukti yang gak bisa diubah. Integrity checker menghitung ulang hash dari DB lalu membandingkannya dengan hash on-chain. Kalau beda → `TAMPERED` → campaign `FROZEN` → pencairan dana terkunci.

> **Update keputusan:** dikerjakan **solo dalam ≤3 minggu**, **SSO BINUS belum ada akses** (pakai Dev Login dulu), **payment pakai Pakasir + Mock** (bukan Midtrans; D10 diganti). Pakasir hanya mendukung QRIS dan webhook-nya diverifikasi dengan HMAC-SHA256. Response donasi berisi `qrString/paymentUrl/expiresAt`, bukan `snapToken`. Jadwal 21 hari ada di bagian **6. Jadwal Solo 3 Minggu** di akhir file ini.

**Strategi:** bangun per *vertical slice* (fitur jalan end-to-end dulu, baru dipoles). Semua integrasi eksternal (SSO, payment, blockchain) dibuat **di belakang adapter yang bisa di-mock**, supaya development dan demo gak bergantung ke pihak ketiga.

---

## 0. Keputusan & Perbaikan Spec (WAJIB sebelum coding)

Selama membaca dokumen, saya menemukan beberapa inkonsistensi dan celah. Semuanya perlu diputuskan dulu karena berdampak ke schema DB dan smart contract, yang mahal diubah belakangan.

| # | Masalah di dokumen | Keputusan yang direkomendasikan |
|---|---|---|
| D1 | Format canonical payload beda: `11-BLOCKCHAIN-SPEC` tanpa versi, `BLOCKCHAIN FLOW` pakai `v1\|...` | Pakai **`v1\|donationId\|integritySubjectId\|amount\|timestamp`** |
| D2 | `integritySubjectId` (contoh `STU-00042`) gak ada di schema | Tambah `users.integrity_subject_id` (UK, auto-generate `STU-xxxxx` saat user dibuat) |
| D3 | `donationIdBytes32 = keccak256(uuid)` itu satu arah, tapi `SMART CONTRACT SPEC §12` memanggil `fromBytes32ToUuid()` (mustahil) | Simpan `blockchain_transactions.onchain_key` (bytes32 hex). Worker langsung update DB setelah `tx.wait(2)`, **tanpa event listener** (lebih simpel & andal) |
| D4 | Constructor contract di `SMART CONTRACT DEV SETUP` grant `RELAYER_ROLE` ke admin, padahal spec bilang relayer ≠ admin | Constructor jadi `constructor(address admin, address relayer)` |
| D5 | Webhook membandingkan `payment.amount`, padahal tabel `payments` gak punya kolom amount | Tambah `payments.amount` (gross amount yang dikirim ke gateway) |
| D6 | Idempotency webhook pakai `transaction_id`, tapi di Midtrans Snap `transaction_id` belum ada saat charge dibuat | Lookup by **`order_id` = donation.id**; `external_payment_id` diisi saat webhook datang |
| D7 | Header `Idempotency-Key` di POST donation gak punya tempat disimpan | Tambah `donations.idempotency_key` (UK) |
| D8 | Flag `anonymous` di API gak ada di schema | Tambah `donations.is_anonymous` |
| D9 | Timestamp canonical harus stabil | Pakai `donations.donated_at` (= waktu settle), disimpan sekali, **tidak pernah dihitung ulang dari `now()`** |
| D10 | Payment gateway: Tech Spec bilang Midtrans, Payment Research bilang Pakasir | **Midtrans Sandbox** untuk MVP (QRIS + VA, sandbox lengkap, response API sudah pakai `snapToken`). Tambah **`MockPaymentAdapter`** untuk local/demo cadangan. Pakasir opsional nanti |
| D11 | Disbursement: API minta `description`, schema gak punya; aturan eligibility gak didefinisikan | Tambah `disbursements.description`. Eligible = campaign `ACTIVE`/`COMPLETED`, bukan `FROZEN`, dan `amount ≤ currentAmount − Σ(disbursement APPROVED/PAID)` |
| D12 | Status `COMPLETED` gak punya transisi | Cron harian: `ACTIVE` + deadline lewat → `COMPLETED` |
| D13 | Role matrix bilang admin bisa unfreeze, tapi endpoint-nya gak ada | Tambah `POST /admin/campaigns/:id/unfreeze` (wajib `reason`, masuk audit) |
| D14 | Upload bukti disbursement gak punya endpoint | Reuse storage module: `POST /campaigns/:id/disbursement/proof` → return `proofUrl` |
| D15 | Router frontend menaruh katalog di balik login, padahal API `GET /campaigns` public | Katalog, detail campaign, dan halaman transparansi **public** (lebih kuat untuk demo transparansi) |
| D16 | Health endpoint: `/health` vs `/api/v1/health` | Pakai `/api/v1/health` |
| D17 | Tamper simulation butuh cara mengubah data DB | Script CLI `pnpm demo:tamper <donationId> <amount>` (langsung ke DB, **bukan** endpoint API) |
| D18 | **Risiko besar:** register app di tenant Azure BINUS butuh admin consent dari IT BINUS | Siapkan dari hari pertama: (a) ajukan ke IT BINUS secepatnya, (b) **`DevLoginAdapter`** (pilih user seed) yang hanya aktif saat `AUTH_DEV_LOGIN=true`, (c) opsional test OIDC pakai tenant Azure pribadi |
| D19 | Versi library di dokumen versi lama (Tailwind `init -p` = v3, Hardhat toolbox = v2, Prisma tanpa `prisma.config.ts`) | **Pin major version** sesuai dokumen: Tailwind 3, Hardhat 2, Prisma 6, ethers 6, NestJS 10/11 |

---

## 1. Fase Eksekusi

Estimasi diasumsikan 1–2 developer full-time. Fase yang ditandai ⇄ bisa jalan paralel.

### Fase 1 — Fondasi Monorepo & Infra (±1–2 hari)

- [ ] `git init`, struktur monorepo sesuai `REPOSITORY SETUP.md` (`apps/{web,api,worker}`, `packages/{types,shared,blockchain-client}`, `contracts`, `infra`, `docs`)
- [ ] Pindahkan folder dokumen ini ke `docs/`
- [ ] `pnpm-workspace.yaml`, root `package.json`, `.gitignore`, `.editorconfig`, `.nvmrc`, `.vscode/`
- [ ] `infra/docker-compose.yml` (Postgres 16 + Redis 7) dan `infra/.env.example`
- [ ] ESLint + Prettier + `tsconfig.base.json`
- [ ] `packages/shared`: `ErrorCode` enum (registry di `API SPEC DETAIL §9`), daftar 17 SDG, limit (amount 10rb–1M, file 5MB)
- [ ] `packages/types`: entity & enum (mirror enum Prisma)
- [ ] GitHub Actions CI: lint → typecheck → test (`REPOSITORY SETUP §7`)

**Done:** `docker compose up` sehat, `pnpm install` & `pnpm lint` jalan di root, CI hijau.

### Fase 2 — Smart Contract ⇄ (±2 hari, bisa paralel dengan Fase 3)

- [ ] Init Hardhat 2 (TypeScript) di `contracts/`
- [ ] `DonationRegistry.sol`: AccessControl, `notarize`, `verify`, `getRecord`, `isNotarized`, custom errors (`AlreadyNotarized`, `ZeroHash`), constructor `(admin, relayer)` (D4)
- [ ] Unit test: success, duplicate revert, zero-hash revert, non-relayer revert, verify return `bytes32(0)` kalau belum ada, fuzz
- [ ] `scripts/deploy.ts` + `scripts/smoke.ts` (notarize + verify)
- [ ] Deploy ke `hardhat node` lokal → lalu Sepolia → verify di Etherscan → catat address
- [ ] Export ABI ke `packages/blockchain-client/abi.ts`
- [ ] `packages/blockchain-client/canonical.ts`: `buildCanonicalPayload()`, `hashPayload()`, `toOnchainKey()` + unit test determinisme (input sama = hash sama, 1 char beda = hash beda)

**Done:** coverage contract ~100%, contract ada di Sepolia, relayer wallet terpisah & sudah di-fund ≥ 0.1 ETH.

### Fase 3 — Backend Core (±3 hari)

- [ ] Bootstrap NestJS di `apps/api` (`BACKEND PROJECT INIT.md`)
- [ ] `schema.prisma` lengkap sesuai `DATABASE SCHEMA.MD` + tambahan dari D2, D3, D5, D7, D8, D11, plus indexes
- [ ] Migration awal + `seed.ts` idempotent (admin, 2–3 student, campaign di berbagai status, donasi demo)
- [ ] `common/`: `ResponseInterceptor`, `AllExceptionsFilter`, `AppError`, env validation (zod/joi), `PrismaService`
- [ ] Security baseline: `helmet`, CORS ke `WEB_URL`, `@nestjs/throttler`, cookie-parser
- [ ] **Auth module:**
  - OIDC Microsoft via `openid-client` (state + nonce, verifikasi iss/aud/exp, `preferred_username`, domain `@binus.ac.id`)
  - Session JWT di cookie httpOnly `fundchain_session` (8 jam)
  - Role dari `ADMIN_EMAILS`, hanya di-set saat user dibuat
  - `DevLoginAdapter` (D18), dikunci env
  - `JwtAuthGuard`, `RolesGuard`, `@Roles()`, `@CurrentUser()`
- [ ] **Audit module:** `AuditService.log(actor, action, entity, metadata, ip)`, dipakai semua modul
- [ ] `GET /api/v1/health`

**Done:** login (dev login + SSO kalau tenant sudah siap) → cookie → `/auth/me` return user + role; non-BINUS ditolak 401; admin endpoint menolak student 403.

### Fase 4 — Campaign, Storage & Review (±2–3 hari)

- [ ] **Storage module:** interface `StorageAdapter` → `LocalDiskAdapter` (dev) + `SupabaseAdapter` (staging/prod). Validasi PDF (magic bytes + MIME + ekstensi), max 5MB, nama file random, signed URL untuk baca
- [ ] **Campaigns:** CRUD + state machine terpusat (`campaign-status.ts`): `DRAFT → PENDING_REVIEW → ACTIVE/REJECTED`, `REJECTED → PENDING_REVIEW`, `ACTIVE → FROZEN/COMPLETED`, `FROZEN → ACTIVE` (unfreeze)
  - Ownership check di setiap update; edit hanya saat DRAFT/REJECTED
  - Submit wajib proposal ada + deadline masih di masa depan (BR-CAM-003/004)
  - List dengan filter `status`, `sdg`, `q` + cursor pagination
- [ ] **Reviews (admin):** pending queue, detail, approve, reject (reason min 10) → `campaign_reviews` + audit log
- [ ] Cron `COMPLETED` (D12)

**Done:** alur create → upload → submit → approve/reject → revise → resubmit jalan via API, semua transisi ilegal return `409 CAMPAIGN_INVALID_STATUS`.

### Fase 5 — Donation & Payment (±3 hari)

- [ ] Interface `PaymentGateway` (`PAYMENT GATEWAY RESEARCH §2`) → `MidtransAdapter` (Snap: QRIS + VA) + `MockPaymentAdapter` (D10); dipilih lewat `PAYMENT_PROVIDER`
- [ ] `POST /campaigns/:id/donations`: wajib `Idempotency-Key`, campaign harus `ACTIVE`, amount 10.000–1.000.000.000; buat Donation(PENDING) + Payment(PENDING) dalam 1 transaksi DB → `createCharge`
- [ ] `POST /webhooks/payment`:
  1. Verifikasi signature (sha512, `timingSafeEqual`)
  2. Lookup by `order_id` (D6) → kalau sudah SETTLED return 200 `replayed`
  3. Validasi amount vs DB
  4. Dalam 1 transaksi DB: Donation → PAID + `donated_at`, Payment → SETTLED, `campaign.current_amount += amount` (atomic increment), audit log
  5. Setelah commit: build canonical payload + hash → simpan → enqueue `blockchain-notarize`
  6. Mapping status `deny/cancel/expire` → FAILED/EXPIRED
- [ ] Mock webhook trigger (dev only): `POST /dev/payments/:donationId/settle` yang memanggil handler yang sama dengan signature valid
- [ ] `GET /donations/:id` (untuk polling status dari frontend), `GET /campaigns/:id/donations` (donor dipseudonimkan / anonim)
- [ ] Setup ngrok + webhook URL di dashboard Midtrans sandbox

**Done:** donasi sandbox QRIS sukses → PAID; webhook duplikat gak menambah saldo dua kali; signature palsu → 401; amount beda → 400.

### Fase 6 — Blockchain Notarization (±2–3 hari)

- [ ] BullMQ queue `blockchain-notarize` di API (producer); `attempts: 5`, backoff exponential 2s
- [ ] `apps/worker` (NestJS standalone, tanpa HTTP):
  - Validasi `CHAIN_ID === 11155111` dan `CONTRACT_ADDRESS` saat boot
  - Proses job: buat/ambil `blockchain_transactions` (QUEUED) → `notarize()` → SUBMITTED + `tx_hash` → `tx.wait(2)` → CONFIRMED + `block_number` + `confirmed_at`
  - Error handling per tabel `BLOCKCHAIN FLOW §7`: `AlreadyNotarized` = sukses, `ZeroHash` = FAILED, RPC/nonce = RETRYING, attempt habis = FAILED + audit `BLOCKCHAIN_NOTARIZE_FAILED`
  - Invariant: **status PAID tidak pernah disentuh worker**
- [ ] `GET /donations/:id/blockchain` (status + txHash + explorer URL)
- [ ] Bull Board di `/admin/queues` (admin only)
- [ ] Admin endpoint retry manual untuk transaksi FAILED
- [ ] Alert sederhana (log + audit) kalau saldo relayer < 0.02 ETH

**Done:** donasi PAID → dalam ~1 menit muncul txHash yang bisa dibuka di Sepolia Etherscan; matikan RPC → job RETRYING → nyalakan lagi → CONFIRMED.

### Fase 7 — Integrity, Freeze & Disbursement (±2–3 hari)

- [ ] **Integrity:** `POST /admin/donations/:id/verify` (rate limit 10/menit) → rebuild payload dari data DB **saat ini** → `currentHash` vs `verify()` on-chain
  - Match → `VERIFIED`
  - Mismatch → dalam 1 transaksi: donation `TAMPERED`, campaign `FROZEN`, audit log → response `campaignFrozen: true`
  - Belum dinotarisasi → `400 BLOCKCHAIN_NOT_NOTARIZED`
- [ ] Verify per campaign (cek semua donasi PAID) + cron mingguan
- [ ] Endpoint verify terbatas untuk creator (role matrix: "Limited") — read-only, tanpa side-effect freeze
- [ ] Unfreeze (D13)
- [ ] **Disbursement:** upload bukti (D14) → request (owner only, cek eligibility D11) → admin approve/reject → mark PAID (manual, proses dana kampus). `FROZEN` → `409 CAMPAIGN_FROZEN`
- [ ] `GET /admin/audit-logs` dengan filter + cursor
- [ ] Script `pnpm demo:tamper` (D17)

**Done:** skenario tamper `Rp100.000 → Rp900.000` → TAMPERED → FROZEN → request disbursement ditolak.

### Fase 8 — Frontend ⇄ (±5–7 hari, mulai paralel sejak Fase 3 dengan mock data)

Setup sesuai `FRONTEND PROJECT INIT.md` (Vite + React + TS + Tailwind 3 + React Router + React Query + RHF + Zod + Zustand). Warna utama navy BINUS `#003D7C`.

**Halaman public**
- [ ] Landing (penjelasan singkat + campaign unggulan)
- [ ] Login (tombol "Login with Microsoft BINUS" + dev login kalau aktif)
- [ ] Katalog campaign (filter SDG, search, progress bar)
- [ ] Detail campaign (progress, deadline, proposal, daftar donasi dengan badge `VERIFIED/PENDING/TAMPERED` + link Etherscan, banner kalau `FROZEN`)
- [ ] Halaman bukti donasi `/donations/:id/proof` (payload, hash, txHash, block, status integritas). Ini halaman kunci untuk juri

**Halaman student**
- [ ] Dashboard (ringkasan campaign & donasi saya)
- [ ] Form create/edit campaign + upload PDF (RHF + Zod, validasi sama dengan backend)
- [ ] My Campaigns (status, alasan reject, tombol revisi & submit ulang)
- [ ] Alur donasi: pilih nominal → Snap popup / QR → halaman status (polling 3 detik) → PAID → status blockchain live
- [ ] Riwayat donasi saya
- [ ] Request disbursement (upload bukti, nominal, deskripsi) + statusnya

**Halaman admin**
- [ ] Admin dashboard (jumlah pending, total dana, campaign frozen, job blockchain gagal)
- [ ] Review queue + detail (PDF viewer, approve / reject dengan alasan)
- [ ] Integrity checker (pilih campaign/donasi → Verify → tampilkan perbandingan hash; TAMPERED tampil merah mencolok)
- [ ] Frozen campaigns + unfreeze
- [ ] Disbursement queue (approve / reject / mark paid)
- [ ] Audit log viewer (filter)

**Komponen umum:** Layout (TopNav + Sidebar sesuai role), `ProtectedRoute`, `AdminRoute`, `ErrorBoundary`, `StatusBadge`, `HashDisplay` (truncate + copy), `ExplorerLink`, format Rupiah, toast, empty/loading state, responsive mobile.

**Done:** seluruh E2E di `12-TESTING-PLAN` bisa diklik dari UI tanpa Postman.

### Fase 9 — Testing & Hardening (±3 hari, sebagian dikerjakan bersamaan tiap fase)

- [ ] Unit test (Jest) semua item di `12-TESTING-PLAN` (auth, campaign, donation, payment, blockchain, integrity, disbursement)
- [ ] Integration test dengan Postgres + Redis nyata (CI services) + Hardhat node untuk blockchain
- [ ] E2E Playwright: alur utama + skenario tamper
- [ ] Security test: IDOR (akses donasi/campaign orang lain), student ke admin endpoint, webhook palsu & duplikat, upload file non-PDF / PDF palsu / >5MB, rate limit, cek tidak ada secret di bundle frontend (`grep` build output untuk `PRIVATE_KEY`, `SERVER_KEY`)

### Fase 10 — Deployment & Persiapan Demo (±2–3 hari)

- [ ] Staging: Web → Vercel, API + Worker → Railway/Render, Postgres + Storage → Supabase, Redis → Upstash/Railway
- [ ] Secrets di dashboard hosting (bukan file), relayer wallet & DB terpisah untuk demo
- [ ] Redirect URI SSO + webhook URL Midtrans diarahkan ke domain staging
- [ ] Seed data demo yang realistis (beberapa campaign SDG, donasi yang sudah VERIFIED)
- [ ] Jalankan **Final Demo Checklist** (`10-DEPLOYMENT-PLAN §9`)
- [ ] Rehearsal demo sesuai `13-DEMO-FLOW.md` minimal 3×, dengan fallback: dev login (kalau SSO bermasalah), mock payment (kalau sandbox lambat), video rekaman cadangan
- [ ] README root: cara setup, arsitektur, contract address, link Etherscan

---

## 2. Urutan & Paralelisasi

```text
Minggu 1 : F0 Keputusan → F1 Fondasi → F2 Contract ⇄ F3 Backend Core
Minggu 2 : F4 Campaign/Review → F5 Donation/Payment     ⇄ F8 Frontend (public + student)
Minggu 3 : F6 Blockchain Worker → F7 Integrity/Disburse ⇄ F8 Frontend (admin + proof)
Minggu 4 : F9 Testing/Hardening → F10 Deploy + Rehearsal demo
```

Total ±4 minggu untuk 1–2 orang. Dengan 3–4 orang, bagi per jalur: **Contract + Worker**, **Backend API**, **Frontend**, **Infra/QA/Demo**.

## 3. Critical Path Demo (prioritas kalau waktu mepet)

Urutan wajib jadi: Login → Create & submit campaign → Admin approve → Donasi (mock/sandbox) → PAID → txHash di Etherscan → VERIFIED → **Tamper → TAMPERED → FROZEN → Disbursement LOCKED**.

Bisa dipangkas kalau mepet: Pakasir adapter, cron COMPLETED, Bull Board, audit log viewer UI, verify limited untuk creator, landing page yang mewah.

## 4. Risiko Utama

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Admin consent SSO BINUS gak keluar tepat waktu | Login demo gagal | Ajukan ke IT BINUS minggu 1; `DevLoginAdapter`; tenant Azure pribadi untuk test OIDC |
| Midtrans sandbox / webhook ngrok gagal saat demo | Donasi gak PAID | `MockPaymentAdapter` + tombol settle dev; deploy staging dengan URL tetap (bukan ngrok) |
| Sepolia lambat / RPC down / faucet habis | txHash lama muncul | Retry queue; fund relayer jauh hari; RPC cadangan (Alchemy + Infura); data demo yang sudah CONFIRMED |
| Canonical payload gak deterministik (timezone, format decimal, case UUID) | False TAMPERED | Satu fungsi di `packages/blockchain-client` dipakai API & worker; amount integer; timestamp unix seconds dari kolom tersimpan; unit test |
| Saldo campaign dobel karena race webhook | Data salah | Transaksi DB + unique constraint + atomic increment |

---

## 5. Hal yang Perlu Dikonfirmasi ke Tim

1. Deadline kompetisi & jumlah anggota tim (menentukan apakah plan 4 minggu ini perlu dipadatkan).
2. Status akses Azure tenant BINUS. Siapa yang bisa minta admin consent?
3. Persetujuan tim atas keputusan D1–D19 di atas.
4. Apakah sudah ada desain UI/UX? `FRONTEND PROJECT INIT §9` menyebut "UI/UX brief", tapi file-nya tidak ada di folder ini.

---

## 6. Jadwal Solo 3 Minggu (versi final yang dipakai)

| Hari | Fokus |
|---|---|
| 1 | Monorepo pnpm, docker-compose (Postgres + Redis), `.env.example`, lint/prettier (`types` digabung ke `shared`) |
| 2 | `DonationRegistry.sol` + test + deploy lokal; `canonical.ts` + test determinisme; fund wallet Sepolia |
| 3–4 | NestJS core: Prisma schema + migration + seed, envelope/error, security baseline, Dev Login + session JWT, guards, AuditService, health |
| 5–6 | Storage (LocalDisk, validasi PDF), Campaign CRUD + state machine, admin review |
| 7 | Deploy contract ke Sepolia + verify Etherscan |
| 8–9 | PaymentGateway: Mock + Pakasir, create donation, webhook (signature, idempotency, amount, transaksi DB, enqueue) |
| 10–11 | BullMQ + worker notarisasi (retry, status), endpoint status blockchain |
| 12–13 | Integrity verify → TAMPERED/FROZEN, unfreeze, disbursement, audit log, `demo:tamper` |
| 14 | Unit test inti |
| 15–18 | Frontend: public, student, admin (lihat Fase 8, landing & audit viewer dipangkas) |
| 19 | Deploy staging (Vercel + Railway + Supabase), webhook Pakasir |
| 20 | E2E manual + security check |
| 21 | Data demo, rehearsal 3×, video cadangan |

**Ditunda kalau waktu habis:** OIDC Microsoft asli, Midtrans/VA, Bull Board, audit log viewer UI, cron COMPLETED, verify limited untuk creator, Playwright, CI lengkap.
