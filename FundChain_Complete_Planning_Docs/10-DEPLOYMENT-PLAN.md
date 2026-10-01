# Deployment Plan

## 1. Environments

### Local

Used for development.

``` text
Web       → localhost
API       → localhost
Postgres  → Docker
Redis     → Docker
Blockchain → Hardhat local / Sepolia
```

### Staging

Used for integration testing.

``` text
Web       → Vercel preview/staging
API       → Render/Railway/VPS
Database  → Managed PostgreSQL
Redis     → Managed Redis
Blockchain → Sepolia
```

### Production / Demo

Used for final competition demo.

Use separate: - database - payment credentials - blockchain relayer
wallet - storage bucket - environment secrets

## 2. Suggested Hosting

### Frontend

Vercel.

### Backend

Render, Railway, or VPS.

### Database

Supabase PostgreSQL or managed PostgreSQL.

### Storage

Supabase Storage or object storage.

### Redis

Managed Redis.

### Blockchain

Ethereum Sepolia via RPC provider.

## 3. CI/CD

``` text
Git Push
   ↓
GitHub Actions
   ↓
Lint
   ↓
Typecheck
   ↓
Unit Test
   ↓
Build
   ↓
Deploy
```

## 4. Secrets

Production secrets: - DATABASE_URL - MICROSOFT_CLIENT_SECRET -
JWT_SECRET - STORAGE_SECRET - MIDTRANS_SERVER_KEY - BLOCKCHAIN_RPC_URL -
RELAYER_PRIVATE_KEY - CONTRACT_ADDRESS

Never commit `.env`.

## 5. Database Deployment

Before deploy: 1. Backup. 2. Run migration. 3. Verify schema. 4. Seed
only non-production demo data where appropriate.

## 6. Blockchain Deployment

1.  Compile contract.
2.  Run contract tests.
3.  Deploy to Sepolia.
4.  Record contract address.
5.  Verify contract if supported.
6.  Configure backend CONTRACT_ADDRESS.
7.  Fund relayer wallet with Sepolia ETH.
8.  Test notarization.
9.  Test read/verify.

## 7. Monitoring

Monitor: - API errors - webhook failures - blockchain worker failures -
queue depth - transaction confirmation - database health - storage
errors

## 8. Rollback

Application: - rollback deployment to previous build.

Database: - migration rollback only when safe. - maintain backup.

Blockchain: - deployed contract is not casually replaceable. - if
contract bug exists, deploy a new version and update contract address
through controlled configuration.

## 9. Final Demo Checklist

-   SSO works.
-   Admin account works.
-   Student account works.
-   Payment sandbox works.
-   Webhook reachable.
-   Relayer has testnet gas.
-   Contract address configured.
-   Explorer link works.
-   Integrity checker works.
-   Tamper simulation works.
-   Freeze works.
-   Disbursement lock works.
