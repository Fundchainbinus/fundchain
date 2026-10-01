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

  async info() {
    const target = this.target();
    const health = await this.health();
    let relayer: { address: string; balance: string | null; lowBalance: boolean } | null = null;
    try {
      const wallet = this.getRelayer();
      const balance = health.ready ? await this.getProvider().getBalance(wallet.address) : null;
      relayer = {
        address: wallet.address,
        balance: balance === null ? null : ethers.formatEther(balance),
        lowBalance: balance !== null && balance < ethers.parseEther('0.02'),
      };
    } catch {
      relayer = null;
    }
    return {
      ...target,
      ready: health.ready,
      reason: health.reason ?? null,
      relayer,
      explorerUrl: target.contractAddress ? explorerAddressUrl(target.chainId, target.contractAddress) : null,
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
