# TEST PLAN — FundChain Prototype

Version: 0.2 | Owner: QA | Approver: TL + PM
Canonical version: CANONICAL_VERSION=1

## 0. Assumptions & Dependencies

Test plan ini mengasumsikan hal-hal berikut **sudah ada** sebelum testing dimulai:

- `PAYMENT_PROVIDER=mock` diimplementasi (untuk Gate 1)
- `BLOCKCHAIN_NETWORK=localhost` diimplementasi (untuk Gate 1)
- `DEMO_MODE` persona switcher di backend (fallback SSO)
- `packages/shared/src/canonical.test.ts` ada di repo
- Supabase RLS aktif di staging

Kalau salah satu belum ada → **Gate 1 tidak bisa dimulai**. Flag ke TL.

## 1. Scope

Auth (demo mode) · campaign lifecycle · donation · payment (mock + Pakasir) · disbursement · blockchain notarization · integrity check · admin · E2E.

## 2. Out of Scope

- SSO BINUS asli (masih demo mode)
- Mainnet (hanya Sepolia + local Hardhat)
- Mobile native · email notification · multi-currency
- Refund otomatis (Pakasir refund manual)
- Load/stress test

## 3. Gates

### Gate 1 — Integration
- **Entry:** mock payment adapter jalan · kontrak deploy local Hardhat · DB migrate + seed
- **Exit:** donation PAID → notarize → integrity VERIFIED, semua automated
- **Owner:** QA · **Approver:** TL

### Gate 2 — Payment + Tamper
- **Entry:** Gate 1 lolos · Pakasir sandbox credential tersedia
- **Exit:** webhook valid → PAID · webhook palsu/dobel/mismatch → reject · tamper simulation → TAMPERED + FROZEN
- **Owner:** QA · **Approver:** TL

### Gate 3 — Demo E2E + Fallback
- **Entry:** Gate 2 lolos · fallback matrix di-test
- **Exit:** full demo script jalan · fallback tested · video backup ada
- **Owner:** QA + PM · **Approver:** TL

## 4. Severity

- **S1** = demo/rilis ditahan (canonical mismatch · notarize gagal total · RLS bypass · Pakasir reject valid payment)
- **S2** = fitur utama rusak
- **S3** = minor
- **S4** = cosmetic

S1 hanya boleh ditandai oleh: **QA + TL**.

## 5. Environment

- Local Hardhat (chainId 31337)
- Sepolia (chainId 11155111)
- Staging Vercel (apps/web preview)
- Pakasir sandbox
- Supabase (staging, RLS aktif)

## 6. Test Vector Canonical Payload

**Format v1:** `v1|donationId|integritySubjectId|amount|donatedAtUnix`
**Referensi:** `packages/shared/src/canonical.test.ts`

**Aturan:** perubahan canonical wajib naikkan `CANONICAL_VERSION`. Test vector frozen — hash lama tetap diverifikasi dengan versi lama.

## 7. Pakasir — Catatan Khusus

- Webhook **TIDAK** membawa signature. Verifikasi = re-fetch ke `/transactiondetail`.
- Wajib test: webhook palsu · webhook dobel · amount mismatch · `PAKASIR_PROJECT` mismatch · Pakasir down saat re-fetch.
- Pakasir down → expected: **PENDING, bukan reject**. Flag ke BE Payment.

## 8. Unit Tests per Domain

### Auth
- valid BINUS account
- non-BINUS account → 401
- role mapping (STUDENT vs ADMIN)
- expired session
- missing cookie

### Campaign
- valid creation
- invalid target (≤0, >1e9)
- expired deadline
- valid submit (PENDING_REVIEW)
- invalid status transition
- edit rejected campaign → boleh
- edit active campaign → reject

### Donation
- positive amount
- invalid amount (<10_000)
- inactive campaign → 409
- duplicate processing (idempotency-key sama) → replay
- amount > balance (kalau dari wallet)

