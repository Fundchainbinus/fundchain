# Security Specification

## Authentication

-   Microsoft SSO only.
-   Restrict domain to @binus.ac.id.
-   Secure cookie/session handling or short-lived JWT.
-   Token expiry and revocation strategy.

## Authorization

-   Backend RBAC.
-   Ownership checks for creator resources.
-   Admin-only review/disbursement endpoints.
-   No role information trusted from frontend.

## Payment

-   Verify gateway signature.
-   Validate transaction reference.
-   Validate amount and campaign.
-   Idempotent webhook.
-   Reject duplicate settlement.

## File Upload

-   PDF validation.
-   MIME validation.
-   Extension validation.
-   Size limit.
-   Random filename.
-   Store outside executable path.
-   Malware scanning can be added if available.

## Blockchain

-   Relayer private key stored only in server secret environment.
-   Never expose private key to client.
-   Validate chain ID.
-   Validate contract address.
-   Prevent duplicate notarization.
-   Rate-limit admin verification endpoints.

## API

-   Rate limiting.
-   CORS.
-   Secure headers.
-   DTO/schema validation.
-   ORM parameterization.
-   Error messages should not leak secrets.

## Data Privacy

Never put personal data or documents directly on-chain.

Avoid using full name in canonical payload if a stable pseudonymous
student identifier can satisfy the integrity requirement.

## Audit

Audit critical events: - login - campaign changes - review - payment -
blockchain - integrity - freeze - disbursement
