# Metrics Report FundChain (BFD-78)

> Disusun oleh tech lead mewakili QA, 22 Nov 2026.
> Data production diambil 22 Nov 2026 ~00:30 WIB (21 Nov 17:30 UTC) dengan query **SELECT agregat read-only**
> ke Supabase (tanpa data pribadi). Data on-chain dari RPC publik Sepolia.

## 1. Pembayaran

Seluruh 30 payment di production memakai provider **`mock`** (`PAYMENT_PROVIDER=mock`). Angka ini mengukur alur
aplikasi, bukan keandalan gateway asli. Rentang data: donasi dibuat 25 Sep – 8 Nov 2026.

| Metrik | Nilai |
| --- | --- |
| Total donasi | 30 |
| **Payment success rate** (PAID / semua donasi) | **16 / 30 = 53,3%** |
| Expired rate | 14 / 30 = 46,7% |
| Failed rate | 0 / 30 = 0% |
| Refund | 0 |
| PENDING menggantung | 0 |

EXPIRED tinggi wajar untuk data uji: donasi dibuat lalu tidak dibayar (QR 15 menit, D-005).

## 2. Notarisasi blockchain (Sepolia)

| Metrik | Nilai |
| --- | --- |
| Total ternotarisasi (CONFIRMED) | **16** (0 FAILED, 0 antre, total retry 0) |
| Cocok dengan event on-chain | 16 event `DonationNotarized` ([`SEPOLIA-E2E.md`](../blockchain/evidence/SEPOLIA-E2E.md)) |
| Time-to-notarize, semua (n=16) | median **6.402 dtk (~1,8 jam)** · p90 **496.471 dtk (~5,7 hari)** |
| Time-to-notarize, donasi sebelum kontrak di-deploy (n=9) | median 194.094 dtk (~2,2 hari) · p90 556.953 dtk |
| **Time-to-notarize, donasi setelah deploy 2 Okt 14:55 UTC (n=7)** | **median 15,3 dtk · p90 29,3 dtk · maks 31,8 dtk** |
| Biaya gas | **N/A**: 0 dari 16 tx punya `fee_wei` (semua dikonfirmasi sebelum migrasi `20261121000300_tx_gas_fee`) |
| Saldo relayer | 0,0484 ETH (threshold 0,02 ETH), `lowBalance: false` |

Time-to-notarize = `blockchain_transactions.confirmed_at − donations.donated_at`. Angka gabungan didominasi 9 donasi
yang dibayar sebelum kontrak ada (antre sampai deploy), jadi angka yang mewakili sistem adalah baris pasca-deploy.

## 3. Integritas

| Metrik | Nilai |
| --- | --- |
| Donasi yang pernah dicek (`last_checked_at` terisi) | 16 |
| **Integrity pass rate** (VERIFIED / dicek) | **15 / 16 = 93,75%** |
| TAMPERED | 1 (hasil uji tamper; campaign terkait FROZEN, lihat BUG-TRIAGE T-1) |
| Audit `INTEGRITY_VERIFIED` / `INTEGRITY_TAMPERED` | 45 / 5 (1 Okt – 21 Nov) |

Satu-satunya TAMPERED adalah data uji, jadi pass rate untuk data yang tidak diubah = 100%.

## 4. Data lain production

| Metrik | Nilai |
| --- | --- |
| Campaign | 17 (ACTIVE 1 · COMPLETED 5 · PENDING_REVIEW 6 · DRAFT 3 · REJECTED 1 · FROZEN 1) |
| Disbursement | 1 (APPROVED) |
| Audit log | 209 baris |
| Smoke GET production (22 Nov) | `/health`, `/config`, `/blockchain/info`, `/campaigns`, `/files/config`: semua 200; web 200 |

## 5. Kualitas & test

| Paket | Test | Hasil | Sumber |
| --- | --- | --- | --- |
| `apps/api` | 322 (19 file) | ✅ 0 gagal | CI run [44928137356](https://github.com/Fundchainbinus/fundchain/actions/runs/44928137356) |
| `packages/shared` | 12 (1 file) | ✅ 0 gagal | CI run 44928137356 |
| `contracts` | 19 (2 file) | ✅ 0 gagal | lokal 22 Nov (tidak di CI) |
| **Total** | **353** | ✅ | |
| Coverage `DonationRegistry.sol` | 100% stmt · **100% branch** · 100% func · 100% line | | `npx hardhat coverage` lokal |
| `apps/web` | 0 test | 🟡 | — |
| Test matrix | 82 kasus: 60 ✅ · 20 🟡 · 2 N/A | | [`TEST-MATRIX.md`](TEST-MATRIX.md) |

## 6. Status gate

| Gate | Dokumen | Status |
| --- | --- | --- |
| Gate 1 — Integration | [`GATE-1.md`](GATE-1.md) | Lihat dokumen gate |
| Gate 2 — Payment + Tamper | [`GATE-2.md`](GATE-2.md) | Lihat dokumen gate |
| Gate 3 — Demo E2E + Fallback | [`GATE-3.md`](GATE-3.md), [`DRY-RUN.md`](DRY-RUN.md) | Lihat dokumen gate |

Dokumen gate disusun terpisah; laporan ini tidak mengulang hasilnya.

## 7. Bug

| Severity | Open | Issue |
| --- | --- | --- |
| S1 | **0** | — |
| S2 | 2 | [#33](https://github.com/Fundchainbinus/fundchain/issues/33), [#34](https://github.com/Fundchainbinus/fundchain/issues/34) |
| S3 | 6 | [#27](https://github.com/Fundchainbinus/fundchain/issues/27)–[#32](https://github.com/Fundchainbinus/fundchain/issues/32) |
| Fixed (riwayat BUGS.md) | 9 | BUG-001..008, BUG-015 |

Detail: [`BUG-TRIAGE.md`](BUG-TRIAGE.md).

## 8. Progres per divisi (dari repo)

Dihitung dari `git log --no-merges` di `main` @ `9fdba90`: 98 commit, 48 key BFD berbeda disebut di pesan commit.
Satu commit bisa menyentuh beberapa area. Status Jira tidak dipakai di laporan ini.

| Divisi | Area repo | Commit | Hasil utama di repo |
| --- | --- | --- | --- |
| Backend | `apps/api` | 47 | 55 endpoint final ([`INTEGRATION-CONTRACT.md`](INTEGRATION-CONTRACT.md)), 7 migrasi (terakhir `20261121000300_tx_gas_fee`), 322 test |
| Frontend | `apps/web` | 41 | Halaman publik, donasi/bayar, bukti, pencairan, dashboard admin; 45 endpoint terpakai. Belum ada test |
| Blockchain | `contracts`, worker, integrity | 7 (+ modul blockchain di `apps/api`) | Kontrak final di Sepolia (D-008), 16 notarisasi, coverage 100%, runbook relayer/tamper/worker |
| Shared | `packages/shared` | 13 | Canonical v1 beku (D-009), 12 test vector |
| Infra / CI | `.github` | 8 | CI (typecheck, test, seed smoke, gitleaks), backup harian, cron tick, alert saldo relayer |
| Dokumentasi / QA | `docs` | 15 | DECISIONS (D-001..D-009), BUGS, PERFORMANCE, BACKUP, dokumen QA ini |
