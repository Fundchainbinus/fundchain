# Integration Contract BE ↔ FE (BFD-9, BFD-63)

> Disusun oleh tech lead mewakili QA, 22 Nov 2026.

Sumber: Postman collection [`apps/api/docs/fundchain.postman_collection.json`](../../apps/api/docs/fundchain.postman_collection.json)
(dibuat oleh `apps/api/docs/generate-postman.ts` dari spec OpenAPI), dicocokkan dengan decorator di
`apps/api/src/modules/**/*.controller.ts`, dan konsumen FE dari grep `apps/web/src`. Spesifikasi awal:
[`08-API-SPEC.md`](../../FundChain_Complete_Planning_Docs/08-API-SPEC.md).

## Aturan umum

| Aturan | Isi |
| --- | --- |
| Base URL | `https://fundchain-api.vercel.app/api/v1` (production), `http://localhost:3000/api/v1` (lokal) |
| Envelope | Sukses `{ success: true, data }`; gagal `{ success: false, error: { code, message } }` (D-004). List berhalaman: `data.nextCursor` |
| Auth | Cookie sesi httpOnly (web) atau `Authorization: Bearer <token>` (Postman/script). Token didapat dari `POST /auth/google` atau `GET /auth/demo` |
| CSRF | Request non-GET yang memakai cookie wajib header `X-Requested-With: fundchain` (client web: `apps/web/src/lib/api.ts`) |
| Upload | Multipart `file`/`proof` ≤ 4 MB, atau JSON `{ fileId }` setelah upload langsung ke Supabase ≤ 10 MB (BFD-15) |
| Kolom **Auth** | `Publik` = `@Public()` (user opsional) · `Login` = wajib login · `Admin` = `@Roles('ADMIN')` · `Secret` = secret khusus, bukan sesi |

Status semua endpoint di bawah: **✅ final** (dibekukan untuk demo; perubahan kontrak wajib lewat entri baru di
`docs/DECISIONS.md` dan update Postman lewat `generate-postman.ts`).

## Endpoint

### Sistem & auth (BE Auth · `users.controller.ts`)

| Method | Path | Auth | Request | Response `data` (ringkas) | Konsumen FE | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/health` | Publik | — | `{ status, time }` | — (monitoring) | ✅ final |
| GET | `/config` | Publik | — | `{ googleClientId, devTools, demoMode, paymentProvider, chain{network, chainId, contractAddress} }` | `lib/hooks.ts` | ✅ final |
| POST | `/auth/google` | Publik (throttle 10/menit) | `GoogleLoginDto { accessToken }` | `{ token, user }` + set cookie sesi | `components/Layout.tsx` | ✅ final |
| GET | `/auth/demo?persona=student\|admin` | Publik, hanya bila DEMO_MODE aktif | query `persona` | `{ token, user }` + cookie; 404 `DEV_TOOLS_DISABLED` bila mati | `components/Layout.tsx` | ✅ final |
| GET | `/auth/me` (alias `/me`) | Login | — | `{ id, name, email, role, integritySubjectId }` | `lib/hooks.ts` (`/auth/me`); `/me` tanpa konsumen FE | ✅ final |
| POST | `/auth/logout` | Publik | — | `{}`; naikkan `sessionVersion`, hapus cookie | `components/Layout.tsx` | ✅ final |
| GET | `/admin/audit-logs` | Admin | query `actorId, entityType, entityId, action, from, to, limit(1..200), cursor` | `{ items[], nextCursor }` | `pages/admin/AdminPages.tsx` | ✅ final |
| GET | `/admin/stats` | Admin | — | agregat dashboard (campaign, donasi, integritas, biaya gas) | `pages/admin/AdminPages.tsx` | ✅ final |

### Campaign (BE Campaign · `campaigns.controller.ts`)

| Method | Path | Auth | Request | Response `data` (ringkas) | Konsumen FE | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/campaigns` | Publik | `ListCampaignsQuery { status, sdg, q, mine, limit, cursor }` | `{ campaigns[] (+integritySummary), nextCursor }` | `pages/HomePage.tsx`, `pages/MyPages.tsx` | ✅ final |
| POST | `/campaigns` | Login | `CreateCampaignDto { title, description, sdgCategory, targetAmount, deadline }` | campaign (DRAFT) | `pages/CampaignFormPage.tsx` | ✅ final |
| GET | `/campaigns/:id` | Publik (non-publik hanya pemilik/admin) | — | detail campaign + dokumen | `pages/CampaignDetailPage.tsx`, `CampaignFormPage.tsx`, `DisbursePage.tsx` | ✅ final |
| PATCH | `/campaigns/:id` | Login (pemilik, DRAFT/REJECTED) | `UpdateCampaignDto` (semua opsional) | campaign | `pages/CampaignFormPage.tsx` | ✅ final |
| DELETE | `/campaigns/:id` | Login (pemilik, DRAFT/REJECTED) | — | `{ id }`; soft-delete | Tanpa konsumen FE (belum ada tombol hapus di web) | ✅ final |
| GET | `/campaigns/:id/activity` | Publik | — | ≤ 50 entri aktivitas | `pages/CampaignDetailPage.tsx` | ✅ final |
| POST | `/campaigns/:id/documents` | Login (pemilik) | multipart `file` atau `AttachDocumentDto { fileId }` | dokumen | `pages/CampaignFormPage.tsx` | ✅ final |
| POST | `/campaigns/:id/submit` | Login (pemilik) | — | campaign (PENDING_REVIEW) | `CampaignDetailPage.tsx`, `CampaignFormPage.tsx`, `MyPages.tsx` | ✅ final |
| GET | `/documents/:id/link` | Publik (dokumen non-publik: pemilik/admin) | — | `{ url }` (signed) | `CampaignDetailPage.tsx`, `CampaignFormPage.tsx`, `admin/AdminPages.tsx` | ✅ final |
| GET | `/documents/:id/file` | Publik + URL bertanda tangan (`e`, `t`) | query `e, t` | stream file | via URL dari `/documents/:id/link` | ✅ final |
| GET | `/admin/campaigns` | Admin | `ListCampaignsQuery` | `{ campaigns[] (+proposal), nextCursor }` | `pages/admin/AdminPages.tsx` | ✅ final |
| GET | `/admin/campaigns/:id` | Admin | — | detail campaign | Tanpa konsumen FE (web memakai `/campaigns/:id`) | ✅ final |
| POST | `/admin/campaigns/:id/approve` | Admin | — | campaign (ACTIVE) | `CampaignDetailPage.tsx`, `admin/AdminPages.tsx` | ✅ final |
| POST | `/admin/campaigns/:id/reject` | Admin | `ReasonDto { reason }` | campaign (REJECTED) | `CampaignDetailPage.tsx`, `admin/AdminPages.tsx` | ✅ final |
| POST | `/admin/campaigns/:id/freeze` | Admin | `ReasonDto { reason }` | campaign (FROZEN) | `CampaignDetailPage.tsx` | ✅ final |
| POST | `/admin/campaigns/:id/unfreeze` | Admin | `ReasonDto { reason }` | campaign; 409 bila masih ada donasi TAMPERED | `CampaignDetailPage.tsx` | ✅ final |

