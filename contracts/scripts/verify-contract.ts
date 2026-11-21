import { network, run } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * BFD-29 — verifikasi source DonationRegistry di Etherscan (+ Sourcify).
 *
 *   npx hardhat run scripts/verify-contract.ts --network sepolia
 *   (ETHERSCAN_API_KEY diisi di contracts/.env; tanpa key Etherscan dilewati, Sourcify tetap jalan)
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
  const contract = 'contracts/DonationRegistry.sol:DonationRegistry';

  // Subtask `verify:verify` bawaan menjalankan Etherscan lalu Sourcify secara berurutan,
  // sehingga kalau Etherscan gagal (mis. key kosong) Sourcify tidak pernah dicoba.
  // Karena itu keduanya dijalankan terpisah.
  const results: Record<string, string> = {};
  if (process.env.ETHERSCAN_API_KEY) {
    try {
      await run('verify:etherscan', { address: dep.address, constructorArgsParams: constructorArguments, contract });
      results.etherscan = 'OK';
    } catch (e) {
      results.etherscan = 'GAGAL: ' + (e instanceof Error ? e.message : String(e));
    }
  } else {
    results.etherscan = 'dilewati (ETHERSCAN_API_KEY kosong)';
  }
  try {
    await run('verify:sourcify', { address: dep.address, contract });
    results.sourcify = 'OK';
  } catch (e) {
    results.sourcify = 'GAGAL: ' + (e instanceof Error ? e.message : String(e));
  }

  console.log(`Etherscan: ${results.etherscan}`);
  console.log(`Sourcify : ${results.sourcify}`);
  if (results.etherscan !== 'OK' && results.sourcify !== 'OK') process.exitCode = 1;
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
