# QA Gate 3: Demo E2E + Fallback (BFD-70, BFD-71)

> Dieksekusi oleh tech lead (mewakili QA) via CI otomatis.

| | |
| --- | --- |
| Tanggal eksekusi | 21 Nov 2026 17:56–17:59 UTC (22 Nov 2026 00:56–00:59 WIB) |
| Run CI (bukti) | [E2E QA gates #44932667635](https://github.com/Fundchainbinus/fundchain/actions/runs/44932667635), commit `ecf517f` |
| Artifact (30 hari) | `e2e-video-trace` (video + trace dry run), `e2e-evidence`, `e2e-playwright-report`, `e2e-stack-logs` |
| Hasil | **PASS (otomatis)**, dengan catatan entry criteria di bawah |

## Exit criteria (12-TESTING-PLAN §3)

| Kriteria | Bukti | Status |
| --- | --- | --- |
| Full demo script jalan | [DRY-RUN.md](DRY-RUN.md): 8/8 langkah `13-DEMO-FLOW.md`, 3 di antaranya lewat fallback | PASS (dengan fallback) |
| Fallback tested | [DRY-RUN.md § Fallback](DRY-RUN.md#fallback-matrix-bfd-71-bagian-yang-bisa-diotomasi): mock payment, chain lokal, DEMO_MODE, Postgres lokal | PASS |
| Video backup ada | Artifact `e2e-video-trace` (`recording/mahasiswa/*.webm`, `recording/admin/*.webm`, `trace.zip`) | PASS (rekaman otomatis tanpa narasi) |

## Entry criteria

| Kriteria | Status |
| --- | --- |
| Gate 2 lolos | Lolos untuk jalur mock + tamper ([GATE-2.md](GATE-2.md)). Pakasir sandbox belum diuji. |
| Fallback matrix di-test | Ya (lihat atas) |

## Ringkasan semua suite di run ini

| Suite | Langkah | Hasil | Dokumen |
| --- | --- | --- | --- |
| Gate 1 pre-flight | 6 | 6 PASS | [GATE-1.md](GATE-1.md) |
| Gate 1 E2E | 10 | 10 PASS | [GATE-1.md](GATE-1.md) |
| Gate 2 tamper | 9 | 9 PASS | [GATE-2.md](GATE-2.md) |
| BFD-65 refund & milestone | 12 | 12 PASS | [E2E-REFUND-MILESTONE.md](E2E-REFUND-MILESTONE.md) |
| BFD-69 security | 13 | 13 PASS | [SECURITY-TEST.md](SECURITY-TEST.md) |
| BFD-70 dry run | 8 | 8 PASS | [DRY-RUN.md](DRY-RUN.md) |
| BFD-71 fallback | 4 | 4 PASS | [DRY-RUN.md](DRY-RUN.md) |
| Unit test API | 322 | 322 PASS | [`evidence/api-unit-test.log`](evidence/api-unit-test.log) |

## Cara menjalankan ulang

Setiap push ke branch `qa/e2e-gates` yang mengubah `e2e/**`, `apps/**`, `packages/**`, `contracts/**`, `docs/qa/**`, lockfile, atau workflow akan menjalankan [`.github/workflows/e2e-gates.yml`](../../.github/workflows/e2e-gates.yml). Workflow juga bisa dipicu manual (`workflow_dispatch`) setelah file workflow ada di `main`. Screenshot di `docs/qa/evidence/` diambil dari artifact `e2e-evidence` run di atas.

## Sign-off

Sesuai 12-TESTING-PLAN §15, sign-off tetap butuh QA, TL, dan PM. Dokumen ini adalah bukti eksekusi otomatis, bukan pengganti tanda tangan QA owner.