### Donasi & pembayaran (BE Payment · `donations.controller.ts`)

| Method | Path | Auth | Request | Response `data` (ringkas) | Konsumen FE | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/campaigns/:id/donations` | Login | `CreateDonationDto { amount, anonymous? }` + header `Idempotency-Key` | donasi PENDING + `payment { qrString, paymentUrl, expiresAt }` | `pages/CampaignDetailPage.tsx` | ✅ final |
| GET | `/campaigns/:id/donations` | Publik | — | donasi PAID (nama dipseudonimkan) | `pages/CampaignDetailPage.tsx` | ✅ final |
| GET | `/donations/:id` | Publik (detail penuh: donatur/admin) | — | donasi + status payment & blockchain | `PaymentPage.tsx`, `DonationProofPage.tsx`, `CampaignDetailPage.tsx` | ✅ final |
| GET | `/donations/:id/blockchain` | Publik | — | `{ status, txHash, blockNumber, explorerUrl }` | Tanpa konsumen FE (data sudah ada di `/donations/:id` dan `/proof`) | ✅ final |
| GET | `/donations/:id/proof` | Publik | — | `{ hashDb, hashOnChain, match, txHash, timestamp, explorerUrl }` | `pages/DonationProofPage.tsx` | ✅ final |
| GET | `/me/donations` | Login | — | daftar donasi milik user (belum berhalaman, [#27](https://github.com/Fundchainbinus/fundchain/issues/27)) | `pages/HomePage.tsx` | ✅ final |
| GET | `/me/points` | Login | — | `{ total, entries[] }` poin comserve | `lib/points.ts` | ✅ final |
| GET | `/admin/donations` | Admin | query `campaignId, integrityStatus` | daftar donasi + integritas | `pages/admin/AdminPages.tsx` | ✅ final |
| POST | `/admin/donations/:id/refund` | Admin | `RefundDto { reason }` | donasi REFUNDED (D-001) | Tanpa konsumen FE (Postman/admin manual) | ✅ final |
| POST | `/webhooks/payment` | Secret (signature mock / re-fetch Pakasir) | body mentah gateway | `{ replayed }` | Tanpa konsumen FE (dipanggil gateway) | ✅ final |
| POST | `/dev/payments/:donationId/simulate` | Login, hanya bila `ENABLE_DEV_TOOLS` | `SimulatePaymentDto { outcome?: settlement\|expire\|failed }` | hasil webhook tersimulasi | `PaymentPage.tsx`, `CampaignDetailPage.tsx` | ✅ final |

### Pencairan (BE Disbursement · `disbursements.controller.ts`)

| Method | Path | Auth | Request | Response `data` (ringkas) | Konsumen FE | Status |
| --- | --- | --- | --- | --- | --- | --- |
| POST | `/campaigns/:id/disbursements` | Login (pemilik) | multipart `amount, description, proof` atau `CreateDisbursementDto { amount, description, fileId }` | disbursement REQUESTED | `pages/DisbursePage.tsx` | ✅ final |
| GET | `/campaigns/:id/disbursements` | Publik (bukti: pemilik/admin) | — | daftar pencairan | `DisbursePage.tsx`, `CampaignDetailPage.tsx` | ✅ final |
| GET | `/campaigns/:id/milestones` | Publik | — | tahap pencairan + status | `components/MilestoneProgress.tsx` | ✅ final |
| GET | `/disbursements/:id/proof/link` | Login (pemilik/admin) | — | `{ url }` signed | `pages/admin/AdminPages.tsx` | ✅ final |
| GET | `/disbursements/:id/proof` | Login (pemilik/admin) | — | stream file | via URL dari `/proof/link` | ✅ final |
| GET | `/admin/disbursements` | Admin | query `status` | daftar pencairan | `pages/admin/AdminPages.tsx` | ✅ final |
| POST | `/admin/disbursements/:id/approve` | Admin | — | APPROVED | `pages/admin/AdminPages.tsx` | ✅ final |
| POST | `/admin/disbursements/:id/reject` | Admin | `ReasonDto { reason }` | REJECTED | `pages/admin/AdminPages.tsx` | ✅ final |
| POST | `/admin/disbursements/:id/mark-paid` | Admin | — | PAID | `pages/admin/AdminPages.tsx` | ✅ final |

### Integritas & blockchain (BC Integrity / BC Relayer · `integrity.controller.ts`)

| Method | Path | Auth | Request | Response `data` (ringkas) | Konsumen FE | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/blockchain/info` | Publik | — | `{ network, chainId, contractAddress, ready, relayer{address, balance, lowBalance, minBalance}, explorerUrl }` (tanpa biaya gas) | `lib/hooks.ts` | ✅ final |
| POST | `/admin/donations/:id/verify` | Admin | — | `{ status, currentHash, onChainHash, campaignFrozen }` | `pages/DonationProofPage.tsx`, `admin/AdminPages.tsx` | ✅ final |
| POST | `/admin/campaigns/:id/verify` | Admin | — | ringkasan verifikasi ≤ 100 donasi + `hasMore` | `pages/CampaignDetailPage.tsx` | ✅ final |
| POST | `/admin/integrity/verify-all` | Admin | — | `{ checked, verified, tampered, skippedNotNotarized, frozenCampaigns[], hasMore, results[], errors[] }` | `pages/admin/AdminPages.tsx` | ✅ final |
| POST | `/admin/blockchain/:donationId/retry` | Admin | — | job FAILED → QUEUED; 409 untuk status lain | `pages/admin/AdminPages.tsx` | ✅ final |
| GET | `/cron/tick` | Secret (`Bearer CRON_SECRET`) | — | ringkasan tick (expire, notarisasi, integrity, housekeeping) | Tanpa konsumen FE (GitHub Actions `cron-tick.yml`, Vercel Cron) | ✅ final |

