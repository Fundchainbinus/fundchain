# Bug Triage Board (BFD-64)

> Disusun oleh tech lead mewakili QA, 22 Nov 2026.

Papan triase memakai **GitHub Issues** di `Fundchainbinus/fundchain` dengan label `qa-triage`:
<https://github.com/Fundchainbinus/fundchain/issues?q=label%3Aqa-triage>. Riwayat bug yang sudah diperbaiki tetap di
[`docs/BUGS.md`](../BUGS.md).

## Label

| Label | Arti |
| --- | --- |
| `S1-blocker` | Demo/rilis ditahan: canonical mismatch, notarisasi gagal total, RLS bypass, gateway menolak pembayaran valid |
| `S2-major` | Fitur utama rusak atau risiko data/operasional serius |
| `S3-minor` | Minor: performa, batas query, edge case dengan workaround |
| `S4-cosmetic` | Kosmetik (teks, tampilan) |
| `area:api`, `area:web`, `area:payments`, `area:blockchain`, `area:db`, `area:perf`, `area:infra` | Area kode |
| `qa-triage` | Masuk papan triase QA |

## Aturan triase

1. **Siapa boleh membuka issue:** semua anggota. Wajib: langkah reproduksi, hasil yang diharapkan vs aktual, environment
   (lokal / production / Sepolia), dan label area.
2. **Severity** ditentukan QA saat triase (maks. 1 hari kerja). **S1 hanya boleh ditandai QA + TL** (test plan §4).
3. **Owner** = divisi pemilik modul (BE Auth, BE Campaign, BE Payment, BE Disbursement, BE Infra, BC, FE). Issue tidak
   di-assign ke akun pribadi dari dokumen ini; divisi yang mengambil.
4. **SLA:** S1 diperbaiki sebelum demo/rilis apa pun (demo ditahan) · S2 sebelum gate berikutnya · S3/S4 masuk backlog.
5. **Selesai** = PR dengan key BFD + test yang membuktikan fix, CI hijau, lalu baris dipindah ke tabel *Diperbaiki* di
   `docs/BUGS.md` dengan hash commit. Issue ditutup oleh pemilik setelah merge.
6. Bug yang butuh keputusan bisnis (mis. BUG-013) dicatat dulu di `docs/DECISIONS.md` sebelum dikerjakan.

## Issue terbuka

| Issue | Bug | Severity | Area | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| [#33](https://github.com/Fundchainbinus/fundchain/issues/33) | QA-001 — Repo public sementara workflow DB backup mengunggah dump (terenkripsi) sebagai artifact | S2 | infra | TL + BE Infra | Open, butuh keputusan TL |
| [#34](https://github.com/Fundchainbinus/fundchain/issues/34) | QA-002 — Cron tick, relayer balance, DB backup belum pernah jalan lewat `schedule` | S2 | infra | BE Infra | Open |
| [#27](https://github.com/Fundchainbinus/fundchain/issues/27) | BUG-009 — `GET /me/donations` tanpa batas, memuat relasi penuh | S3 | api, perf | BE Donation | Open |
| [#28](https://github.com/Fundchainbinus/fundchain/issues/28) | BUG-010 — `GET /me/points` menjumlah di JS | S3 | api, perf | BE Donation | Open |
| [#29](https://github.com/Fundchainbinus/fundchain/issues/29) | BUG-011 — `completeExpired` / `softDeleteFrozen` tanpa batas per tick | S3 | api, perf | BE Campaign | Open |
| [#30](https://github.com/Fundchainbinus/fundchain/issues/30) | BUG-012 — `listForCampaign` / `milestones` tanpa `take` | S3 | api, perf | BE Disbursement | Open |
| [#31](https://github.com/Fundchainbinus/fundchain/issues/31) | BUG-013 — `expireStale`: SETTLED nominal salah diproses ulang tiap tick | S3 | api, payments | BE Payment | Open, butuh keputusan bisnis |
| [#32](https://github.com/Fundchainbinus/fundchain/issues/32) | BUG-014 — Index yang direkomendasikan belum ada | S3 | db, perf | BE Infra | Open |

BUG-009..014 dicek ulang terhadap `main` @ `9fdba90` (22 Nov 2026) dan masih terjadi. BUG-015 sudah FIXED (banner
verify-all membaca `hasMore`), jadi tidak dibuatkan issue.

## Ringkasan

| Severity | Open | Fixed (BUGS.md) |
| --- | --- | --- |
| S1 | **0** | — |
| S2 | 2 | — |
| S3 | 6 | — |
| S4 | 0 | — |
| Riwayat BUGS.md (skala High/Medium/Low) | — | 9 (BUG-001..008, BUG-015) |

**S1 outstanding = 0.**

## Catatan triase (bukan bug)

| ID | Catatan | Tindak lanjut |
| --- | --- | --- |
| T-1 | DB production berisi 1 donasi `TAMPERED` dan 1 campaign `FROZEN`. Audit log mencatat `INTEGRITY_TAMPERED` sejak 2 Okt 2026 dan `CAMPAIGN_FROZEN` (2 Okt, 7 Okt). Ini perilaku yang benar dari integrity checker terhadap data yang diubah saat uji tamper, bukan defect kode | Tim BC mengonfirmasi asalnya dan memutuskan: biarkan sebagai bukti fitur, atau pulihkan lewat alur resmi. Jangan ubah DB langsung |
| T-2 | Login Google menerima akun non-BINUS (D-006); kasus AUTH-02 di test plan tidak berlaku | Keputusan PM, catat di DECISIONS bila dibatasi |
| T-3 | Gateway down saat expiry → EXPIRED (bukan PENDING seperti test plan §7), sesuai D-005 | Tidak ada aksi; test plan perlu diselaraskan |
