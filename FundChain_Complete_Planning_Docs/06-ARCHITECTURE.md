# System Architecture

## High-Level

``` text
                 Microsoft SSO
                     |
                     v
              React / Vite Web
                     |
                     v
                 NestJS API
          _________/ | \_________
         /           |           \
        v            v            v
 PostgreSQL       Storage       Redis
                                   |
                                 BullMQ
                                   |
                                   v
                         Blockchain Worker
                                   |
                                   v
                            Relayer Wallet
                                   |
                                   v
                           Ethereum Sepolia
                                   |
                                   v
                         DonationRegistry
```

## Architectural Principles

1.  Database stores operational data.
2.  Blockchain stores immutable proof.
3.  Payment gateway remains the payment source.
4.  Blockchain operations are asynchronous.
5.  Frontend is never a security boundary.
6.  Secrets remain server-side.
7.  Critical actions are auditable.

## Suggested Monorepo

``` text
fundchain/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── types/
│   └── shared/
├── contracts/
├── docs/
└── infra/
```

## Backend Modules

``` text
auth
users
campaigns
reviews
donations
payments
blockchain
integrity
disbursements
audit
storage
```

## Async Boundary

Payment settlement:

``` text
Webhook → Database transaction → Blockchain Queue
```

Blockchain:

``` text
Queue → Worker → Relayer → Contract → DB
```
