# Release Readiness FundChain (BFD-79)

> Disusun oleh tech lead mewakili QA, 22 Nov 2026.
> Semua pengecekan read-only: tidak ada write ke database, tidak ada transaksi on-chain, tidak ada perubahan env.

Legenda: ✅ siap · ⚠️ siap dengan catatan · ❌ belum siap.

## Checklist

| # | Item | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | **Migrasi DB production** | ✅ | Repo punya 7 migrasi, terakhir `20261121000300_tx_gas_fee`. `prisma migrate status` sengaja tidak dijalankan ke production; bukti tidak langsung: SELECT read-only atas kolom `blockchain_transactions.fee_wei` (dibuat oleh migrasi terakhir) berhasil, jadi migrasi itu sudah terpasang. CI *Seed smoke test* menjalankan `prisma migrate deploy` dari nol tanpa error |
| 2 | **Env production `fundchain-api`** | ⚠️ | `vercel env ls production` (nama saja, 22 Nov): `DATABASE_URL`, `DIRECT_URL`, `NODE_ENV`, `WEB_URL`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, `SESSION_SECRET`, `FILE_URL_SECRET`, `CRON_SECRET`, `ENABLE_DEV_TOOLS`, `PAYMENT_PROVIDER`, `MOCK_WEBHOOK_SECRET`, `BLOCKCHAIN_NETWORK`, `BLOCKCHAIN_RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`, `RELAYER_PRIVATE_KEY`, `BLOCKCHAIN_CONFIRMATIONS`, `WORKER_ENABLED`, `WORKER_MODE`, `STORAGE_DRIVER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` (24). **Tidak ada:** `ALERT_WEBHOOK_URL` (alert hanya ke audit/log, RISK R-11), `DEMO_MODE` + `DEMO_MODE_ALLOW_PRODUCTION` (sengaja; lihat FALLBACK F-1), `PAKASIR_*` (tidak dipakai selama `mock`). Sisanya memakai default kode. `FILE_URL_SECRET` belum tercantum di `apps/api/.env.example` |
| 3 | **Kontrak ter-deploy** | ⚠️ | `eth_getCode(0x3Aa2…35b2)` di Sepolia tidak kosong (RPC publik, blok `12183240`). `CONTRACT_ADDRESS` production = `contracts/deployments/sepolia.json` (D-008). Source **belum** diverifikasi di Etherscan (RISK R-03) |
| 4 | **Saldo relayer** | ✅ | `eth_getBalance(0x04ae…BF89)` = **0,0484 ETH** (RPC publik `ethereum-sepolia-rpc.publicnode.com`), sama dengan `GET /blockchain/info` (`lowBalance: false`, min 0,02) |
| 5 | **Seed smoke test CI** | ✅ | Job *Seed smoke test* di CI run [44928137356](https://github.com/Fundchainbinus/fundchain/actions/runs/44928137356) (`main` @ `9fdba90`): migrate, seed 2x, jumlah baris tidak berubah |
| 6 | **Test otomatis** | ✅ | CI run 44928137356 success: api 322, shared 12, typecheck shared/api/web, gitleaks. Contracts 19 test + coverage 100% (lokal). Lihat [`TEST-MATRIX.md`](TEST-MATRIX.md) |
| 7 | **Smoke test production (GET, read-only)** | ✅ | 22 Nov ~00:21 WIB: `/api/v1/health` 200 (2,1 dtk, cold start) · `/config` 200 · `/blockchain/info` 200 (`ready: true`) · `/campaigns?limit=1` 200 · `/files/config` 200 (`driver: supabase`) · web `fundchain-web.vercel.app` 200 |
| 8 | **Konfigurasi runtime production** | ⚠️ | `GET /config`: `paymentProvider: mock`, `demoMode: false`, `devTools: false`, chain `sepolia`/`11155111`. Gateway asli belum aktif (RISK R-01) |
| 9 | **Backup** | ⚠️ | Run terakhir *DB backup* [44894748894](https://github.com/Fundchainbinus/fundchain/actions/runs/44894748894) (21 Nov 10:31 UTC, `workflow_dispatch`, success, termasuk uji restore). **Belum ada run terjadwal** ([#34](https://github.com/Fundchainbinus/fundchain/issues/34)); artifact di repo public ([#33](https://github.com/Fundchainbinus/fundchain/issues/33)) |
| 10 | **Cron / worker** | ❌ | *Cron tick* hanya pernah jalan manual (run terakhir 44928292010, success); 0 run `schedule` ([#34](https://github.com/Fundchainbinus/fundchain/issues/34)). Vercel Cron harian sebagai cadangan |
| 11 | **Monitoring saldo relayer** | ⚠️ | *Relayer balance* run 44928294998 (manual, success); belum ada run terjadwal |
| 12 | **Bug S1 terbuka** | ✅ | **0** ([`BUG-TRIAGE.md`](BUG-TRIAGE.md)). S2 terbuka: 2 (#33, #34) |
| 13 | **Gate 1–3** | ⚠️ | Lihat [`GATE-1.md`](GATE-1.md), [`GATE-2.md`](GATE-2.md), [`GATE-3.md`](GATE-3.md), [`DRY-RUN.md`](DRY-RUN.md) |
| 14 | **Fallback** | ⚠️ | [`FALLBACK-PLAN.md`](FALLBACK-PLAN.md); eksekusi end-to-end tercatat di GATE-3 |

## Rollback plan

| Komponen | Cara rollback | Catatan |
| --- | --- | --- |
| Web / API (Vercel) | Vercel → Deployments → pilih deployment sehat sebelumnya → **Promote to Production** (instant rollback). Atau `git revert` di `main` lalu deploy ulang | Tidak menyentuh DB |
| Env Vercel | Kembalikan nilai env lama, redeploy | Catat perubahan env di PR/DECISIONS |
| Migrasi DB | Migrasi bersifat additive (kolom/index baru); kode lama tetap jalan dengan skema baru, jadi rollback kode tidak butuh rollback skema. Bila skema rusak: restore backup ke project baru ([`BACKUP.md`](../BACKUP.md)) | Jangan `migrate reset` di production |
| Kontrak | Tidak di-rollback/redeploy (D-008). Kunci relayer bocor → rotasi role ([`RELAYER-ROLE-RUNBOOK.md`](../blockchain/RELAYER-ROLE-RUNBOOK.md)) | Hash on-chain bersifat permanen |
| Gateway pembayaran | Kembali ke `PAYMENT_PROVIDER=mock` ([`FALLBACK-PLAN.md`](FALLBACK-PLAN.md) F-2) | |

## Keputusan

**Siap demo dengan catatan.** Syarat sebelum demo:

1. Pemicu cron terjadwal terbukti jalan, atau prosedur manual *Cron tick* masuk skrip demo (#34).
2. Keputusan TL atas repo public vs backup (#33).
3. Verifikasi source kontrak di Etherscan (R-03).
4. `ALERT_WEBHOOK_URL` diisi (R-11).

Tidak siap untuk rilis dengan uang sungguhan: gateway asli (Sakurupiah) belum terintegrasi (R-01).

## Sign-off

| Peran | Nama | Tanda tangan / tanggal |
| --- | --- | --- |
| Tech lead (mewakili QA) | ____________________ | ____________________ |
| QA owner | ____________________ | ____________________ |
| PM | ____________________ | ____________________ |
