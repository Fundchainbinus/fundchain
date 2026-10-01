# Technical Specification

## Frontend

-   React
-   TypeScript
-   Vite
-   Tailwind CSS
-   React Query
-   React Hook Form
-   Zod

## Backend

-   NestJS
-   TypeScript
-   Prisma
-   PostgreSQL
-   Redis
-   BullMQ

## Authentication

-   Microsoft Entra ID / Microsoft OAuth
-   OpenID Connect
-   Session/JWT

## Storage

-   Supabase Storage or equivalent object storage.
-   Proposal PDF stored off-chain.

## Payment

Primary MVP candidate: - Midtrans - QRIS - Virtual Account

Payment provider should be hidden behind an adapter interface.

``` text
PaymentService
      |
PaymentGateway interface
      |
MidtransAdapter
```

## Blockchain

-   Solidity
-   Hardhat
-   ethers.js
-   Ethereum Sepolia
-   OpenZeppelin where applicable

## Hash

``` text
Keccak-256(canonical_payload)
```

Canonical payload must be deterministic.

## Queue

BullMQ handles: - blockchain notarization - retries - asynchronous jobs

## API Style

REST API. JSON request/response. DTO validation. Versioning recommended:

``` text
/api/v1/*
```

## Environment

Secrets: - database - Microsoft credentials - JWT - storage - payment
secret - RPC - relayer private key
