import { Injectable, Logger } from '@nestjs/common';
import {
  DONATION_REGISTRY_ABI,
  explorerAddressUrl,
  explorerTxUrl,
  ZERO_HASH,
} from '@fundchain/shared';
import { Contract, ethers, JsonRpcProvider, Wallet } from 'ethers';
import { AppError } from '../../common/app-error';
import { env, readDeploymentFile } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import type { FeeData } from './relayer-errors';

export interface RelayerBalance {
  address: string;
  /** Saldo (ETH, string desimal); null bila chain belum siap. */
  balance: string | null;
  lowBalance: boolean;
  minBalance: string;
}

/** BFD-92: agregat biaya gas notarisasi yang CONFIRMED (hanya baris yang punya data receipt). */
export interface FeeStats {
  count: number;
  totalFeeEth: string;
  avgFeeEth: string | null;
  totalGasUsed: string;
  last24h: { count: number; totalFeeEth: string; avgFeeEth: string | null };
}

/** Decimal Prisma / string / number → bigint wei (Decimal.toString() bisa notasi eksponen, jadi pakai toFixed(0)). */
export function toWei(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'object' && typeof (value as { toFixed?: unknown }).toFixed === 'function') {
    return BigInt((value as { toFixed: (d: number) => string }).toFixed(0));
  }
  return BigInt(String(value).split('.')[0] || '0');
}

export interface ChainTarget {
  network: string;
  chainId: number;
  contractAddress: string | null;
}

/**
 * Wrapper ethers untuk DonationRegistry.
 * Private key relayer HANYA ada di sini (server) — tidak pernah dikirim ke frontend.
 */
@Injectable()
export class BlockchainService {
  private readonly logger = new Logger('Blockchain');
  private provider?: JsonRpcProvider;
  private wallet?: Wallet;

  constructor(private readonly prisma: PrismaService) {}

  target(): ChainTarget {
    const cfg = env().blockchain;
    let address = cfg.contractAddress;
    if (!address) {
      const dep = readDeploymentFile(cfg.network);
      if (dep && Number(dep.chainId) === cfg.chainId) address = dep.address;
    }
    return {
      network: cfg.network,
      chainId: cfg.chainId,
      contractAddress: address && ethers.isAddress(address) ? ethers.getAddress(address) : null,
    };
  }

