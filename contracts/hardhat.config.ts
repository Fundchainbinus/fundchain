import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

const sepoliaAccounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' },
  },
  networks: {
    localhost: { url: 'http://127.0.0.1:8545', chainId: 31337 },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: sepoliaAccounts,
      chainId: 11155111,
    },
  },
  // `npx hardhat verify` / scripts/verify-contract.ts. Key HANYA dari env, jangan di-commit.
  // hardhat-verify 2.x memakai Etherscan API v2 (satu key untuk semua chain, termasuk Sepolia).
  etherscan: { apiKey: process.env.ETHERSCAN_API_KEY || '' },
  // Sourcify tidak butuh key — jalur verifikasi cadangan.
  sourcify: { enabled: true },
};

export default config;
