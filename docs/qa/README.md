# Dokumen QA FundChain

> Disusun oleh tech lead mewakili QA, 22 Nov 2026.

Rencana uji sumber: [`12-TESTING-PLAN.md`](../../FundChain_Complete_Planning_Docs/12-TESTING-PLAN.md).

| Dokumen | Isi | Jira |
| --- | --- | --- |
| [`TEST-MATRIX.md`](TEST-MATRIX.md) | 82 kasus test plan + 22 file test otomatis (353 test), status per CI run | BFD-4, BFD-62, BFD-80 |
| [`RISK-REGISTER.md`](RISK-REGISTER.md) | Risiko, likelihood/impact, owner, mitigasi | BFD-7 |
| [`INTEGRATION-CONTRACT.md`](INTEGRATION-CONTRACT.md) | 55 endpoint: auth, DTO, response, owner BE, konsumen FE | BFD-9, BFD-63 |
| [`BUG-TRIAGE.md`](BUG-TRIAGE.md) | Papan triase GitHub Issues (`qa-triage`), aturan severity S1–S4 | BFD-64 |
| [`FALLBACK-PLAN.md`](FALLBACK-PLAN.md) | Langkah fallback: DEMO_MODE, mock payment, Hardhat lokal, run lokal, restore backup | BFD-71 |
| [`METRICS-REPORT.md`](METRICS-REPORT.md) | Metrik production (read-only), test, bug, progres per divisi | BFD-78 |
| [`RELEASE-READINESS.md`](RELEASE-READINESS.md) | Checklist rilis, rollback, sign-off | BFD-79 |
| [`GATE-1.md`](GATE-1.md), [`GATE-2.md`](GATE-2.md), [`GATE-3.md`](GATE-3.md) | Eksekusi gate | (disusun terpisah) |
| [`E2E-REFUND-MILESTONE.md`](E2E-REFUND-MILESTONE.md) | E2E refund & milestone | (disusun terpisah) |
| [`SECURITY-TEST.md`](SECURITY-TEST.md) | Eksekusi security test §12 | (disusun terpisah) |
| [`DRY-RUN.md`](DRY-RUN.md) | Gladi demo | (disusun terpisah) |
| [`E2E-HUMAN-VS-AUTO.md`](E2E-HUMAN-VS-AUTO.md) | Peta alur E2E: langkah otomatis, butuh pemicu cron, atau butuh manusia | — |

Keputusan terkait: [`DECISIONS.md`](../DECISIONS.md) D-008 (deploy Sepolia final) dan D-009 (canonical v1 final).
Riwayat bug: [`BUGS.md`](../BUGS.md).
