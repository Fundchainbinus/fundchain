# Blockchain Specification

## Purpose

Blockchain menjadi immutable proof layer untuk donation record.

## Network

MVP: - Ethereum Sepolia - Solidity - Hardhat - ethers.js

## Canonical Data

Recommended payload:

``` text
donationId|integritySubjectId|amount|timestamp
```

Example:

``` text
DON-001|STUDENT-001|100000|1790600000
```

Gunakan identifier yang stabil dan tidak mengekspos data pribadi secara
langsung.

## Hash

``` text
keccak256(UTF8(canonicalPayload))
```

## Contract Concept

``` solidity
mapping(bytes32 => bytes32) private donationHashes;

event DonationNotarized(
    bytes32 indexed donationId,
    bytes32 hash,
    uint256 timestamp
);

function notarize(
    bytes32 donationId,
    bytes32 hash
) external;

function verify(
    bytes32 donationId
) external view returns (bytes32);
```

## Relayer Flow

``` text
PAID
 ↓
Hash
 ↓
Queue
 ↓
Worker
 ↓
Relayer
 ↓
Contract
 ↓
txHash
 ↓
Database
```

## Transaction State

``` text
QUEUED
SUBMITTED
CONFIRMED
FAILED
RETRYING
```

## Important Rule

Payment success must not depend on immediate blockchain confirmation.

A temporary blockchain outage should not invalidate a legitimate PAID
donation.

## Integrity

``` text
Recalculate DB Hash
        ↓
Read Contract Hash
        ↓
Compare
```

Match: `VERIFIED`

Mismatch: `TAMPERED`

Mismatch triggers: `Campaign → FROZEN`
