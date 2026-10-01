# Database Schema

**Stack:** PostgreSQL 16 + Prisma ORM. File asli: `apps/api/prisma/schema.prisma`.

## ERD

```mermaid
erDiagram
    USERS {
        uuid id PK
        string microsoft_id UK
        string email UK
        string name
        enum role
        timestamp created_at
        timestamp updated_at
    }
    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK
        string action
        string entity_type
        uuid entity_id
        json metadata
        string ip_address
        timestamp created_at
    }
    CAMPAIGNS {
        uuid id PK
        uuid creator_id FK
        string title
        text description
        string sdg_category
        decimal target_amount
        decimal current_amount
        timestamp deadline
        enum status
        text rejection_reason
        timestamp created_at
        timestamp updated_at
    }
    CAMPAIGN_REVIEWS {
        uuid id PK
        uuid campaign_id FK
        uuid admin_id FK
        enum decision
        text reason
        timestamp created_at
    }
    DONATIONS {
        uuid id PK
        uuid campaign_id FK
        uuid donor_id FK
        decimal amount
        enum status
        text canonical_payload
        string hash
        enum integrity_status
        timestamp donated_at
        timestamp created_at
        timestamp updated_at
    }
    PAYMENTS {
        uuid id PK
        uuid donation_id FK
        string provider
        string external_payment_id UK
        string method
        enum status
        timestamp paid_at
        timestamp created_at
        timestamp updated_at
    }
    BLOCKCHAIN_TRANSACTIONS {
        uuid id PK
        uuid donation_id FK
        string network
        string contract_address
        string tx_hash UK
        enum status
        bigint block_number
        int retry_count
        text last_error
        timestamp submitted_at
        timestamp confirmed_at
        timestamp created_at
        timestamp updated_at
    }
    DISBURSEMENTS {
        uuid id PK
        uuid campaign_id FK
        uuid requester_id FK
        decimal amount
        string proof_url
        enum status
        uuid admin_id FK
        text rejection_reason
        timestamp requested_at
        timestamp approved_at
        timestamp paid_at
    }
    CAMPAIGN_DOCUMENTS {
        uuid id PK
        uuid campaign_id FK
        string file_url
        string file_type
        timestamp created_at
    }
    USERS ||--o{ AUDIT_LOGS : triggers
    USERS ||--o{ CAMPAIGNS : creates
    USERS ||--o{ CAMPAIGN_REVIEWS : reviews
    CAMPAIGNS ||--o{ CAMPAIGN_REVIEWS : receives
    USERS ||--o{ DONATIONS : donates
    CAMPAIGNS ||--o{ DONATIONS : receives
    DONATIONS ||--o| PAYMENTS : processed_by
    DONATIONS ||--o| BLOCKCHAIN_TRANSACTIONS : notarized_by
    USERS ||--o{ DISBURSEMENTS : requests
    USERS ||--o{ DISBURSEMENTS : approves
    CAMPAIGNS ||--o{ DISBURSEMENTS : disburses
    CAMPAIGNS ||--o{ CAMPAIGN_DOCUMENTS : contains
```

## Enum

| Enum | Values |
|---|---|
| Role | STUDENT, ADMIN |
| CampaignStatus | DRAFT, PENDING_REVIEW, ACTIVE, REJECTED, FROZEN, COMPLETED |
| ReviewDecision | APPROVE, REJECT |
| DonationStatus | PENDING, PAID, FAILED, EXPIRED, REFUNDED |
| IntegrityStatus | PENDING, VERIFIED, TAMPERED |
| PaymentStatus | PENDING, SETTLED, FAILED, EXPIRED |
| BlockchainStatus | QUEUED, SUBMITTED, CONFIRMED, FAILED, RETRYING |
| DisbursementStatus | REQUESTED, APPROVED, REJECTED, PAID |

## Models

**User** — `microsoftId` UK (dari `sub` claim) · `email` UK (@binus.ac.id) · `role` default STUDENT.
**AuditLog** — `actorId` nullable (system actions) · `metadata` JSONB.
**Campaign** — `creatorId` FK · `sdgCategory` (17 SDG) · `targetAmount`/`currentAmount` decimal(15,2) · `status` default DRAFT · `rejectionReason` nullable.
**CampaignReview** — `campaignId` + `adminId` FK · `decision` APPROVE/REJECT · `reason` wajib saat reject.
**Donation** — `campaignId` + `donorId` FK · `canonicalPayload` + `hash` (audit) · `integrityStatus` PENDING/VERIFIED/TAMPERED.
**Payment** — `donationId` UK (1:1) · `externalPaymentId` UK (Midtrans) · `method` QRIS/VA · `paidAt` nullable.
**BlockchainTransaction** — `donationId` UK (1:1) · `txHash` UK · `status` QUEUED→SUBMITTED→CONFIRMED · `blockNumber`/`submittedAt`/`confirmedAt` nullable.
**Disbursement** — `requesterId` + `adminId` FK · `status` REQUESTED→APPROVED/REJECTED→PAID · `adminId`/`rejectionReason`/timestamps nullable.
**CampaignDocument** — `campaignId` FK · `fileUrl` + `fileType`.

## Design Decisions

| Keputusan | Alasan |
|---|---|
| `Decimal(15,2)` untuk money | Presisi, hindari float |
| `donation_id` UK di payments + blockchain_transactions | Enforce 1:1 |
| Cascade delete di documents/reviews/payments | Cleanup otomatis |
| NO cascade campaign → donations | Jangan kehilangan record |
| `actor_id` nullable | System actions |
| `admin_id` nullable di disbursements | Baru diisi saat approve |

## Indexes

`campaigns(status, deadline)` · `campaigns(creatorId)` · `donations(campaignId, status)` · `donations(donorId)` · `audit_logs(entityType, entityId)` · `audit_logs(createdAt)`.

## Rules

- Semua schema change WAJIB lewat Prisma migration
- Migration gak boleh diubah setelah commit
- Jangan `db push` di production — pakai `migrate deploy`