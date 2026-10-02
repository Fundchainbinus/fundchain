import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HARDHAT_CHAIN_ID, LIMITS } from '@fundchain/shared';
import type { BlockchainTransaction } from '@prisma/client';
import { waitUntil } from '@vercel/functions';
import type { ContractTransactionResponse } from 'ethers';
import { env } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { IntegrityService } from '../integrity/integrity.service';
import { PaymentsService } from '../payments/payments.service';
import { BlockchainService } from './blockchain.service';

const HOUSEKEEPING_MS = 60_000;
const STUCK_SUBMITTED_MS = 120_000;

/**
 * Worker notarisasi (in-process).
 * Antrean = tabel blockchain_transactions (outbox pattern) — tidak butuh Redis untuk local.
 * State: QUEUED → SUBMITTED → CONFIRMED · gagal → RETRYING (backoff 2s,4s,8s,16s) · max 5x → FAILED.
 * Invariant: status PAID donasi TIDAK PERNAH diubah oleh worker (BR-BC-004).
 */
@Injectable()
export class NotarizationWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NotarizationWorker');
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastHousekeeping = 0;
  private chainReady = false;
  private lastNotReadyReason = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchain: BlockchainService,
    private readonly integrity: IntegrityService,
    private readonly campaigns: CampaignsService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    const cfg = env().worker;
    if (!cfg.enabled) {
      this.logger.log('Worker dinonaktifkan (WORKER_ENABLED=false)');
      return;
    }
    if (cfg.mode === 'on-demand') {
      this.logger.log('Worker mode on-demand: dipicu oleh request & cron (serverless)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), cfg.pollMs);
    this.logger.log(`Worker aktif, polling tiap ${cfg.pollMs}ms`);
  }

  /**
   * Mode serverless: jalankan satu tick di latar belakang tanpa menahan response.
   * waitUntil() menjaga fungsi Vercel tetap hidup sampai tick selesai.
   * Di mode interval tidak melakukan apa pun (polling sudah berjalan).
   */
  kick() {
    const cfg = env().worker;
    if (!cfg.enabled || cfg.mode !== 'on-demand' || this.running) return;
    const work = this.tick();
    try {
      waitUntil(work);
    } catch {
      /* di luar Vercel: promise tetap berjalan normal */
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.housekeeping();
      const health = await this.blockchain.health();
      if (!health.ready) {
        if (health.reason !== this.lastNotReadyReason) {
          this.logger.warn(`Blockchain belum siap: ${health.reason}. Notarisasi ditunda.`);
          this.lastNotReadyReason = health.reason ?? '';
        }
        this.chainReady = false;
        return;
      }
      if (!this.chainReady) {
        this.chainReady = true;
        this.lastNotReadyReason = '';
        this.logger.log(`Terhubung ke ${this.blockchain.target().network} @ ${this.blockchain.target().contractAddress}`);
        await this.resyncLocalChain();
      }
      await this.recoverStuck();
      const due = await this.prisma.blockchainTransaction.findMany({
        // Hanya antrean milik chain ini — dev lokal & production bisa berbagi database.
        where: { status: { in: ['QUEUED', 'RETRYING'] }, nextAttemptAt: { lte: new Date() }, chainId: this.blockchain.target().chainId },
        orderBy: { createdAt: 'asc' },
        take: 5,
      });
      for (const job of due) await this.process(job);
    } catch (e) {
      this.logger.error(`Tick gagal: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async process(job: BlockchainTransaction) {
    const donation = await this.prisma.donation.findUnique({ where: { id: job.donationId } });
    if (!donation || donation.status !== 'PAID' || !donation.hash) {
      await this.fail(job, 'Donasi bukan PAID atau hash kosong (BR-BC-001)');
      return;
    }
    const contractAddress = this.blockchain.target().contractAddress;
    try {
      const reader = this.blockchain.contract();
      // Idempotency: kalau sudah ada di chain (mis. crash setelah kirim tx), anggap sukses.
      if (await reader.isNotarized(job.onchainKey)) {
        await this.confirm(job, { txHash: job.txHash, blockNumber: job.blockNumber, contractAddress, already: true });
        return;
      }

      // Klaim atomic: di serverless beberapa instance bisa memproses antrean bersamaan.
      // Hanya pemenang klaim yang mengirim tx, sehingga tidak ada tx dobel.
      const claim = await this.prisma.blockchainTransaction.updateMany({
        where: { id: job.id, status: { in: ['QUEUED', 'RETRYING'] } },
        data: { status: 'SUBMITTED', submittedAt: new Date(), contractAddress, lastError: null },
      });
      if (claim.count === 0) return;

      const writer = this.blockchain.contract(true);
      const tx = (await writer.notarize(job.onchainKey, donation.hash)) as ContractTransactionResponse;
      await this.prisma.blockchainTransaction.update({ where: { id: job.id }, data: { txHash: tx.hash } });
      this.logger.log(`Tx terkirim untuk donasi ${job.donationId}: ${tx.hash}`);

      const receipt = await tx.wait(env().blockchain.confirmations);
      if (!receipt || receipt.status !== 1) throw new Error('Transaksi gagal di chain');
      await this.confirm(job, { txHash: tx.hash, blockNumber: receipt.blockNumber, contractAddress, already: false });
    } catch (e) {
      const revert = this.blockchain.parseRevert(e);
      if (revert === 'AlreadyNotarized') {
        await this.confirm(job, { txHash: job.txHash, blockNumber: job.blockNumber, contractAddress, already: true });
      } else if (revert === 'ZeroHash') {
        await this.fail(job, 'Contract menolak hash nol (ZeroHash)');
      } else {
        await this.retry(job, revert ?? (e as Error).message);
      }
    }
  }

  private async confirm(
    job: BlockchainTransaction,
    r: { txHash: string | null; blockNumber: number | null; contractAddress: string | null; already: boolean },
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.blockchainTransaction.update({
        where: { id: job.id },
        data: {
          status: 'CONFIRMED',
          txHash: r.txHash,
          blockNumber: r.blockNumber,
          contractAddress: r.contractAddress,
          confirmedAt: new Date(),
          lastError: null,
        },
      });
      await this.audit.log(
        {
          action: 'BLOCKCHAIN_NOTARIZED',
          entityType: 'Donation',
          entityId: job.donationId,
          metadata: { txHash: r.txHash, blockNumber: r.blockNumber, alreadyOnChain: r.already },
        },
        tx,
      );
    });
    this.logger.log(`Donasi ${job.donationId} CONFIRMED${r.blockNumber ? ` di block ${r.blockNumber}` : ''}`);
    // Verifikasi pasca-notarisasi: baca balik hash on-chain dan bandingkan dengan data DB.
    await this.integrity.verifyDonation(job.donationId, null).catch((e) => {
      this.logger.warn(`Verifikasi awal ${job.donationId} gagal: ${(e as Error).message}`);
    });
  }

  private async retry(job: BlockchainTransaction, reason: string) {
    const attempts = job.retryCount + 1;
    if (attempts >= LIMITS.NOTARIZE_MAX_ATTEMPTS) {
      await this.fail(job, reason, attempts);
      return;
    }
    const delay = 2000 * 2 ** (attempts - 1);
    await this.prisma.blockchainTransaction.update({
      where: { id: job.id },
      data: {
        status: 'RETRYING',
        retryCount: attempts,
        lastError: reason.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + delay),
      },
    });
    this.logger.warn(`Notarisasi ${job.donationId} gagal (percobaan ${attempts}), retry dalam ${delay / 1000}s: ${reason}`);
  }

  private async fail(job: BlockchainTransaction, reason: string, attempts = job.retryCount) {
    await this.prisma.$transaction(async (tx) => {
      await tx.blockchainTransaction.update({
        where: { id: job.id },
        data: { status: 'FAILED', retryCount: attempts, lastError: reason.slice(0, 500) },
      });
      await this.audit.log(
        { action: 'BLOCKCHAIN_NOTARIZE_FAILED', entityType: 'Donation', entityId: job.donationId, metadata: { reason } },
        tx,
      );
    });
    this.logger.error(`Notarisasi ${job.donationId} FAILED: ${reason}`);
  }

  /** SUBMITTED yang menggantung (mis. proses mati saat menunggu konfirmasi). */
  private async recoverStuck() {
    // Serverless: fungsi bisa berhenti setelah tx terkirim tapi sebelum konfirmasi ditunggu.
    // Tx yang sudah punya receipt cukup dikonfirmasi; tanpa receipt ditunggu sampai STUCK_SUBMITTED_MS.
    const pending = await this.prisma.blockchainTransaction.findMany({
      where: { status: 'SUBMITTED', txHash: { not: null }, submittedAt: { lt: new Date(Date.now() - 5_000) }, chainId: this.blockchain.target().chainId },
    });
    for (const job of pending) {
      const receipt = await this.blockchain.getProvider().getTransactionReceipt(job.txHash!).catch(() => null);
      if (!receipt) continue;
      if (receipt.status === 1 && (await receipt.confirmations()) >= env().blockchain.confirmations) {
        await this.confirm(job, { txHash: job.txHash, blockNumber: receipt.blockNumber, contractAddress: job.contractAddress, already: false });
      } else if (receipt.status === 0) {
        await this.retry(job, 'Transaksi di-revert oleh chain');
      }
    }

    const stuck = await this.prisma.blockchainTransaction.findMany({
      where: { status: 'SUBMITTED', submittedAt: { lt: new Date(Date.now() - STUCK_SUBMITTED_MS) }, chainId: this.blockchain.target().chainId },
    });
    for (const job of stuck) {
      const notarized = await this.blockchain.contract().isNotarized(job.onchainKey).catch(() => null);
      if (notarized === null) continue;
      if (notarized) {
        const receipt = job.txHash
          ? await this.blockchain.getProvider().getTransactionReceipt(job.txHash).catch(() => null)
          : null;
        await this.confirm(job, {
          txHash: job.txHash,
          blockNumber: receipt?.blockNumber ?? null,
          contractAddress: job.contractAddress,
          already: true,
        });
      } else {
        await this.retry(job, 'Transaksi tidak terkonfirmasi (dropped), dikirim ulang');
      }
    }
  }

  /**
   * Khusus Hardhat lokal: node in-memory hilang setiap restart. Record CONFIRMED yang tidak
   * ada lagi di chain dinotarisasi ulang memakai hash yang TERSIMPAN saat settlement
   * (bukan dihitung ulang), sehingga data yang sudah dimanipulasi tetap terdeteksi.
   */
  private async resyncLocalChain() {
    const { chainId, contractAddress } = this.blockchain.target();
    if (chainId !== HARDHAT_CHAIN_ID) return;
    const confirmed = await this.prisma.blockchainTransaction.findMany({
      where: { status: { in: ['CONFIRMED', 'SUBMITTED'] }, chainId: HARDHAT_CHAIN_ID },
    });
    let requeued = 0;
    for (const job of confirmed) {
      const exists = await this.blockchain.contract().isNotarized(job.onchainKey).catch(() => true);
      if (exists) continue;
      await this.prisma.blockchainTransaction.update({
        where: { id: job.id },
        data: {
          status: 'QUEUED',
          txHash: null,
          blockNumber: null,
          confirmedAt: null,
          submittedAt: null,
          retryCount: 0,
          contractAddress,
          nextAttemptAt: new Date(),
          lastError: 'Chain lokal di-reset, notarisasi ulang',
        },
      });
      requeued++;
    }
    if (requeued) {
      this.logger.warn(`Chain lokal baru: ${requeued} notarisasi diantrekan ulang`);
      await this.audit.log({ action: 'BLOCKCHAIN_LOCAL_RESYNC', entityType: 'System', metadata: { requeued } });
    }
  }

  private async housekeeping() {
    if (Date.now() - this.lastHousekeeping < HOUSEKEEPING_MS) return;
    this.lastHousekeeping = Date.now();
    const expired = await this.payments.expireStale().catch(() => 0);
    const completed = await this.campaigns.completeExpired().catch(() => 0);
    if (expired || completed) this.logger.log(`Housekeeping: ${expired} pembayaran expired, ${completed} campaign selesai`);
  }
}
