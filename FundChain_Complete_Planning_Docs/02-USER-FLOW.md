# User Flow

## A. Authentication

``` text
User
 ↓
Microsoft BINUS Login
 ↓
Microsoft Identity Validation
 ↓
Validate @binus.ac.id
 ↓
Load User + Role
 ↓
Student → Student Portal
Admin → Admin Dashboard
```

## B. Campaign Creation

``` text
Student
 ↓
Create Campaign
 ↓
Fill Form
 ↓
Upload Proposal
 ↓
Validation
 ↓
Save Draft
 ↓
Submit
 ↓
PENDING_REVIEW
```

## C. Campaign Review

``` text
Admin
 ↓
Review Queue
 ↓
Open Campaign
 ↓
Review Proposal
 ↓
Approve / Reject
```

Approve:

``` text
PENDING_REVIEW → ACTIVE
```

Reject:

``` text
PENDING_REVIEW → REJECTED
                         ↓
                    Creator Revision
                         ↓
                    PENDING_REVIEW
```

## D. Donation

``` text
Donor
 ↓
Browse Active Campaign
 ↓
Campaign Detail
 ↓
Choose Amount
 ↓
Create Donation
 ↓
Payment Gateway
 ↓
QRIS / VA
 ↓
Payment
 ↓
Webhook
 ↓
Verify Webhook
 ↓
PAID
```

## E. Blockchain Notarization

``` text
PAID
 ↓
Create Canonical Payload
 ↓
Keccak-256
 ↓
Queue Job
 ↓
Blockchain Worker
 ↓
Relayer
 ↓
Smart Contract
 ↓
txHash
 ↓
Save Reference
```

## F. Integrity Check

``` text
Donation
 ↓
Hash Database Data
 ↓
Read On-chain Hash
 ↓
Compare
 ├── Match → VERIFIED
 └── Mismatch → TAMPERED
                         ↓
                       FROZEN
```

## G. Disbursement

``` text
Creator
 ↓
Campaign Eligible
 ↓
Request Disbursement
 ↓
Upload Proof
 ↓
Admin Review
 ├── Reject → REJECTED
 └── Approve
       ↓
    Campus Fund Transfer
       ↓
      PAID
```
