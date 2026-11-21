# QA Gate 1: Integrasi (BFD-5, BFD-66)

> Dieksekusi oleh tech lead (mewakili QA) via CI otomatis.

| | |
| --- | --- |
| Tanggal eksekusi | 21 Nov 2026 17:56 UTC (22 Nov 2026 00:56 WIB) |
| Run CI (bukti) | [E2E QA gates #44932667635](https://github.com/Fundchainbinus/fundchain/actions/runs/44932667635), commit `ecf517f`, branch `qa/e2e-gates` |
| Artifact (30 hari) | `e2e-evidence` (screenshot + JSON), `e2e-playwright-report`, `e2e-video-trace`, `e2e-stack-logs` |
| Spec | [`e2e/specs/00-preflight.spec.ts`](../../e2e/specs/00-preflight.spec.ts), [`e2e/specs/01-gate1.spec.ts`](../../e2e/specs/01-gate1.spec.ts) |
| Hasil | **PASS**: pre-flight 6/6, E2E 10/10 |

## Environment

Stack sekali pakai di runner GitHub Actions ([`.github/workflows/e2e-gates.yml`](../../.github/workflows/e2e-gates.yml)). Tidak ada `apps/api/.env`, `secrets.*`, maupun akses ke DB/API production; workflow dan harness menolak jalan kalau URL bukan loopback.

- PostgreSQL 17 (service container), `prisma migrate deploy` + seed
- Hardhat node lokal (chainId 31337, kunci dev publik), `DonationRegistry` di-deploy `deploy:local`
- API NestJS `node dist/main.js`: `PAYMENT_PROVIDER=mock`, `DEMO_MODE=true`, `STORAGE_DRIVER=db`, `WORKER_ENABLED=true` (interval 2 dtk), `GOOGLE_CLIENT_ID` kosong
- Web hasil `vite build`, di-serve `vite preview` (proxy `/api` ke API lokal)
- Playwright 1.64.1 Chromium, viewport 1280x800

## Pre-flight checklist

| # | Item | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| P1 | Migrasi | `prisma migrate status` = up to date | exit 0, 7 migrasi, "Database schema is up to date" | PASS |
| P2 | Seed | Persona demo dan campaign contoh tersedia | student = budi.santoso@binus.ac.id, admin = admin@binus.ac.id, 6 campaign seed (ACTIVE, DRAFT, FROZEN, PENDING_REVIEW, REJECTED) | PASS |
| P3 | Health | `/health` ok langsung dan lewat proxy web | ok di `:3000` dan `:5173/api` | PASS |
| P4 | Konfigurasi | mock, demoMode, localhost/31337 | `paymentProvider=mock`, `demoMode=true`, `devTools=true`, `localhost/31337` | PASS |
| P5 | Kontrak ter-deploy | Bytecode ada di alamat deployment | `0x5FbDB2315678afecb367f032d93F642f64180aa3` (1674 byte), sama dengan alamat yang dipakai API | PASS |
| P6 | Relayer punya role | `hasRole(RELAYER_ROLE, relayer)` true | Relayer `0x7099…79C8` = true; admin `0xf39F…2266` = false (admin ≠ relayer) | PASS |

Bukti: [`evidence/gate1-preflight.json`](evidence/gate1-preflight.json)

## Skenario E2E (UI)

| # | Langkah | Expected | Actual | Status | Bukti |
| --- | --- | --- | --- | --- | --- |
| G1-01 | Login demo mahasiswa | Avatar Budi Santoso tampil | Login sebagai budi.santoso@binus.ac.id | PASS | [png](evidence/gate1-01-login-demo-mahasiswa.png) |
| G1-02 | Buat campaign, simpan draft | URL `/campaigns/:id/edit` | Draft tersimpan | PASS | |
| G1-03 | Unggah proposal PDF | `proposal-contoh.pdf` tercantum | Terunggah (disimpan di tabel `stored_files`) | PASS | [png](evidence/gate1-02-campaign-proposal-diunggah.png) |
| G1-04 | Ajukan review | `PENDING_REVIEW` | `PENDING_REVIEW` | PASS | [png](evidence/gate1-03-campaign-pending-review.png) |
| G1-05 | Login demo admin, Setujui | `ACTIVE` | `ACTIVE` | PASS | [png](evidence/gate1-04-admin-setujui-active.png) |
| G1-06 | Donasi Rp100.000 (checkout QRIS) | QRIS mock, status menunggu | QRIS tampil, PENDING | PASS | [png](evidence/gate1-05-pembayaran-qris-mock.png) |
| G1-07 | Simulasi bayar berhasil | Donasi PAID ("Lunas") | Webhook mock bertanda tangan diterima, PAID | PASS | [png](evidence/gate1-06-donasi-paid.png) |
| G1-08 | Worker menotarisasi | CONFIRMED, txHash, chain 31337 | CONFIRMED, tx `0x41c5…1909`, blok 9 | PASS | [json](evidence/gate1-proof.json) |
| G1-09 | Halaman bukti | Hash on-chain = DB, "COCOK" | `hashDb` = `hashOnChain` = `currentHash` = `0x4199…75c0`, `match=true`, banner "COCOK" | PASS | [png](evidence/gate1-07-bukti-cocok-onchain.png) |
| G1-10 | Hitung ulang hash di browser | "Cocok dengan hash DB" | Cocok | PASS | [png](evidence/gate1-08-hash-browser-cocok.png) |

Ringkasan langkah, durasi, dan URL run tersimpan di [`evidence/gate1-e2e.json`](evidence/gate1-e2e.json).

## Catatan

- Login di Gate 1 memakai `DEMO_MODE` (fallback SSO) sesuai 12-TESTING-PLAN §0. Login Google tidak diuji karena `GOOGLE_CLIENT_ID` sengaja kosong.
- Persona kedua (admin) dibuka di konteks browser terpisah, bukan lewat logout. Logout (BFD-11) mencabut semua sesi user tersebut.
- Exit criteria Gate 1 ("donation PAID → notarize → integrity VERIFIED, semua automated") terpenuhi.
