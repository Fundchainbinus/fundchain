# API Specification

Base URL:

``` text
/api/v1
```

## Auth

``` http
GET  /auth/login
GET  /auth/callback
POST /auth/logout
GET  /auth/me
```

## Campaign

``` http
GET    /campaigns
GET    /campaigns/:id
POST   /campaigns
PATCH  /campaigns/:id
POST   /campaigns/:id/submit
```

## Admin Campaign Review

``` http
GET  /admin/campaigns/pending
GET  /admin/campaigns/:id
POST /admin/campaigns/:id/approve
POST /admin/campaigns/:id/reject
```

Reject:

``` json
{
  "reason": "Proposal belum menjelaskan penggunaan dana."
}
```

## Donation

``` http
POST /campaigns/:id/donations
GET  /donations/:id
GET  /campaigns/:id/donations
```

## Payment

``` http
POST /payments/:donationId
POST /webhooks/payment
```

## Blockchain

``` http
GET  /donations/:id/blockchain
POST /admin/donations/:id/verify
```

## Disbursement

``` http
POST /campaigns/:id/disbursement
GET  /campaigns/:id/disbursement
POST /admin/disbursement/:id/approve
POST /admin/disbursement/:id/reject
```

## Standard Response

Success:

``` json
{
  "success": true,
  "data": {}
}
```

Error:

``` json
{
  "success": false,
  "error": {
    "code": "CAMPAIGN_NOT_ACTIVE",
    "message": "Campaign belum aktif."
  }
}
```

## API Rules

-   Validate all input.
-   Authenticate protected routes.
-   Authorize by role and ownership.
-   Use idempotency for payment processing.
-   Never trust amount/status from frontend.
