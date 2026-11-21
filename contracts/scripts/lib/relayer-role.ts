import type { Signer } from 'ethers';
import { getAddress, isAddress } from 'ethers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DonationRegistry } from '../../typechain-types';

/**
 * Logika grant/revoke RELAYER_ROLE (BFD-29/30) — dipisah dari script supaya bisa
 * dites di jaringan Hardhat lokal (test/RelayerRole.test.ts) dengan kode yang sama
 * persis dengan yang dijalankan admin di Sepolia.
 */

export type RoleRegistry = DonationRegistry;

export type RoleAction = 'grant' | 'revoke';

export interface RoleChangeResult {
  action: RoleAction;
  contract: string;
  account: string;
  admin: string;
  before: boolean;
  after: boolean;
  /** null kalau state sudah sesuai sehingga tidak ada tx yang dikirim. */
  txHash: string | null;
  blockNumber: number | null;
}

export interface RoleChangeOptions {
  /** Jumlah konfirmasi yang ditunggu (default 1). */
  confirmations?: number;
  log?: (msg: string) => void;
}

export function requireAddress(value: string | undefined, name: string): string {
  if (!value || !isAddress(value.trim())) {
    throw new Error(`${name} wajib diisi dengan address yang valid (sekarang: ${value ?? '<kosong>'})`);
  }
  return getAddress(value.trim());
}

/**
 * Alamat contract: env REGISTRY_ADDRESS, atau field `address` di deployments/<network>.json.
 */
export function resolveRegistryAddress(networkName: string, override?: string): string {
  if (override && override.trim()) return requireAddress(override, 'REGISTRY_ADDRESS');
  const file = path.join(__dirname, '..', '..', 'deployments', `${networkName}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`REGISTRY_ADDRESS kosong dan deployments/${networkName}.json tidak ada`);
  }
  const dep = JSON.parse(fs.readFileSync(file, 'utf8'));
  return requireAddress(dep.address, `address di deployments/${networkName}.json`);
}

/**
 * Grant / revoke RELAYER_ROLE dengan pengecekan hasRole sebelum & sesudah.
 * - Menolak kalau signer bukan pemegang DEFAULT_ADMIN_ROLE (tidak membuang gas).
 * - Tidak mengirim tx kalau state sudah sesuai (idempotent).
 * - Melempar error kalau setelah tx state tidak berubah sesuai harapan.
 */
export async function changeRelayerRole(
  action: RoleAction,
  registry: RoleRegistry,
  admin: Signer,
  account: string,
  opts: RoleChangeOptions = {},
): Promise<RoleChangeResult> {
  const log = opts.log ?? (() => {});
  const target = requireAddress(account, 'relayer address');
  const adminAddress = await admin.getAddress();
  const contract = await registry.getAddress();
  const role = await registry.RELAYER_ROLE();
  const adminRole = await registry.DEFAULT_ADMIN_ROLE();

  if (!(await registry.hasRole(adminRole, adminAddress))) {
    throw new Error(`Signer ${adminAddress} bukan pemegang DEFAULT_ADMIN_ROLE di ${contract}`);
  }

  const before = await registry.hasRole(role, target);
  const desired = action === 'grant';
  log(`Contract : ${contract}`);
  log(`Admin    : ${adminAddress}`);
  log(`Relayer  : ${target}`);
  log(`hasRole(RELAYER_ROLE) sebelum: ${before}`);

  if (before === desired) {
    log(`Tidak ada perubahan: role sudah ${desired ? 'dimiliki' : 'tidak dimiliki'}. Tx tidak dikirim.`);
    return { action, contract, account: target, admin: adminAddress, before, after: before, txHash: null, blockNumber: null };
  }

  const connected = registry.connect(admin);
  const tx = desired ? await connected.grantRole(role, target) : await connected.revokeRole(role, target);
  log(`Tx hash  : ${tx.hash}`);
  const receipt = await tx.wait(opts.confirmations ?? 1);
  if (!receipt || receipt.status !== 1) throw new Error(`Tx ${tx.hash} gagal`);

  const after = await registry.hasRole(role, target);
  log(`hasRole(RELAYER_ROLE) sesudah: ${after} (blok ${receipt.blockNumber})`);
  if (after !== desired) {
    throw new Error(`State role tidak sesuai setelah tx ${tx.hash}: hasRole=${after}`);
  }
  return {
    action,
    contract,
    account: target,
    admin: adminAddress,
    before,
    after,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  };
}

/**
 * Entry point bersama untuk scripts/grant-relayer.ts & scripts/revoke-relayer.ts.
 * Dipanggil lewat `hardhat run`, jadi `hre` sudah terisi network yang dipilih.
 */
export async function runRoleScript(action: RoleAction, accountEnv: string): Promise<void> {
  // import dinamis supaya file ini bisa di-import dari test tanpa efek samping.
  const { ethers, network } = await import('hardhat');
  const contractAddress = resolveRegistryAddress(network.name, process.env.REGISTRY_ADDRESS);
  const account = requireAddress(process.env[accountEnv], accountEnv);

  const { chainId } = await ethers.provider.getNetwork();
  const depFile = path.join(__dirname, '..', '..', 'deployments', `${network.name}.json`);
  if (fs.existsSync(depFile)) {
    const dep = JSON.parse(fs.readFileSync(depFile, 'utf8'));
    if (dep.chainId && Number(dep.chainId) !== Number(chainId)) {
      throw new Error(`chainId RPC ${chainId} != deployments/${network.name}.json (${dep.chainId})`);
    }
  }

  const [admin] = await ethers.getSigners();
  if (!admin) throw new Error('Tidak ada signer. Isi DEPLOYER_PRIVATE_KEY (wallet admin) di contracts/.env');
  const registry = await ethers.getContractAt('DonationRegistry', contractAddress);

  console.log(`Network  : ${network.name} (chainId ${chainId})`);
  console.log(`Aksi     : ${action} RELAYER_ROLE`);
  const result = await changeRelayerRole(action, registry, admin, account, {
    confirmations: network.name === 'sepolia' ? 2 : 1,
    log: (m) => console.log(m),
  });
  if (result.txHash && network.name === 'sepolia') {
    console.log(`Etherscan: https://sepolia.etherscan.io/tx/${result.txHash}`);
  }
  console.log(JSON.stringify(result));
}