### File (BE Infra · `files.controller.ts`)

| Method | Path | Auth | Request | Response `data` (ringkas) | Konsumen FE | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET | `/files/config` | Publik | — | `{ driver, maxBytes, directUpload }` | `lib/upload.ts` | ✅ final |
| POST | `/files/upload-url` | Login | `UploadUrlDto { purpose, fileName, contentType, size }` | `{ fileId, uploadUrl, token }` (signed upload Supabase) | `lib/upload.ts` | ✅ final |
| GET | `/files/:id/link` | Publik (sesuai hak akses file) | — | `{ url }` | Tanpa pemanggil langsung (FE memakai `/documents/:id/link` dan `/disbursements/:id/proof/link`) | ✅ final |
| GET | `/files/:id` | Publik + URL bertanda tangan (`e`, `t`) | query `e, t` | stream file (driver db) | via URL bertanda tangan | ✅ final |

## Ringkasan

| Item | Jumlah |
| --- | --- |
| Endpoint di Postman / controller | 55 / 55 (cocok) |
| Dipakai web | 45 |
| Tanpa konsumen FE | 10: `/health`, `/me`, `DELETE /campaigns/:id`, `/admin/campaigns/:id`, `/donations/:id/blockchain`, `/admin/donations/:id/refund`, `/webhooks/payment`, `/cron/tick`, `/files/:id/link`, `/files/:id` (via URL bertanda tangan) |

Catatan: kolom "Response" adalah ringkasan; schema response belum dibuat otomatis (`apps/api/docs/README.md`:
service mengembalikan objek biasa). Bentuk pasti ada di tipe FE `apps/web/src/lib/types.ts`.
