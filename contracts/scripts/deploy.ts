import { ethers, network } from 'hardhat';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const { chainId } = await ethers.provider.getNetwork();

  // Local: admin = akun #0, relayer = akun #1 (kunci dev Hardhat yang publik).
  // Sepolia: admin = deployer, relayer wajib diisi lewat RELAYER_ADDRESS dan HARUS berbeda.
  const relayer = network.name === 'localhost' || network.name === 'hardhat'
    ? signers[1].address
    : process.env.RELAYER_ADDRESS;
  if (!relayer || !ethers.isAddress(relayer)) throw new Error('RELAYER_ADDRESS tidak valid');
  if (relayer.toLowerCase() === deployer.address.toLowerCase()) {
    throw new Error('Relayer dan admin harus wallet yang berbeda');
  }

  console.log(`Network   : ${network.name} (chainId ${chainId})`);
  console.log(`Admin     : ${deployer.address}`);
  console.log(`Relayer   : ${relayer}`);

  const Registry = await ethers.getContractFactory('DonationRegistry');
  const registry = await Registry.deploy(deployer.address, relayer);
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const receipt = await registry.deploymentTransaction()?.wait();

  console.log(`Contract  : ${address}`);

  const out = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        network: network.name,
        chainId: Number(chainId),
        address,
        admin: deployer.address,
        relayer,
        blockNumber: receipt?.blockNumber ?? null,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`Disimpan ke ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
