# Dry Run Demo (BFD-70) + Fallback (BFD-71)

> Dieksekusi oleh tech lead (mewakili QA) via CI otomatis.

| | |
| --- | --- |
| Tanggal eksekusi | 21 Nov 2026 17:58–17:59 UTC (22 Nov 2026 00:58 WIB) |
| Run CI (bukti) | [E2E QA gates #44932667635](https://github.com/Fundchainbinus/fundchain/actions/runs/44932667635), commit `ecf517f` |
| Rekaman | Artifact **`e2e-video-trace`** (retensi 30 hari) → `05-dry-run-…/recording/mahasiswa/*.webm` (±4,5 MB), `recording/admin/*.webm` (±3,3 MB), `trace.zip` (buka dengan `npx playwright show-trace trace.zip`) |
| Spec | [`e2e/specs/05-dry-run.spec.ts`](../../e2e/specs/05-dry-run.spec.ts) (project `dry-run`: video + trace selalu on), [`e2e/specs/06-fallback.spec.ts`](../../e2e/specs/06-fallback.spec.ts) |
| Hasil | **PASS**: skrip demo 8/8 langkah, fallback 4/4 |

## Environment

Sama dengan [GATE-1](GATE-1.md#environment). Dua persona direkam di dua konteks browser: Mahasiswa, yang juga berperan sebagai donor, dan Admin.

## Skrip demo `13-DEMO-FLOW.md`

Kolom "Expected" mengikuti dokumen. Bagian yang bergantung pada layanan eksternal ditandai **DISUBSTITUSI** dan dijalankan lewat fallback demo. Langkah itu lulus *dengan fallback*, bukan persis seperti tertulis.

| # | Langkah | Expected | Actual | Status | Bukti |
| --- | --- | --- | --- | --- | --- |
| 1 | Login | Microsoft BINUS. **DISUBSTITUSI** `DEMO_MODE` | Login persona Mahasiswa (Budi Santoso) | PASS (fallback) | [png](evidence/gate3-01-login.png) |
| 2 | Create Campaign | title, SDG, target, deadline, proposal → `PENDING_REVIEW` | SDG QUALITY_EDUCATION, target Rp7.500.000, deadline +21 hari, proposal PDF → `PENDING_REVIEW` | PASS | [png](evidence/gate3-02-campaign-pending-review.png) |
| 3 | Admin Review | Queue → approve → `ACTIVE` | Admin → Review kampanye → "Setujui kampanye" → `ACTIVE` | PASS | [png](evidence/gate3-03-admin-approve.png) |
| 4 | Donation | QRIS/VA, webhook `SETTLED`, `PAID`. **DISUBSTITUSI** QRIS mock | Checkout QRIS mock Rp100.000 → "Simulasi bayar berhasil" → webhook bertanda tangan `SETTLED` (audit `PAYMENT_WEBHOOK_RECEIVED`) → `PAID` | PASS (fallback) | [png](evidence/gate3-04-qris-mock.png) |
| 5 | Blockchain | canonical payload → Keccak-256 → queue → relayer → txHash | `v1\|<id>\|STU-00001\|100000\|<unix>` → hash `0xda3e…594c` → tx `0xaa00…ae6d` blok 15, CONFIRMED | PASS | |
| 6 | Transparency | donation, amount, status, txHash, explorer Sepolia → `VERIFIED`. **DISUBSTITUSI** chain lokal | Bukti donasi "COCOK", `integrityStatus=VERIFIED`, txHash tampil; tidak ada link Etherscan (chain 31337) | PASS (fallback) | [png](evidence/gate3-05-transparansi-cocok.png) |
| 7 | Tamper Simulation | Rp100.000 → Rp900.000 → `TAMPERED`, campaign `FROZEN`, disbursement `LOCKED` | `demo:tamper` di DB, lalu admin klik "Verifikasi ke blockchain" → TAMPERED; campaign FROZEN; ajukan pencairan → `409 CAMPAIGN_FROZEN` | PASS | [png](evidence/gate3-06-tampered.png), [png](evidence/gate3-07-frozen-locked.png) |
| 8 | Disbursement (campaign normal) | request + proof → admin approve → mark paid | Ajukan Rp100.000 + bukti PDF (UI) → Admin "Setujui" → "Tandai transfer dibayar" → PAID (milestone 1/1) | PASS | [png](evidence/gate3-08-ajukan-pencairan.png), [png](evidence/gate3-09-pencairan-paid.png) |

Ringkasan per langkah (status, durasi, error bila ada): [`evidence/gate3-dry-run.json`](evidence/gate3-dry-run.json). Tidak ada langkah yang gagal pada run ini.

## Fallback matrix (BFD-71), bagian yang bisa diotomasi

| Komponen | Fallback | Uji | Actual | Status | Bukti |
| --- | --- | --- | --- | --- | --- |
| Pakasir / gateway | `PAYMENT_PROVIDER=mock` | `/config` mock; donasi + simulasi → PAID; UI "Mock payment · mode demo" | provider `mock`, payment `SETTLED`, donasi `PAID` | PASS | [png](evidence/bfd71-01-mock-payment.png) |
| Sepolia | `BLOCKCHAIN_NETWORK=localhost` | `/blockchain/info`; notarisasi di Hardhat | `localhost/31337`, `ready=true`; donasi CONFIRMED, `explorerUrl=null` | PASS | [json](evidence/bfd71-chain-info.json) |
| SSO / Google | `DEMO_MODE` | `POST /auth/google` saat Google tidak tersedia | `401 "Login Google belum dikonfigurasi di server."` | PASS | |
| SSO / Google (UI) | `DEMO_MODE` | Tombol Google gagal, Demo Mahasiswa tetap bisa | Error "Login Google belum dikonfigurasi." lalu login Demo berhasil | PASS | [png](evidence/bfd71-02-google-tidak-tersedia.png), [png](evidence/bfd71-03-demo-login-berhasil.png) |
| Supabase | PostgreSQL lokal (service container CI, setara Docker) | migrate + seed | Lihat pre-flight P1/P2 di [GATE-1](GATE-1.md) | PASS | [json](evidence/gate1-preflight.json) |

Ringkasan: [`evidence/bfd71-fallback.json`](evidence/bfd71-fallback.json)

## Yang tidak bisa diotomasi / di luar cakupan

- Login Microsoft SSO BINUS asli, pembayaran QRIS/VA sungguhan (Pakasir/Sakurupiah), dan explorer Sepolia: belum ada atau butuh credential/dana asli, jadi hanya jalur fallback yang diuji.
- Video yang akan diputar saat Demo Day: rekaman CI adalah rekaman otomatis Playwright tanpa narasi, layak sebagai cadangan teknis. Video narasi tetap perlu direkam manusia.
- Kesiapan perangkat dan jaringan di lokasi demo.
