# API Specification

**Base:** `/api/v1` · **Dev:** `http://localhost:3000` · **Prod:** `https://api.fundchain.id`

**Envelope:** `{ success: true, data }` · `{ success: false, error: { code, message } }`

**Auth:** session cookie httpOnly (`fundchain_session`), SameSite=Lax, Secure di prod, Max-Age 8 jam.

## 1. Auth

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/auth/login` | Public | 302 ke Microsoft OAuth |
| GET | `/auth/callback` | Public | Handle callback, set cookie, redirect |
| POST | `/auth/logout` | Session | 204, clear cookie |
| GET | `/auth/me` | Session | `{ user: { id, email, name, role } }` |

**Callback query:** `code` (required), `state` (required, match session).
**Errors:** `400 INVALID_STATE` · `401 AUTH_INVALID_DOMAIN` · `401 AUTH_CALLBACK_FAILED`.
    
## 2. Campaigns

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/campaigns` | Public | List (filter `status`, `sdg`, `q`, `limit`, `cursor`) |
| GET | `/campaigns/:id` | Public | Detail + documents + creator |
| POST | `/campaigns` | Student | Create (status awal DRAFT) |
| PATCH | `/campaigns/:id` | Owner | Edit — DRAFT/REJECTED only |
| POST | `/campaigns/:id/submit` | Owner | Submit → PENDING_REVIEW |
| POST | `/campaigns/:id/documents` | Owner | Upload PDF (multipart, max 5MB) |

**POST /campaigns body:** `{ title, description, sdgCategory, targetAmount, deadline }`
**Validation:** title 5-200 chars · description min 20 · sdgCategory enum (17 SDG) · targetAmount positive ≤ 1e9 · deadline future ISO.

**GET /campaigns response:**
```json
{ "campaigns": [ { "id", "title", "description", "sdgCategory",
  "targetAmount", "currentAmount", "deadline", "status", "createdAt" } ],
  "nextCursor": "..." }
```

## 3. Admin Review

| Method | Path | Deskripsi |
|---|---|---|
| GET | `/admin/campaigns/pending` | List PENDING_REVIEW |
| GET | `/admin/campaigns/:id` | Detail + creator + reviews |
| POST | `/admin/campaigns/:id/approve` | Status → ACTIVE |
| POST | `/admin/campaigns/:id/reject` | Body `{ reason }` min 10 chars → REJECTED |

**Errors:** `403 AUTH_FORBIDDEN` · `409 CAMPAIGN_INVALID_STATUS`.

## 4. Donations

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/campaigns/:id/donations` | Student | Create donation + payment |
| GET | `/donations/:id` | Owner/Admin | Detail + payment + blockchain |
| GET | `/campaigns/:id/donations` | Public | List (pseudonymized donor) |

**POST body:** `{ amount, anonymous? }` · Header: `Idempotency-Key: <uuid>` (required).
**Validation:** amount positive integer 10_000-1_000_000_000.

**Response 201:**
```json
{ "donation": { "id", "amount", "status": "PENDING" },
  "payment": { "snapToken", "redirectUrl" } }
```

**Errors:** `409 CAMPAIGN_NOT_ACTIVE` · `400 DONATION_AMOUNT_INVALID` · `400 IDEMPOTENCY_KEY_REQUIRED` · `409 DONATION_DUPLICATE`.

## 5. Payment Webhook

**POST /webhooks/payment** — Auth: Midtrans signature.

**Body:** `{ transaction_id, order_id, status_code, gross_amount, signature_key, transaction_status, payment_type }`

**Signature:** `signature_key === sha512(order_id + status_code + gross_amount + server_key)`.

**Behavior:** verify signature → cek idempotency (`external_payment_id` SETTLED → 200 replayed) → validate amount → update Donation PAID + Payment SETTLED + Campaign.currentAmount → insert audit log → enqueue blockchain → 200.

**Errors:** `401 PAYMENT_SIGNATURE_INVALID` · `400 PAYMENT_AMOUNT_MISMATCH`.

## 6. Blockchain

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/donations/:id/blockchain` | Owner/Admin | Status: QUEUED/SUBMITTED/CONFIRMED/FAILED/RETRYING + txHash + explorerUrl |
| POST | `/admin/donations/:id/verify` | Admin | Trigger integrity check (max 10/min) |

