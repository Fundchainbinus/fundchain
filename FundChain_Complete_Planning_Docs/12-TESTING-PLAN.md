# Testing Plan

## Unit Tests

### Auth

-   valid BINUS account
-   non-BINUS account
-   role mapping

### Campaign

-   valid creation
-   invalid target
-   expired deadline
-   valid submit
-   invalid status transition

### Donation

-   positive amount
-   invalid amount
-   inactive campaign
-   duplicate processing

### Payment

-   valid signature
-   invalid signature
-   duplicate webhook
-   mismatched amount

### Blockchain

-   deterministic hash
-   successful notarization
-   duplicate notarization
-   retry after failure
-   confirmation handling

### Integrity

-   matching hash
-   mismatching hash
-   frozen campaign after mismatch

### Disbursement

-   eligible campaign
-   frozen campaign
-   missing proof
-   admin approval

## Integration Tests

1.  Campaign submission → review.
2.  Payment webhook → PAID.
3.  PAID → blockchain queue.
4.  Worker → Sepolia.
5.  txHash → database.
6.  Integrity verification.
7.  Disbursement eligibility.

## E2E

``` text
Login
→ Create Campaign
→ Submit
→ Admin Approve
→ Browse
→ Donate
→ Payment
→ PAID
→ Blockchain
→ VERIFIED
→ Request Disbursement
→ Admin Approve
```

## Tamper Scenario

``` text
Original Amount = 100000
Blockchain Hash = A

Database Amount = 900000
Recomputed Hash = B

A != B
→ TAMPERED
→ FROZEN
→ DISBURSEMENT LOCKED
```

## Security Tests

-   IDOR
-   unauthorized admin
-   forged webhook
-   duplicate webhook
-   malicious file
-   rate-limit bypass
-   secret exposure