  getProvider(): JsonRpcProvider {
    if (!this.provider) {
      const cfg = env().blockchain;
      // staticNetwork: jangan spam reconnect saat node mati.
      // cacheTimeout -1: tanpa cache, agar nonce tx berurutan tidak memakai nilai basi.
      this.provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true, cacheTimeout: -1 });
    }
    return this.provider;
  }

  getRelayer(): Wallet {
    if (!this.wallet) {
      const key = env().blockchain.relayerPrivateKey;
      if (!key) throw new AppError('BLOCKCHAIN_RPC_ERROR', 'RELAYER_PRIVATE_KEY belum dikonfigurasi.');
      this.wallet = new Wallet(key, this.getProvider());
    }
    return this.wallet;
  }

  contract(withSigner = false): Contract {
    const { contractAddress } = this.target();
    if (!contractAddress) {
      throw new AppError('BLOCKCHAIN_RPC_ERROR', 'Contract belum di-deploy / CONTRACT_ADDRESS kosong.');
    }
    return new Contract(
      contractAddress,
      DONATION_REGISTRY_ABI as unknown as string[],
      withSigner ? this.getRelayer() : this.getProvider(),
    );
  }

  /**
   * Cek kesehatan chain: RPC hidup, chainId sesuai (validasi wajib), dan contract ada.
   * Mengembalikan alasan jika tidak siap.
   */
  async health(): Promise<{ ready: boolean; reason?: string }> {
    const { chainId, contractAddress } = this.target();
    try {
      const remote = Number(await this.getProvider().send('eth_chainId', []));
      if (remote !== chainId) return { ready: false, reason: `Chain ID ${remote} ≠ CHAIN_ID ${chainId}` };
      if (!contractAddress) return { ready: false, reason: 'Contract belum di-deploy' };
      const code = await this.getProvider().getCode(contractAddress);
      if (code === '0x') return { ready: false, reason: `Tidak ada contract di ${contractAddress}` };
      return { ready: true };
    } catch {
      return { ready: false, reason: 'RPC blockchain tidak dapat dihubungi' };
    }
  }

  async readOnchainHash(onchainKey: string): Promise<string> {
    try {
      return (await this.contract().verify(onchainKey)) as string;
    } catch (e) {
      if (e instanceof AppError) throw e;
      this.logger.warn(`verify() gagal: ${(e as Error).message}`);
      throw new AppError('BLOCKCHAIN_RPC_ERROR', 'Gagal membaca blockchain. Coba lagi nanti.');
    }
  }

  isZero(hash: string) {
    return !hash || hash === ZERO_HASH;
  }

  /** Saldo relayer + flag lowBalance (threshold RELAYER_MIN_BALANCE_ETH, default 0.02). Read-only. */
  async relayerBalance(chainReady = true): Promise<RelayerBalance> {
    const wallet = this.getRelayer();
    const minBalance = env().blockchain.relayerMinBalanceEth;
    const balance = chainReady ? await this.getProvider().getBalance(wallet.address) : null;
    return {
      address: wallet.address,
      balance: balance === null ? null : ethers.formatEther(balance),
      lowBalance: balance !== null && balance < ethers.parseEther(minBalance),
      minBalance,
    };
  }

  /** BFD-49: nonce berikutnya menurut provider, termasuk tx relayer yang masih di mempool. */
  async pendingNonce(): Promise<number> {
    return this.getProvider().getTransactionCount(this.getRelayer().address, 'pending');
  }

  async feeData(): Promise<FeeData> {
    const f = await this.getProvider().getFeeData();
    return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas, gasPrice: f.gasPrice };
  }

  /**
   * BFD-92: agregat biaya gas notarisasi di chain aktif. Dua query aggregate (bukan memuat baris), jadi aman
   * dipanggil dashboard admin yang polling. Gagal (mis. migration belum jalan) → null, dashboard tetap tampil.
   */
  async feeStats(now = new Date()): Promise<FeeStats | null> {
    const { chainId } = this.target();
    const base = { status: 'CONFIRMED', chainId, feeWei: { not: null } };
    try {
      const [all, recent] = await Promise.all([
        this.prisma.blockchainTransaction.aggregate({
          where: base,
          _count: { _all: true },
          _sum: { feeWei: true, gasUsed: true },
        }),
        this.prisma.blockchainTransaction.aggregate({
          where: { ...base, confirmedAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
          _count: { _all: true },
          _sum: { feeWei: true },
        }),
      ]);
      const summarize = (count: number, total: bigint) => ({
        count,
        totalFeeEth: ethers.formatEther(total),
        avgFeeEth: count ? ethers.formatEther(total / BigInt(count)) : null,
      });
      return {
        ...summarize(all._count._all, toWei(all._sum.feeWei)),
        totalGasUsed: toWei(all._sum.gasUsed).toString(),
        last24h: summarize(recent._count._all, toWei(recent._sum.feeWei)),
      };
    } catch (e) {
      this.logger.warn(`Statistik biaya gas gagal dibaca: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Info chain untuk admin (GET admin/stats → `chain`) dan publik (GET blockchain/info).
   * `fees: false` dipakai endpoint publik supaya tidak menambah query DB.
   */
  async info(opts: { fees?: boolean } = {}) {
    const target = this.target();
    const health = await this.health();
    let relayer: RelayerBalance | null = null;
    try {
      relayer = await this.relayerBalance(health.ready);
    } catch {
      relayer = null;
    }
    return {
      ...target,
      ready: health.ready,
      reason: health.reason ?? null,
      relayer,
      explorerUrl: target.contractAddress ? explorerAddressUrl(target.chainId, target.contractAddress) : null,
      ...(opts.fees === false ? {} : { fees: await this.feeStats() }),
    };
  }

  explorerTx(chainId: number, txHash: string | null) {
    return txHash ? explorerTxUrl(chainId, txHash) : null;
  }

  /** Ambil nama custom error dari revert contract (AlreadyNotarized, ZeroHash, ...). */
  parseRevert(error: unknown): string | null {
    const err = error as { revert?: { name?: string }; data?: string; info?: { error?: { data?: string } } };
    if (err?.revert?.name) return err.revert.name;
    const data = err?.data ?? err?.info?.error?.data;
    if (typeof data === 'string' && data.startsWith('0x')) {
      try {
        const iface = new ethers.Interface(DONATION_REGISTRY_ABI as unknown as string[]);
        return iface.parseError(data)?.name ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }
}
