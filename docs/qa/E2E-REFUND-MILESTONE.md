# E2E Refund & Milestone (BFD-65)

> Dieksekusi oleh tech lead (mewakili QA) via CI otomatis.

| | |
| --- | --- |
| Tanggal eksekusi | 21 Nov 2026 17:58 UTC (22 Nov 2026 00:58 WIB) |
| Run CI (bukti) | [E2E QA gates #44932667635](https://github.com/Fundchainbinus/fundchain/actions/runs/44932667635), commit `ecf517f` |
| Artifact (30 hari) | `e2e-evidence`, `e2e-playwright-report` |
| Spec | [`e2e/specs/03-refund-milestone.spec.ts`](../../e2e/specs/03-refund-milestone.spec.ts) |
| Hasil | **PASS**: 12/12 |

## Environment

Sama dengan [GATE-1](GATE-1.md#environment). Data yang dipakai berasal dari seed:

- "Air Bersih untuk Desa Sukamaju": ACTIVE, milik Budi. Milestone 1 PAID, milestone 2 REQUESTED.
- "Kebun Hidroponik Rusun Marunda": FROZEN. Budi punya donasi PAID Rp200.000 di sini.

## Milestone bertahap

| # | Langkah | Expected | Actual | Status | Bukti |
| --- | --- | --- | --- | --- | --- |
| M-01 | Status awal | Tahap 2 REQUESTED, `canRequestNext=false` | 1 dari 2 selesai, tahap 2 REQUESTED | PASS | [json](evidence/bfd65-milestones-awal.json) |
| M-02 | Ajukan milestone baru saat tahap 2 masih terbuka | 409 | `409 DISBURSEMENT_IN_PROGRESS` | PASS | |
| M-03 | Admin setujui milestone 2 (UI) | APPROVED | APPROVED, lewat dialog konfirmasi | PASS | [png](evidence/bfd65-01-admin-setujui-milestone2.png) |
| M-04 | Admin tandai transfer dibayar (UI) | PAID, 2/2 | PAID; 2 dari 2 selesai; `canRequestNext=true` | PASS | [png](evidence/bfd65-02-admin-tandai-dibayar.png) |
| M-05 | Mahasiswa ajukan milestone 3 + bukti PDF (UI) | REQUESTED | "Pengajuan terkirim…", Rp100.000 REQUESTED | PASS | [png](evidence/bfd65-03-mahasiswa-ajukan-milestone3.png) |
| M-06 | Ajukan milestone 4 saat milestone 3 terbuka | 409 | `409 DISBURSEMENT_IN_PROGRESS` | PASS | |
| M-07 | Approve + mark paid milestone 3, cek progres | 3/3, UI menampilkan progres | 3 dari 3 selesai; UI "3 dari 3 selesai" | PASS | [png](evidence/bfd65-04-progres-milestone.png), [json](evidence/bfd65-milestones-akhir.json) |

## Refund (D-001: manual, hanya campaign FROZEN)

| # | Langkah | Expected | Actual | Status | Bukti |
| --- | --- | --- | --- | --- | --- |
| R-01 | Refund donasi di campaign ACTIVE | Ditolak | `409 REFUND_CAMPAIGN_NOT_FROZEN`; donasi tetap PAID | PASS | |
| R-02 | Alasan terlalu pendek | 400 | `400 VALIDATION_ERROR` ("Alasan refund minimal 5 karakter") | PASS | |
| R-03 | Refund donasi PAID di campaign FROZEN | REFUNDED, saldo turun, audit | REFUNDED; saldo campaign Rp500.000 → Rp300.000; audit `DONATION_REFUNDED` | PASS | [json](evidence/bfd65-refund.json) |
| R-04 | Refund kedua | Ditolak | `409 DONATION_NOT_REFUNDABLE` | PASS | |
| R-05 | Halaman pembayaran donatur | REFUNDED tampil | Badge "Dana dikembalikan" dan penjelasan refund | PASS | [png](evidence/bfd65-05-pembayaran-refunded.png) |

Ringkasan langkah: [`evidence/bfd65-refund-milestone.json`](evidence/bfd65-refund-milestone.json)

## Catatan

- Refund belum punya UI admin; langkah R-01 s.d. R-04 lewat API `POST /admin/donations/:id/refund`, sesuai README/D-001. Hasilnya tetap diverifikasi di UI donatur (R-05).
- Uang sungguhan tidak ikut diuji. Refund hanya mencatat status karena dana dikembalikan di luar sistem (D-001/D-007).
