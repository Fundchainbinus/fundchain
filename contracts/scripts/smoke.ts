import { ethers, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Cek read-only: contract ada, role relayer benar. Notarize dilakukan oleh backend. */
async function main() {
  const file = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, 'utf8'));
  const registry = await ethers.getContractAt('DonationRegistry', dep.address);
  const role = await registry.RELAYER_ROLE();
  console.log('Contract     :', dep.address);
  console.log('Relayer ok   :', await registry.hasRole(role, dep.relayer));
  console.log('Relayer saldo:', ethers.formatEther(await ethers.provider.getBalance(dep.relayer)), 'ETH');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