### Payment
- valid signature → settle
- invalid signature → 401
- duplicate webhook → idempotent 200
- mismatched amount → 400
- unknown order_id → 404
- webhook expiry → mark EXPIRED

### Blockchain
- deterministic hash (test vector frozen)
- successful notarization
- duplicate notarization → revert `AlreadyNotarized`
- zero hash → revert `ZeroHash`
- non-relayer call → revert `AccessControl`
- retry after failure (5x backoff)
- confirmation handling (wait 2 blocks)

### Integrity
- matching hash → VERIFIED
- mismatching hash → TAMPERED
- frozen campaign after mismatch
- unfreeze manual oleh admin
- disbursement locked saat frozen

### Disbursement
- eligible campaign → request sukses
- frozen campaign → 409
- missing proof → 400
- amount > sisa saldo → 400
- admin approve → APPROVED
- admin reject → REJECTED + reason
- double approve → 409

## 9. Integration Tests

1. Campaign submission → review
2. Payment webhook → PAID
3. PAID → blockchain queue
4. Worker → Sepolia (atau localhost)
5. txHash → database
6. Integrity verification
7. Disbursement eligibility

## 10. E2E Flow

```
Login
→ Create Campaign
→ Submit
→ Admin Approve
→ Browse
→ Donate
→ Payment
→ PAID
→ Blockchain Notarize
→ VERIFIED
→ Request Disbursement
→ Admin Approve
→ PAID
```

## 11. Tamper Scenario (Concrete)

```
Original Amount  = 100000
Blockchain Hash  = A

Database Amount  = 900000
Recomputed Hash  = B

A ≠ B
→ integrity_status = TAMPERED
→ campaign.status  = FROZEN
→ disbursement     = LOCKED
→ audit_log        = INTEGRITY_TAMPERED
```

**Expected output di endpoint `/admin/donations/:id/verify`:**
```json
{ "status": "TAMPERED", "currentHash": "0xB...", "onChainHash": "0xA...", "campaignFrozen": true }
```

## 12. Security Tests

- **IDOR** — akses donation/campaign milik user lain → 403
- **Unauthorized admin** — endpoint admin tanpa role → 403
- **Forged webhook** — signature invalid → 401
- **Duplicate webhook** — idempotent 200
- **Malicious file** — upload non-PDF / PDF dengan malware → reject
- **Rate-limit bypass** — spam verify endpoint → 429
- **Secret exposure** — cek `.env` gak ke-commit · cek response error gak bocorin stack trace
- **SQL injection** — query lewat Prisma parameterized → aman
- **Session hijack** — cookie httpOnly + Secure + SameSite → gagal akses via JS

## 13. Fallback Matrix

| Komponen | Fallback | Test Case | Owner | Status |
|---|---|---|---|---|
| SSO BINUS | `DEMO_MODE` persona switcher | login tanpa SSO | BE Auth | - |
| Pakasir | `PAYMENT_PROVIDER=mock` | simulasi bayar | BE Payment | - |
| Sepolia | `BLOCKCHAIN_NETWORK=localhost` | notarize Hardhat | BC | - |
| Supabase | PGlite / Docker | migrate + seed | BE Infra | - |

## 14. Deliverable Siap-Test per Domain

| Domain | Deliverable | Owner | Ready | Tested |
|---|---|---|---|---|
| Auth | demo persona switch | BE Auth | - | - |
| Campaign | create + review | BE Campaign | - | - |
| Payment | mock + Pakasir | BE Payment | - | - |
| Blockchain | notarize + verify | BC | - | - |
| Integrity | check + freeze | BE/BC | - | - |
| FE Public | catalog, detail, proof | FE 1 | - | - |
| FE Admin | dashboard, integrity | FE 2 | - | - |

## 15. Sign-off

**QA** (test pass) + **TL** (arsitektur & rilis) + **PM** (prioritas & fallback).

S1 outstanding = demo ditahan. Fallback wajib tested.