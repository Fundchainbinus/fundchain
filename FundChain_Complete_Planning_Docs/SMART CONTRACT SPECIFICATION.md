# Smart Contract Specification

**File:** `contracts/contracts/DonationRegistry.sol` · **Network:** Sepolia · **Solidity:** ^0.8.20 · **Standards:** OpenZeppelin AccessControl

## 1. Hash Format

**Canonical payload (dibuat off-chain):**
```
v1|donationId|integritySubjectId|amount|timestamp
```

Contoh: `v1|a1b2c3d4-...|STU-00042|100000|1790600000`

**Hash:** `keccak256(UTF8(canonicalPayload))` → `bytes32`.

`donationIdBytes32 = keccak256(UTF8(lowercase(uuid)))` — karena contract pakai `bytes32` key (hemat gas).

## 2. Storage

```solidity
struct Record {
    bytes32 hash;
    uint256 timestamp;      // block.timestamp
    address notarizedBy;
}
mapping(bytes32 => Record) private _records;
```

Aturan: `_records` private · 1 donationId = 1 record (immutable) · timestamp dari `block.timestamp` (gak bisa dipalsuin).

## 3. Event

```solidity
event DonationNotarized(
    bytes32 indexed donationId,
    bytes32 hash,
    uint256 timestamp,
    address notarizedBy
);
```

`indexed` biar bisa di-filter di Etherscan. Backend listen event untuk update `confirmed_at` + `block_number`.

## 4. Access Control

| Role | Granted To | Bisa |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Admin wallet (cold) | Grant/revoke roles |
| `RELAYER_ROLE` | Backend hot wallet | Notarize |

**Relayer & admin HARUS BEDA.** Kalau relayer bocor, admin bisa revoke tanpa redeploy.

```solidity
bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
```

## 5. Functions

### `notarize(bytes32 donationId, bytes32 hash)`
- `onlyRole(RELAYER_ROLE)`
- Revert `ZeroHash()` kalau hash = 0
- Revert `AlreadyNotarized()` kalau donationId udah ada
- Simpan record + emit event
- **Idempotency di contract level** — duplicate = revert

### `verify(bytes32 donationId) → bytes32`
- View function, gratis
- Return hash atau `bytes32(0)` kalau belum ada
- Dipakai backend saat integrity check

### `getRecord(bytes32 donationId) → Record`
- View, return struct lengkap

### `isNotarized(bytes32 donationId) → bool`
- View, cek udah ada atau belum

## 6. Custom Errors

```solidity
error AlreadyNotarized(bytes32 donationId);
error ZeroHash();
error UnauthorizedRelayer();
```

Alasan: gas ~50% lebih murah dari `require` strings, bisa return structured data.

## 7. Full Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDonationRegistry {
    event DonationNotarized(bytes32 indexed donationId, bytes32 hash, uint256 timestamp, address notarizedBy);
    error AlreadyNotarized(bytes32 donationId);
    error ZeroHash();

    function notarize(bytes32 donationId, bytes32 hash) external;
    function verify(bytes32 donationId) external view returns (bytes32);
    function isNotarized(bytes32 donationId) external view returns (bool);
}
```

## 8. Design Decisions

| Keputusan | Alasan |
|---|---|
| `bytes32` keys | Fixed size, hemat gas |
| `AlreadyNotarized` revert | Enforce 1:1 notarization |
| Split RELAYER + ADMIN | Bisa revoke relayer tanpa sentuh admin |
| No payable, no ETH transfer | Pure notarization, minimal attack surface |
| No upgradability | Immutable proof = intinya |
| `block.timestamp` | Trustless |
| Custom errors | Gas efisien |

## 9. Deployment Checklist

- [ ] Compile: `pnpm hardhat compile`
- [ ] Test: `pnpm hardhat test`
- [ ] Deploy: `pnpm hardhat run scripts/deploy.ts --network sepolia`
- [ ] Grant `RELAYER_ROLE` ke relayer wallet
- [ ] Verify: `pnpm hardhat verify --network sepolia <addr> <admin>`
- [ ] Record `CONTRACT_ADDRESS` di `.env`
- [ ] Fund relayer ≥ 0.1 Sepolia ETH
- [ ] Test notarize + verify + duplicate revert

## 10. Cost

~50,000 gas per notarize · ~1-2 gwei Sepolia · ~0.00005-0.0001 ETH per tx · 1,000 donation ~0.1 Sepolia ETH.

## 11. Security

| Concern | Mitigation |
|---|---|
| Relayer bocor | Admin revoke RELAYER_ROLE |
| Duplicate notarize | Revert `AlreadyNotarized` |
| Hash manipulation | Immutable |
| Wrong chain | Backend validate `chainId === 11155111` |
| Wrong contract | Validate `CONTRACT_ADDRESS` env |
| Reentrancy | Gak ada external call |
| Private key di client | Relayer key HANYA di backend env |

## 12. Backend Integration

```typescript
contract.on('DonationNotarized', async (donationId, hash, timestamp, _, event) => {
  await prisma.blockchainTransaction.update({
    where: { donationId: fromBytes32ToUuid(donationId) },
    data: {
      txHash: event.log.transactionHash,
      blockNumber: BigInt(event.log.blockNumber),
      status: 'CONFIRMED',
      confirmedAt: new Date(Number(timestamp) * 1000),
    },
  });
});
```

## 13. Testing

**Happy:** notarize → success · verify return hash · isNotarized true.
**Edge:** duplicate → revert `AlreadyNotarized` · hash zero → revert `ZeroHash` · non-relayer → revert `AccessControlUnauthorizedAccount` · verify belum ada → return `bytes32(0)`.
**Fuzz:** random donationId + hash → notarize → verify match.