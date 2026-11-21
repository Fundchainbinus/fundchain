# Test Matrix FundChain (BFD-4, BFD-62, BFD-80)

> Disusun oleh tech lead mewakili QA, 22 Nov 2026.

Sumber kasus: [`12-TESTING-PLAN.md`](../../FundChain_Complete_Planning_Docs/12-TESTING-PLAN.md) §8–§12, ditambah
semua file test otomatis di repo. Status otomatis diambil dari run CI terakhir di `main`.

## Dasar status

| Sumber | Nilai |
| --- | --- |
| CI terakhir di `main` | [run 44928137356](https://github.com/Fundchainbinus/fundchain/actions/runs/44928137356), workflow `ci.yml`, commit `9fdba90` (merge PR #26), 21 Nov 2026 17:05 UTC, **success** (job: Typecheck & test, Seed smoke test, Secret scan) |
| Test api (vitest) | 19 file, **322 passed / 0 failed** (CI run di atas, diulang lokal 22 Nov: sama) |
| Test shared (vitest) | 1 file, **12 passed / 0 failed** (CI run di atas) |
| Test contracts (Hardhat) | 2 file, **19 passing**, coverage `DonationRegistry.sol` **100% stmt / 100% branch / 100% func / 100% line**. **Tidak dijalankan CI** (`ci.yml` tidak punya job contracts); hasil dari `npx hardhat coverage` lokal 22 Nov 2026 |
| Test web | **Tidak ada.** `apps/web` belum punya unit test, dan folder `e2e/` belum ada di repo |

Legenda status: ✅ PASS = test otomatis hijau (CI run 44928137356, atau "lokal" untuk contracts) ·
🟡 pending gate = belum ada test otomatis; diverifikasi manual saat eksekusi gate
([`GATE-1.md`](GATE-1.md), [`GATE-2.md`](GATE-2.md), [`GATE-3.md`](GATE-3.md)) · ➖ N/A = di luar desain saat ini (lihat catatan).

Singkatan file: `api/` = `apps/api/src/`, `sh/` = `packages/shared/src/`, `ct/` = `contracts/test/`.

## A. Kasus dari test plan

### Auth (§8)

| ID | Area | Kasus | Tipe | Test otomatis (file › test) | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH-01 | Auth | Login akun valid (Google, D-006) → cookie sesi | unit | `api/auth-session.test.ts` › *POST /auth/google memasang cookie httpOnly…* | ✅ | |
| AUTH-02 | Auth | Akun non-BINUS → 401 | manual | Tidak ada. Login Google menerima email terverifikasi apa pun (D-006), tanpa filter domain | ➖ perlu konfirmasi PM | |
| AUTH-03 | Auth | Role mapping STUDENT vs ADMIN | unit | `api/auth.test.ts` › *meneruskan token valid… (role dari DB)*, *@Roles('ADMIN') -> 403 untuk STUDENT* | ✅ | |
| AUTH-04 | Auth | Sesi kedaluwarsa / dicabut | unit | `api/auth-session.test.ts` › *menolak token dengan sessionVersion basi (401)*, *POST /auth/logout menaikkan sessionVersion…* | ✅ | |
| AUTH-05 | Auth | Tanpa cookie/token → 401 | unit | `api/auth.test.ts` › *401 AUTH_UNAUTHENTICATED tanpa header Authorization* | ✅ | |
| AUTH-06 | Auth | DEMO_MODE persona switcher (fallback SSO) | unit | `api/auth-session.test.ts` › *DEMO_MODE (BFD-12)* (6 test) | ✅ | |

### Campaign (§8)

| ID | Area | Kasus | Tipe | Test otomatis | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| CMP-01 | Campaign | Buat campaign valid | e2e | — | 🟡 GATE-3 | |
| CMP-02 | Campaign | Target tidak valid (≤0, >1e9) | e2e | — (validasi DTO; skema dicek `api/openapi.test.ts` › *classValidatorShim*) | 🟡 GATE-3 | |
| CMP-03 | Campaign | Deadline lewat | e2e | — | 🟡 GATE-3 | |
| CMP-04 | Campaign | Submit → PENDING_REVIEW | unit | `api/core.test.ts` › *state machine campaign › mengizinkan transisi yang sah* | ✅ | |
| CMP-05 | Campaign | Transisi status ilegal → 409 | unit | `api/core.test.ts` › *menolak transisi ilegal*; `api/domain.test.ts` › *approve campaign DRAFT ditolak 409* | ✅ | |
| CMP-06 | Campaign | Edit campaign REJECTED → boleh | e2e | — | 🟡 GATE-3 | |
| CMP-07 | Campaign | Edit campaign ACTIVE → ditolak | e2e | — | 🟡 GATE-3 | |
| CMP-08 | Campaign | Hapus campaign (DRAFT/REJECTED saja, pemilik saja) | unit | `api/domain.test.ts` › *CampaignsService.remove (BFD-13)* (10 test) | ✅ | |

### Donation (§8)

| ID | Area | Kasus | Tipe | Test otomatis | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| DON-01 | Donation | Nominal positif | e2e | — | 🟡 GATE-1 | |
| DON-02 | Donation | Nominal < 10.000 ditolak | e2e | — (skema `api/openapi.test.ts` › *CreateDonationDto punya amount*) | 🟡 GATE-1 | |
| DON-03 | Donation | Campaign tidak aktif → 409 | e2e | — | 🟡 GATE-1 | |
| DON-04 | Donation | Idempotency-Key sama → replay | unit | `api/domain.test.ts` › *race Idempotency-Key (BFD-17/46)* (3 test) | ✅ | BUG-001 (fixed) |
| DON-05 | Donation | Nominal > saldo wallet | — | Tidak ada wallet di desain | ➖ | |
| DON-06 | Donation | "Donasi Saya" dibatasi/paginasi | unit | — | 🟡 | [#27](https://github.com/Fundchainbinus/fundchain/issues/27) BUG-009 |

### Payment (§7, §8)

| ID | Area | Kasus | Tipe | Test otomatis | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-01 | Payment | Webhook valid → settle (PAID, hash, outbox) | unit | `api/payments-flow.test.ts` › *PENDING → PAID…* | ✅ | |
| PAY-02 | Payment | Signature tidak valid → ditolak | unit | `api/payments-flow.test.ts` › *webhook dengan signature tidak valid…*; `api/core.test.ts` › *signature webhook mock* | ✅ | |
| PAY-03 | Payment | Webhook dobel → idempotent | unit | `api/payments-flow.test.ts` › *idempotency webhook ganda* (3 test) | ✅ | BUG-002 (fixed) |
| PAY-04 | Payment | Nominal tidak cocok → 400 | unit | `api/payments-flow.test.ts` › *nominal webhook ≠ nominal di DB…*, *nominal bukan angka (NaN)* | ✅ | |
| PAY-05 | Payment | order_id tidak dikenal → 404 | unit | `api/payments-flow.test.ts` › *order tidak dikenal → PAYMENT_NOT_FOUND* | ✅ | |
| PAY-06 | Payment | Lewat expiry → EXPIRED | unit | `api/payments-flow.test.ts` › *expireStale* (4 test) | ✅ | [#31](https://github.com/Fundchainbinus/fundchain/issues/31) BUG-013 |
| PAY-07 | Payment | Pakasir: webhook palsu (re-fetch masih pending) | unit | `api/payments.test.ts` › *PakasirAdapter › webhook palsu…* | ✅ | |
| PAY-08 | Payment | Pakasir: project mismatch | unit | `api/payments.test.ts` › *menolak webhook untuk project lain…* | ✅ | |
| PAY-09 | Payment | Pakasir: transaksi tidak ada | unit | `api/payments.test.ts` › *menolak webhook bila transaksi tidak ada di Pakasir* | ✅ | |
| PAY-10 | Payment | Gateway down saat re-fetch → tetap PENDING | unit | Sebagian. Saat expiry, `expireStale` menganggap gateway down = EXPIRED (`api/payments-flow.test.ts` › *fetchStatus gagal (gateway down) → dianggap EXPIRED*), sesuai D-005 (QR 15 menit sudah tidak bisa dibayar). Jalur webhook saat gateway down belum dites | 🟡 | |
| PAY-11 | Payment | Refund PAID → REFUNDED (D-001) | unit | `api/payments.test.ts` › *PaymentsService.refund* (6 test) | ✅ | BUG-002 (fixed) |
| PAY-12 | Payment | Adapter Sakurupiah (D-002) | — | Adapter belum ada di `apps/api/src/modules/payments/adapters/` | 🟡 | lihat RISK R-01 |

### Blockchain (§8)

| ID | Area | Kasus | Tipe | Test otomatis | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| BC-01 | Blockchain | Hash deterministik, test vector beku | unit | `sh/canonical.test.ts` (12 test, termasuk cross-check Remix) | ✅ | |
| BC-02 | Blockchain | Notarisasi sukses | unit | `ct/DonationRegistry.test.ts` › *notarize menyimpan hash dan emit event* (lokal); `api/notarization.worker.test.ts` › *QUEUED -> CONFIRMED…* | ✅ | |
| BC-03 | Blockchain | Notarisasi ganda → `AlreadyNotarized` | unit | `ct/DonationRegistry.test.ts` › *revert AlreadyNotarized…* (lokal); `api/notarization.worker.test.ts` › *revert AlreadyNotarized -> CONFIRMED* | ✅ | |
| BC-04 | Blockchain | Hash nol → `ZeroHash` | unit | `ct/DonationRegistry.test.ts` › *revert ZeroHash* (lokal); worker › *revert ZeroHash -> langsung FAILED* | ✅ | |
| BC-05 | Blockchain | Non-relayer → AccessControl | unit | `ct/DonationRegistry.test.ts` › *non-relayer (termasuk admin) ditolak* (lokal) | ✅ | |
| BC-06 | Blockchain | Retry 5x backoff | unit | `api/notarization.worker.test.ts` › *retry dan backoff* (5 test) | ✅ | |
| BC-07 | Blockchain | Tunggu 2 konfirmasi | unit | `api/blockchain-worker.test.ts` › *BFD-48: block confirmations* (7 test) | ✅ | |
| BC-08 | Blockchain | Error relayer (nonce, underpriced, saldo habis) | unit | `api/blockchain-relayer-errors.test.ts` (30), `api/blockchain-worker.test.ts` › *BFD-49* (12) | ✅ | |
| BC-09 | Blockchain | Rotasi RELAYER_ROLE | unit | `ct/RelayerRole.test.ts` (9 test, lokal) | ✅ | |
| BC-10 | Blockchain | Biaya gas disimpan (BFD-92) | unit | `api/blockchain-worker.test.ts` › *BFD-92* (5), `api/blockchain-fees.test.ts` (5) | ✅ | |
| BC-11 | Blockchain | Alert tx macet > 10 menit, retry admin | unit | `api/notarization.worker.test.ts` › *alert notarisasi macet* (7); `api/blockchain-retry.test.ts` (10) | ✅ | |
| BC-12 | Blockchain | Notarisasi nyata di Sepolia | manual | Bukti read-only [`SEPOLIA-E2E.md`](../blockchain/evidence/SEPOLIA-E2E.md): 16 event `DonationNotarized`, 3 sampel `verify()` MATCH | ✅ (bukti manual) | |

### Integrity (§8, §11)

| ID | Area | Kasus | Tipe | Test otomatis | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| INT-01 | Integrity | Hash cocok → VERIFIED | unit | `api/integrity.test.ts` › *data asli → VERIFIED tanpa freeze* | ✅ | |
| INT-02 | Integrity | Hash beda → TAMPERED (skenario §11) | unit | `api/integrity.test.ts` › *nominal diubah di DB → TAMPERED, campaign dibekukan…* | ✅ | |
| INT-03 | Integrity | Campaign FROZEN setelah mismatch | unit | idem + *freeze mencatat frozenAt dan User-Agent* | ✅ | |
| INT-04 | Integrity | Unfreeze manual admin | unit | `api/integrity.test.ts` › *unfreeze ditolak selama masih ada donasi TAMPERED*, *unfreeze setelah data pulih…* | ✅ | |
| INT-05 | Integrity | Pencairan terkunci saat FROZEN | unit | `api/core.test.ts` › *FROZEN mengunci pencairan dengan kode CAMPAIGN_FROZEN* | ✅ | |
| INT-06 | Integrity | Checker otomatis, batch, RPC mati | unit | `api/integrity.test.ts` › *hash checker otomatis* (5) | ✅ | |
| INT-07 | Integrity | Proof API publik | unit | `api/integrity.test.ts` › *Proof API* (3) | ✅ | |
| INT-08 | Integrity | Verify-all dibatasi 100 + `hasMore` | unit | `api/perf.test.ts` › *IntegrityService.verifyMany* (3) | ✅ | BUG-006, BUG-015 (fixed) |

### Disbursement (§8)

| ID | Area | Kasus | Tipe | Test otomatis | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| DSB-01 | Disbursement | Campaign eligible → request sukses | unit | `api/core.test.ts` › *hanya ACTIVE/COMPLETED yang eligible*; `api/storage.test.ts` › *DisbursementsService.create dengan fileId…* | ✅ | |
| DSB-02 | Disbursement | Campaign FROZEN → 409 | unit | `api/core.test.ts` › *FROZEN mengunci pencairan…* | ✅ | |
| DSB-03 | Disbursement | Tanpa bukti → 400 | unit | `api/storage.test.ts` › *tanpa file & tanpa fileId → DISBURSEMENT_PROOF_REQUIRED* | ✅ | |
| DSB-04 | Disbursement | Nominal > sisa saldo → 400 | e2e | — | 🟡 GATE-3 | |
| DSB-05 | Disbursement | Admin approve → APPROVED | e2e | — (dipakai tidak langsung oleh DSB-07) | 🟡 GATE-3 | |
| DSB-06 | Disbursement | Admin reject + alasan | e2e | — | 🟡 GATE-3 | |
| DSB-07 | Disbursement | Approve dua kali → 409 | unit | `api/domain.test.ts` › *APPROVE dua kali → yang kedua 409* | ✅ | |
| DSB-08 | Disbursement | Milestone bertahap (BFD-97) | unit | `api/core.test.ts` › *milestone pencairan bertahap* (3) | ✅ | [#30](https://github.com/Fundchainbinus/fundchain/issues/30) BUG-012 |

### Integrasi (§9) dan E2E (§10)

| ID | Area | Kasus | Tipe | Test otomatis | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| INTG-01 | Integrasi | Campaign submit → review | e2e | — | 🟡 GATE-1 | |
| INTG-02 | Integrasi | Webhook → PAID | unit | `api/payments-flow.test.ts` › *PENDING → PAID…* | ✅ | |
| INTG-03 | Integrasi | PAID → antrean blockchain | unit | idem (*outbox QUEUED*) | ✅ | |
| INTG-04 | Integrasi | Worker → Sepolia/localhost | unit + manual | `api/notarization.worker.test.ts` (RPC di-stub) + BC-12 | ✅ | |
| INTG-05 | Integrasi | txHash → database | unit | worker › *menyimpan txHash dan blockNumber* | ✅ | |
| INTG-06 | Integrasi | Verifikasi integritas | unit | INT-01..02 | ✅ | |
| INTG-07 | Integrasi | Eligibility pencairan | unit | DSB-01..02 | ✅ | |
| INTG-08 | Integrasi | Migrate + seed ke Postgres kosong, seed idempoten (mock + localhost) | CI | `ci.yml` › job *Seed smoke test* | ✅ | |
| E2E-01 | E2E | Alur penuh §10 (login → … → pencairan PAID) | e2e | Belum ada test otomatis web | 🟡 [`GATE-3.md`](GATE-3.md), [`E2E-REFUND-MILESTONE.md`](E2E-REFUND-MILESTONE.md) | |
| E2E-02 | E2E | Demo tamper end-to-end | manual | [`TAMPER-DEMO-RUNBOOK.md`](../blockchain/TAMPER-DEMO-RUNBOOK.md); guard di `api/blockchain-demo-tamper.test.ts` (6) | 🟡 GATE-2 | |

### Security (§12)

Detail eksekusi: [`SECURITY-TEST.md`](SECURITY-TEST.md).

| ID | Area | Kasus | Tipe | Test otomatis | Status | Bug |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | Security | IDOR file/campaign milik orang lain → 403 | unit | `api/storage.test.ts` › *bukti pencairan: anonim 401, orang lain 403*; `api/domain.test.ts` › *bukan pemilik ditolak 403* | ✅ (donasi: 🟡) | |
| SEC-02 | Security | Endpoint admin tanpa role → 403 | unit | `api/auth.test.ts`, `api/blockchain-retry.test.ts` › *STUDENT -> 403* | ✅ | |
| SEC-03 | Security | Webhook palsu | unit | PAY-02, PAY-07 | ✅ | |
| SEC-04 | Security | Webhook dobel | unit | PAY-03 | ✅ | |
| SEC-05 | Security | File berbahaya / bukan PDF | unit | `api/domain.test.ts` › *magic bytes bukan PDF*; `api/storage.test.ts` › *attach … verifikasi magic bytes* (7) | ✅ | |
| SEC-06 | Security | Spam endpoint → 429 | manual | Hanya metadata throttle dicek (`api/auth.test.ts` › *throttle khusus 10/menit*) | 🟡 | |
| SEC-07 | Security | Secret tidak ter-commit, default secret di prod | CI + unit | `ci.yml` › *Secret scan (gitleaks)*; `api/auth.test.ts` › *insecureDefaultWarnings* | ✅ | |
| SEC-08 | Security | SQL injection | manual | Prisma parameterized; tidak ada `$queryRawUnsafe` yang dites | 🟡 | |
| SEC-09 | Security | Cookie httpOnly + Secure, CSRF | unit | `api/auth-session.test.ts` › *cookie Secure*, *CSRF untuk auth cookie* (7) | ✅ | |
| SEC-10 | Security | RLS deny-all (D-003) | unit | `api/rls.test.ts` (8) | ✅ | |
| SEC-11 | Security | Script tamper menolak DB production | unit | `api/blockchain-demo-tamper.test.ts` (6) | ✅ | |
| SEC-12 | Security | Error tidak membocorkan stack trace | manual | — | 🟡 | |

## B. Inventaris file test otomatis

| File | Area / fitur | BFD / BR | Jumlah test | Status |
| --- | --- | --- | --- | --- |
| `apps/api/src/auth-session.test.ts` | Sesi cookie, CSRF, logout, DEMO_MODE | BFD-11, BFD-12 | 29 | ✅ CI |
| `apps/api/src/auth.test.ts` | Guard, role, audit filter, default secret, API docs | BFD-25, BFD-44 | 20 | ✅ CI |
| `apps/api/src/blockchain-demo-tamper.test.ts` | Guard script demo tamper | BFD-53, BFD-105 | 6 | ✅ CI |
| `apps/api/src/blockchain-fees.test.ts` | Statistik biaya gas | BFD-92 | 5 | ✅ CI |
| `apps/api/src/blockchain-relayer-errors.test.ts` | Klasifikasi error relayer, bump fee | BFD-49 | 30 | ✅ CI |
| `apps/api/src/blockchain-retry.test.ts` | Retry notarisasi oleh admin | BFD-49 | 10 | ✅ CI |
| `apps/api/src/blockchain-worker.test.ts` | Konfirmasi blok, error relayer, saldo, gas | BFD-48, 49, 73, 92 | 26 | ✅ CI |
| `apps/api/src/campaign-list.test.ts` | List campaign (N+1, integritySummary) | BFD-56, BFD-58 | 5 | ✅ CI |
| `apps/api/src/common/bc-local-config.test.ts` | Guard env stack bc-local | — | 5 | ✅ CI |
| `apps/api/src/core.test.ts` | State machine, eligibility, milestone, poin, signature mock | BFD-97, BFD-98 | 13 | ✅ CI |
| `apps/api/src/domain.test.ts` | Hapus campaign, validasi file, disbursement, idempotency | BFD-13, BFD-17, BFD-46 | 19 | ✅ CI |
| `apps/api/src/integrity.test.ts` | Tamper → FROZEN, checker, proof API, unfreeze | Gate 2 (BR tamper §11) | 16 | ✅ CI |
| `apps/api/src/notarization.worker.test.ts` | Worker: sukses, retry, idempotency, tx macet | — | 30 | ✅ CI |
| `apps/api/src/openapi.test.ts` | Skema OpenAPI dari DTO | BFD-44 | 4 | ✅ CI |
| `apps/api/src/payments-flow.test.ts` | Settle, webhook ganda, mismatch, expiry | BFD-20, BFD-22 | 14 | ✅ CI |
| `apps/api/src/payments.test.ts` | Refund, adapter mock & Pakasir | BFD-75 (D-001) | 22 | ✅ CI |
| `apps/api/src/perf.test.ts` | Index, batas query | BFD-76 | 27 | ✅ CI |
| `apps/api/src/rls.test.ts` | RLS deny-all di migrasi | BFD-23 | 8 | ✅ CI |
| `apps/api/src/storage.test.ts` | Driver storage, upload URL, magic bytes, akses file | BFD-15, BFD-42 | 33 | ✅ CI |
| `packages/shared/src/canonical.test.ts` | Canonical payload v1, test vector beku | BFD-26 | 12 | ✅ CI |
| `contracts/test/DonationRegistry.test.ts` | Kontrak: notarize, revert, role, fuzz | — | 10 | ✅ lokal (bukan CI) |
| `contracts/test/RelayerRole.test.ts` | Rotasi RELAYER_ROLE + script | BFD-29 | 9 | ✅ lokal (bukan CI) |
| **Total** | | | **353** | 334 di CI, 19 lokal |

Tambahan di CI: job *Seed smoke test* (migrate + seed 2x ke Postgres kosong) dan *Secret scan (gitleaks)*, keduanya ✅ pada run 44928137356.

## C. Rekap

| Kelompok | Kasus | ✅ PASS | 🟡 pending gate | ➖ N/A |
| --- | --- | --- | --- | --- |
| Auth | 6 | 5 | 0 | 1 |
| Campaign | 8 | 3 | 5 | 0 |
| Donation | 6 | 1 | 4 | 1 |
| Payment | 12 | 10 | 2 | 0 |
| Blockchain | 12 | 12 | 0 | 0 |
| Integrity | 8 | 8 | 0 | 0 |
| Disbursement | 8 | 5 | 3 | 0 |
| Integrasi + E2E | 10 | 7 | 3 | 0 |
| Security | 12 | 9 | 3 | 0 |
| **Total** | **82** | **60** | **20** | **2** |

- Test otomatis: **353** (api 322 + shared 12 + contracts 19), 0 gagal.
- Celah utama: web tanpa test, validasi DTO (campaign/donasi) dan approve/reject pencairan hanya dicek manual, contracts tidak masuk CI.
- **S1 outstanding = 0.** Tidak ada bug terbuka berlabel S1 (lihat [`BUG-TRIAGE.md`](BUG-TRIAGE.md)). Satu donasi TAMPERED
  dan satu campaign FROZEN di production adalah hasil uji tamper (audit `INTEGRITY_TAMPERED`/`CAMPAIGN_FROZEN` sejak
  2 Okt 2026): sistem bekerja sesuai desain, bukan defect. Asal datanya tetap perlu dikonfirmasi tim BC (BUG-TRIAGE, catatan T-1).
