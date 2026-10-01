# Smart Contract Development Setup

**Stack:** Solidity ^0.8.20 + Hardhat + ethers.js v6 + OpenZeppelin.

## 1. Bootstrap

```bash
cd contracts
pnpm init
pnpm add -D hardhat @nomicfoundation/hardhat-toolbox @openzeppelin/contracts dotenv
pnpm add ethers
pnpm dlx hardhat init   # pilih TypeScript project
```

## 2. Folder Structure

```
contracts/
├── contracts/DonationRegistry.sol
├── scripts/deploy.ts
├── test/DonationRegistry.test.ts
├── hardhat.config.ts
├── tsconfig.json
└── package.json
```

## 3. hardhat.config.ts

```typescript
import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    sepolia: {
      url: process.env.BLOCKCHAIN_RPC_URL!,
      accounts: [process.env.RELAYER_PRIVATE_KEY!],
      chainId: 11155111,
    },
  },
  etherscan: { apiKey: { sepolia: process.env.ETHERSCAN_API_KEY! } },
};

export default config;
```

## 4. Contract

`contracts/DonationRegistry.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract DonationRegistry is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    struct Record { bytes32 hash; uint256 timestamp; address notarizedBy; }
    mapping(bytes32 => Record) private _records;

    event DonationNotarized(bytes32 indexed donationId, bytes32 hash, uint256 timestamp, address notarizedBy);
    error AlreadyNotarized(bytes32 donationId);
    error ZeroHash();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RELAYER_ROLE, admin);
    }

    function notarize(bytes32 donationId, bytes32 hash) external onlyRole(RELAYER_ROLE) {
        if (hash == bytes32(0)) revert ZeroHash();
        if (_records[donationId].timestamp != 0) revert AlreadyNotarized(donationId);
        _records[donationId] = Record(hash, block.timestamp, msg.sender);
        emit DonationNotarized(donationId, hash, block.timestamp, msg.sender);
    }

    function verify(bytes32 donationId) external view returns (bytes32) {
        return _records[donationId].hash;
    }

    function isNotarized(bytes32 donationId) external view returns (bool) {
        return _records[donationId].timestamp != 0;
    }
}
```

## 5. Unit Test

`test/DonationRegistry.test.ts` — cover: notarize success · duplicate revert `AlreadyNotarized` · hash zero revert · non-relayer revert · verify returns stored hash · isNotarized returns true.

```typescript
it('reverts on duplicate notarize', async () => {
  const { registry, relayer, id, hash } = await loadFixture(deployFixture);
  await registry.connect(relayer).notarize(id, hash);
  await expect(registry.connect(relayer).notarize(id, hash))
    .to.be.revertedWithCustomError(registry, 'AlreadyNotarized');
});
```

## 6. Deploy Script

`scripts/deploy.ts`:

```typescript
import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying with:', deployer.address);

  const Registry = await ethers.getContractFactory('DonationRegistry');
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();

  console.log('Deployed to:', await registry.getAddress());
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
```

## 7. Commands

```bash
pnpm hardhat compile
pnpm hardhat test                    # unit test
pnpm hardhat coverage
pnpm hardhat run scripts/deploy.ts --network localhost     # local
pnpm hardhat run scripts/deploy.ts --network sepolia       # Sepolia
pnpm hardhat verify --network sepolia <address> <admin>
```

**Local deployment:** `pnpm hardhat node` di terminal 1, deploy ke `--network localhost` di terminal 2.

## 8. Env Variables

```
BLOCKCHAIN_RPC_URL=https://sepolia.infura.io/v3/KEY
RELAYER_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
```

## 9. Faucet

Sepolia ETH gratis: `sepoliafaucet.com` · `alchemy.com/faucets/ethereum-sepolia` · `faucet.quicknode.com/ethereum/sepolia`.
Relayer wallet butuh ≥ 0.1 Sepolia ETH untuk demo.

## 10. Checklist

- [ ] Contract compile tanpa warning
- [ ] Semua test pass
- [ ] Deploy ke localhost → verify basic flow
- [ ] Deploy ke Sepolia → catat contract address
- [ ] Verify contract di Etherscan
- [ ] Grant `RELAYER_ROLE` ke relayer wallet
- [ ] Fund relayer dengan Sepolia ETH
- [ ] Test `notarize()` + `verify()` via script
- [ ] Update `docs/03-smart-contract.md` §14 dengan address