**Verify response (VERIFIED):** `{ status: "VERIFIED", currentHash, onChainHash, checkedAt }`
**Verify response (TAMPERED):** `{ status: "TAMPERED", currentHash, onChainHash, campaignFrozen: true }` + side effects: donation TAMPERED, campaign FROZEN, audit log, disbursement locked.

## 7. Disbursement

| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/campaigns/:id/disbursement` | Owner | Request — `{ amount, proofUrl, description }` |
| GET | `/campaigns/:id/disbursement` | Owner/Admin | List |
| POST | `/admin/disbursement/:id/approve` | Admin | → APPROVED |
| POST | `/admin/disbursement/:id/reject` | Admin | Body `{ reason }` min 10 → REJECTED |

**Errors:** `409 DISBURSEMENT_NOT_ELIGIBLE` · `400 DISBURSEMENT_PROOF_REQUIRED` · `400 DISBURSEMENT_AMOUNT_EXCEEDS` · `409 CAMPAIGN_FROZEN`.

## 8. Audit

**GET /admin/audit-logs** — Auth: Admin.
Query: `actorId`, `entityType`, `entityId`, `action`, `from`, `to`, `limit` (max 200), `cursor`.
Response: `{ logs: [{ id, actor, action, entityType, entityId, metadata, ipAddress, createdAt }], nextCursor }`

## 9. Error Codes Registry

| Code | HTTP | Deskripsi |
|---|---|---|
| `AUTH_UNAUTHENTICATED` | 401 | Session invalid |
| `AUTH_FORBIDDEN` | 403 | Role gak cukup |
| `AUTH_INVALID_DOMAIN` | 401 | Bukan @binus.ac.id |
| `AUTH_CALLBACK_FAILED` | 401 | Exchange code gagal |
| `INVALID_STATE` | 400 | CSRF state mismatch |
| `CAMPAIGN_NOT_FOUND` | 404 | ID gak ada |
| `CAMPAIGN_NOT_ACTIVE` | 409 | Donasi ke non-ACTIVE |
| `CAMPAIGN_NOT_OWNED` | 403 | Bukan creator |
| `CAMPAIGN_INVALID_STATUS` | 409 | Transisi ilegal |
| `CAMPAIGN_FROZEN` | 409 | Operasi ke frozen |
| `CAMPAIGN_PROPOSAL_MISSING` | 400 | Belum upload |
| `DONATION_NOT_FOUND` | 404 | ID gak ada |
| `DONATION_AMOUNT_INVALID` | 400 | Nominal invalid |
| `DONATION_DUPLICATE` | 409 | Idempotency-Key dipakai |
| `DONATION_ALREADY_PAID` | 409 | Udah PAID |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Header wajib hilang |
| `PAYMENT_SIGNATURE_INVALID` | 401 | Signature salah |
| `PAYMENT_AMOUNT_MISMATCH` | 400 | Amount ≠ DB |
| `INVALID_FILE_TYPE` | 400 | Bukan PDF |
| `FILE_TOO_LARGE` | 400 | > 5MB |
| `BLOCKCHAIN_NOT_NOTARIZED` | 400 | Belum notarize |
| `BLOCKCHAIN_RPC_ERROR` | 503 | RPC error |
| `INTEGRITY_HASH_MISMATCH` | 409 | Hash mismatch |
| `DISBURSEMENT_NOT_ELIGIBLE` | 409 | Gak eligible |
| `DISBURSEMENT_PROOF_REQUIRED` | 400 | Bukti kosong |
| `DISBURSEMENT_AMOUNT_EXCEEDS` | 400 | > sisa saldo |
| `DISBURSEMENT_INVALID_STATUS` | 409 | Transisi ilegal |
| `VALIDATION_ERROR` | 400 | Input invalid |
| `NOT_FOUND` | 404 | Resource gak ada |
| `INTERNAL_ERROR` | 500 | Server error |