import { network, run } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * BFD-29 — verifikasi source DonationRegistry di Etherscan (+ Sourcify).
 *
 *   npx hardhat run scripts/verify-contract.ts --network sepolia
 *   (ETHERSCAN_API_KEY diisi di contracts/.env; tanpa key hanya Sourcify yang jalan)
 *
 * Constructor args diambil dari deployments/<network>.json: `constructorArgs` bila ada,
 * kalau tidak [admin, relayer]. PENTING: argumen harus relayer SAAT DEPLOY, bukan relayer
 * hasil rotasi — karena itu `constructorArgs` disimpan terpisah dari field `relayer`.
 *
 * Setara manual:
 *   npx hardhat verify --network sepolia <address> <admin> <relayerAwal>
 */
async function main() {
  const file = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, 'utf8'));
  const constructorArguments: string[] = dep.constructorArgs ?? [dep.admin, dep.relayer];
  console.log(`Network : ${network.name}`);
  console.log(`Address : ${dep.address}`);
  console.log(`Args    : ${JSON.stringify(constructorArguments)}`);
  if (!process.env.ETHERSCAN_API_KEY) {
    console.warn('ETHERSCAN_API_KEY kosong: verifikasi Etherscan akan gagal, Sourcify tetap dicoba.');
  }
  await run('verify:verify', {
    address: dep.address,
    constructorArguments,
    contract: 'contracts/DonationRegistry.sol:DonationRegistry',
  });
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
