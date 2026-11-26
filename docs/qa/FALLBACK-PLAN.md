# Fallback Plan Demo (BFD-71)

> Disusun oleh tech lead mewakili QA, 22 Nov 2026.

Pembaruan §13 *Fallback Matrix* di [`12-TESTING-PLAN.md`](../../FundChain_Complete_Planning_Docs/12-TESTING-PLAN.md)
untuk stack saat ini: login Google (D-006), gateway Sakurupiah/Pakasir (D-002), API di Vercel Function, DB Supabase,
kontrak di Sepolia (D-008).

## Ringkasan

| ID | Komponen gagal | Fallback | Waktu pindah | Owner | Bukti terverifikasi |
| --- | --- | --- | --- | --- | --- |
| F-1 | Login Google | `DEMO_MODE` persona switcher (`/auth/demo?persona=student\|admin`) | ~5 menit (set env + redeploy) | BE Auth | Unit: `api/auth-session.test.ts` › *DEMO_MODE (BFD-12)*. Eksekusi di production: 🟡 [`GATE-3.md`](GATE-3.md) |
| F-2 | Gateway Sakurupiah/Pakasir | `PAYMENT_PROVIDER=mock` + tombol simulasi bayar | ~5 menit: provider production **sudah** `mock` (22 Nov), tinggal `ENABLE_DEV_TOOLS=true` + redeploy | BE Payment | CI job *Seed smoke test* (`PAYMENT_PROVIDER=mock`), `api/payments*.test.ts`; 30 payment production semuanya `mock` |
| F-3 | Sepolia lambat / RPC down / saldo relayer habis | Hardhat lokal (`BLOCKCHAIN_NETWORK=localhost`, chainId 31337) | ~10 menit (stack lokal) | BC Relayer | CI job *Seed smoke test* (`BLOCKCHAIN_NETWORK=localhost`), `api/common/bc-local-config.test.ts`; alur penuh: 🟡 GATE-3 |
| F-4 | Vercel (web/API) down | Jalankan web + API di laptop demo | ~10 menit | FE + BE Infra | 🟡 GATE-3 |
| F-5 | Masalah DB Supabase (data rusak/hilang) | Restore dari backup terenkripsi ([`BACKUP.md`](../BACKUP.md)), atau Postgres lokal + seed | 15–30 menit | BE Infra + TL | Workflow *DB backup* run [44894748894](https://github.com/Fundchainbinus/fundchain/actions/runs/44894748894) (21 Nov, manual) lulus uji restore otomatis |
| F-6 | Semua gagal / jaringan venue mati | Video backup demo | segera | PM | 🟡 GATE-3 |

> Catatan: per `main` @ `9fdba90` belum ada workflow e2e di `.github/workflows/` (hanya `ci.yml`, `backup.yml`, `cron-tick.yml`,
> `relayer-balance.yml`). Kolom "Bukti" hanya menyebut test/CI yang benar-benar ada; eksekusi fallback end-to-end
> dicatat di [`GATE-3.md`](GATE-3.md) dan gladi di [`DRY-RUN.md`](DRY-RUN.md).

## Langkah per fallback

### F-1 — Login Google gagal → DEMO_MODE

Pemicu: popup Google diblokir, origin belum terdaftar, atau Google lambat.

1. Vercel → project `fundchain-api` → Settings → Environment Variables (Production): tambah `DEMO_MODE=true` **dan**
   `DEMO_MODE_ALLOW_PRODUCTION=true`. Keduanya belum ada di production (cek 22 Nov). Tanpa yang kedua, endpoint tetap
   404 di production.
2. Redeploy `fundchain-api` (Deployments → ⋯ → Redeploy).
3. Cek `GET https://fundchain-api.vercel.app/api/v1/config` → `demoMode: true`.
4. Di web, pilih persona **student** atau **admin** (persona memakai user seed; login dicatat di audit log).
5. Setelah demo: hapus kedua env, redeploy, pastikan `demoMode: false`.

### F-2 — Gateway pembayaran gagal → mock adapter

Pemicu: Sakurupiah/Pakasir down, QR tidak muncul, webhook tidak datang.

1. Production saat ini sudah `PAYMENT_PROVIDER=mock`. Bila nanti diganti ke gateway asli, kembalikan ke `mock` di
   Vercel env lalu redeploy.
2. Set `ENABLE_DEV_TOOLS=true` supaya tombol simulasi (`POST /dev/payments/:id/simulate`) tampil di halaman bayar.
   Per 22 Nov production melaporkan `devTools: false` di `GET /config`, jadi langkah ini perlu redeploy.
3. Donasi → klik *Simulasikan bayar* → status PAID → notarisasi berjalan seperti biasa.
4. Narasi ke juri: "gateway disimulasikan; verifikasi webhook asli diuji di test otomatis (PAY-07..09)".
5. Setelah demo: kembalikan `ENABLE_DEV_TOOLS=false`, redeploy, pastikan `GET /config` → `devTools: false`.

### F-3 — Sepolia lambat → Hardhat lokal

Pemicu: tx belum CONFIRMED > 2 menit, RPC error, atau saldo relayer < 0.02 ETH.

Langkah cepat (sebelum pindah): jalankan workflow *Cron tick* manual (Actions → Cron tick → Run workflow) dan cek
`GET /blockchain/info` (`ready`, `lowBalance`). Bila tetap gagal:

1. Di laptop demo (Docker Desktop aktif), ikuti [`LOCAL-DEVELOPMENT.md`](../blockchain/LOCAL-DEVELOPMENT.md):
   `pnpm bc-local:db:setup` (Postgres + migrate + seed), lalu `pnpm bc-local:dev:worker` (Hardhat node, deploy
   kontrak, API + worker, web sekaligus).
2. Stack ini memaksa `PAYMENT_PROVIDER=mock`, DB lokal, dan chainId 31337 (dijaga `bc-local-config.test.ts`).
3. Jalankan `pnpm bc-local:smoke` untuk memastikan donasi → PAID → CONFIRMED.
4. Halaman bukti menampilkan network `localhost`; jelaskan bahwa bukti Sepolia asli ada di
   [`SEPOLIA-E2E.md`](../blockchain/evidence/SEPOLIA-E2E.md) (16 notarisasi, link Etherscan).

### F-4 — Vercel down → jalankan lokal

1. Stack lokal penuh: sama dengan F-3 (`pnpm bc-local:*`), tanpa ketergantungan Vercel/Supabase.
2. Alternatif bila hanya web yang down: `pnpm dev:web:remote` (web lokal ke API production).
3. Buka web lokal di browser laptop demo; login lewat DEMO_MODE (set `DEMO_MODE=true` di env API lokal; di
   non-production `DEMO_MODE_ALLOW_PRODUCTION` tidak diperlukan).

### F-5 — Masalah DB → restore backup

Ikuti [`BACKUP.md`](../BACKUP.md) bagian *Restore manual*; ringkasnya:

1. Hentikan trafik tulis (matikan workflow *Cron tick*, webhook pembayaran).
2. `gh run download <run-id> -n db-backup-<run-id>` → `sha256sum -c` → `gpg --decrypt` (passphrase dari password manager tim).
3. Restore ke project Supabase **baru/kosong** (bukan menimpa), arahkan `DATABASE_URL`/`DIRECT_URL` ke sana, redeploy.
4. `prisma migrate status` harus bersih (migrasi terakhir `20261121000300_tx_gas_fee`), lalu *verify-all* dari dashboard
   admin: hash harus tetap cocok dengan on-chain.
5. Untuk demo saja: Postgres lokal + seed (`pnpm bc-local:db:setup`) lebih cepat daripada restore.

Catatan risiko: per 26 Nov workflow backup sudah jalan terjadwal (5 run `schedule`, semua success; [#34](https://github.com/Fundchainbinus/fundchain/issues/34)),
dan artifact ada di repo public ([#33](https://github.com/Fundchainbinus/fundchain/issues/33)). Jalankan backup manual
H-1 demo.

### F-6 — Video backup

Rekaman alur penuh (§10 test plan + demo tamper) disiapkan di Gate 3. Diputar bila F-1..F-5 tidak cukup.

## Checklist H-1 demo

- [ ] Saldo relayer ≥ 0.02 ETH (`/blockchain/info`)
- [ ] Workflow *Cron tick* dan *DB backup* dijalankan manual, sukses
- [ ] Laptop demo: `pnpm install`, Docker aktif, `pnpm bc-local:smoke` lulus
- [ ] Env DEMO_MODE disiapkan (belum dinyalakan)
- [ ] Video backup tersedia offline
- [ ] Hotspot cadangan
