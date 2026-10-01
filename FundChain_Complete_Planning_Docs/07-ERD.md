# ERD

``` mermaid
erDiagram
    USERS ||--o{ CAMPAIGNS : creates
    USERS ||--o{ DONATIONS : makes
    USERS ||--o{ CAMPAIGN_REVIEWS : performs
    USERS ||--o{ DISBURSEMENTS : requests
    USERS ||--o{ AUDIT_LOGS : creates

    CAMPAIGNS ||--o{ CAMPAIGN_DOCUMENTS : has
    CAMPAIGNS ||--o{ CAMPAIGN_REVIEWS : receives
    CAMPAIGNS ||--o{ DONATIONS : receives
    CAMPAIGNS ||--o{ DISBURSEMENTS : has

    DONATIONS ||--o| PAYMENTS : has
    DONATIONS ||--o| BLOCKCHAIN_TRANSACTIONS : notarized_by

    USERS {
        uuid id PK
        string microsoft_id UK
        string email UK
        string name
        string role
        datetime created_at
        datetime updated_at
    }

    CAMPAIGNS {
        uuid id PK
        uuid creator_id FK
        string title
        text description
        string sdg_category
        decimal target_amount
        decimal current_amount
        datetime deadline
        string status
        text rejection_reason
        datetime created_at
        datetime updated_at
    }

    CAMPAIGN_DOCUMENTS {
        uuid id PK
        uuid campaign_id FK
        string file_url
        string file_type
        datetime created_at
    }

    CAMPAIGN_REVIEWS {
        uuid id PK
        uuid campaign_id FK
        uuid admin_id FK
        string decision
        text reason
        datetime created_at
    }

    DONATIONS {
        uuid id PK
        uuid campaign_id FK
        uuid donor_id FK
        decimal amount
        datetime donated_at
        string status
        text canonical_payload
        string hash
        string integrity_status
        datetime created_at
        datetime updated_at
    }

    PAYMENTS {
        uuid id PK
        uuid donation_id FK
        string provider
        string external_payment_id
        string method
        string status
        datetime paid_at
        datetime created_at
        datetime updated_at
    }

    BLOCKCHAIN_TRANSACTIONS {
        uuid id PK
        uuid donation_id FK
        string network
        string contract_address
        string tx_hash
        string status
        bigint block_number
        int retry_count
        text last_error
        datetime submitted_at
        datetime confirmed_at
    }

    DISBURSEMENTS {
        uuid id PK
        uuid campaign_id FK
        uuid requester_id FK
        decimal amount
        string proof_url
        string status
        uuid admin_id FK
        text rejection_reason
        datetime requested_at
        datetime approved_at
        datetime paid_at
    }

    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK
        string action
        string entity_type
        uuid entity_id
        json metadata
        string ip_address
        datetime created_at
    }
```
