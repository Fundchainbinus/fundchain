import { Injectable, Logger } from '@nestjs/common';
import { hashDonation } from '@fundchain/shared';
import { AppError } from '../../common/app-error';
import { env } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { CampaignsService } from '../campaigns/campaigns.service';

export interface VerifyResult {
  donationId: string;
  campaignId: string;
  status: 'VERIFIED' | 'TAMPERED';
  currentPayload: string;
  currentHash: string;
  storedHash: string | null;
  onChainHash: string;
  campaignFrozen: boolean;
  checkedAt: Date;
}

/** Asal pemicu pengecekan — dicatat di audit log sebagai bagian dari tamper tracing. */
export type CheckSource = 'MANUAL' | 'SCHEDULED' | 'NOTARIZATION' | 'DEMO';

export interface CheckTrace {
  ip?: string | null;
  userAgent?: string | null;
  source?: CheckSource;
}

/**
 * Integrity checker: hitung ulang hash dari data DB SAAT INI lalu bandingkan dengan hash on-chain.
 *   match    → VERIFIED
 *   mismatch → TAMPERED → campaign FROZEN → disbursement terkunci
 */
@Injectable()
export class IntegrityService {
  private readonly logger = new Logger('Integrity');

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchain: BlockchainService,
    private readonly campaigns: CampaignsService,
    private readonly audit: AuditService,
  ) {}

  async verifyDonation(donationId: string, actorId: string | null, trace: CheckTrace = {}): Promise<VerifyResult> {
    const source = trace.source ?? 'MANUAL';
    const donation = await this.prisma.donation.findUnique({
      where: { id: donationId },
      include: { donor: true, blockchain: true },
    });
    if (!donation) throw new AppError('DONATION_NOT_FOUND', 'Donasi tidak ditemukan.');
    if (donation.status !== 'PAID' || !donation.donatedAt || !donation.blockchain) {
      throw new AppError('BLOCKCHAIN_NOT_NOTARIZED', 'Donasi belum dibayar / belum masuk antrean notarisasi.');
    }
    if (donation.blockchain.status !== 'CONFIRMED') {
      throw new AppError('BLOCKCHAIN_NOT_NOTARIZED', `Notarisasi masih berstatus ${donation.blockchain.status}.`);
    }

    const onChainHash = await this.blockchain.readOnchainHash(donation.blockchain.onchainKey);
    if (this.blockchain.isZero(onChainHash)) {
      throw new AppError('BLOCKCHAIN_NOT_NOTARIZED', 'Hash donasi tidak ditemukan di blockchain.');
    }

    // Rebuild dari data DB sekarang — inilah yang mendeteksi manipulasi.
    const current = hashDonation({
      donationId: donation.id,
      integritySubjectId: donation.donor.integritySubjectId,
      amount: donation.amount,
      donatedAt: donation.donatedAt,
    });
    const match = current.hash.toLowerCase() === onChainHash.toLowerCase();
    const checkedAt = new Date();
    const previousStatus = donation.integrityStatus;
    // Cek terjadwal yang hasilnya sama dengan sebelumnya tidak perlu dicatat ulang tiap jam.
    const unchangedScheduled = source === 'SCHEDULED' && previousStatus === (match ? 'VERIFIED' : 'TAMPERED');

    let campaignFrozen = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.donation.update({
        where: { id: donation.id },
        data: { integrityStatus: match ? 'VERIFIED' : 'TAMPERED', lastCheckedAt: checkedAt },
      });
      if (!unchangedScheduled) {
        await this.audit.log(
          {
            actorId,
            action: match ? 'INTEGRITY_VERIFIED' : 'INTEGRITY_TAMPERED',
            entityType: 'Donation',
            entityId: donation.id,
            metadata: match
              ? { source, previousStatus, currentHash: current.hash, onChainHash, campaignId: donation.campaignId }
              : {
                  // Tamper tracing: cukup untuk menelusuri apa yang berubah dan kapan terdeteksi.
                  source,
                  previousStatus,
                  firstDetection: previousStatus !== 'TAMPERED',
                  campaignId: donation.campaignId,
                  storedHash: donation.hash,
                  currentHash: current.hash,
                  onChainHash,
                  txHash: donation.blockchain!.txHash,
                  currentData: { amount: donation.amount, donatedAt: donation.donatedAt!.toISOString() },
                  donationLastModifiedAt: donation.updatedAt.toISOString(),
                  detectedAt: checkedAt.toISOString(),
                },
            ipAddress: trace.ip,
            userAgent: trace.userAgent,
          },
          tx,
        );
      }
      if (!match) {
        const result = await this.campaigns.freeze(
          tx,
          donation.campaignId,
          `Integrity check: donasi ${donation.id} TAMPERED (hash DB ≠ hash on-chain)`,
          actorId,
          trace.ip ?? null,
          trace.userAgent ?? null,
        );
        campaignFrozen = true;
        if (result.changed) this.logger.warn(`Campaign ${donation.campaignId} FROZEN karena donasi ${donation.id} TAMPERED`);
      }
    });

    return {
      donationId: donation.id,
      campaignId: donation.campaignId,
      status: match ? 'VERIFIED' : 'TAMPERED',
      currentPayload: current.payload,
      currentHash: current.hash,
      storedHash: donation.hash,
      onChainHash,
      campaignFrozen,
      checkedAt,
    };
  }

  /** Verifikasi semua donasi PAID yang sudah ternotarisasi (per campaign atau seluruh sistem). */
  async verifyMany(actorId: string | null, campaignId?: string, trace: CheckTrace = {}) {
    const donations = await this.prisma.donation.findMany({
      where: { campaignId, status: 'PAID', blockchain: { status: 'CONFIRMED' } },
      select: { id: true },
      orderBy: { donatedAt: 'asc' },
    });
    const results: VerifyResult[] = [];
    const errors: { donationId: string; code: string; message: string }[] = [];
    for (const { id } of donations) {
      try {
        results.push(await this.verifyDonation(id, actorId, trace));
      } catch (e) {
        if (e instanceof AppError && e.code === 'BLOCKCHAIN_RPC_ERROR') throw e;
        errors.push({ donationId: id, code: (e as AppError).code ?? 'INTERNAL_ERROR', message: (e as Error).message });
      }
    }
    const skipped = await this.prisma.donation.count({
      where: { campaignId, status: 'PAID', NOT: { blockchain: { status: 'CONFIRMED' } } },
    });
    return {
      checked: results.length,
      verified: results.filter((r) => r.status === 'VERIFIED').length,
      tampered: results.filter((r) => r.status === 'TAMPERED').length,
      skippedNotNotarized: skipped,
      frozenCampaigns: [...new Set(results.filter((r) => r.campaignFrozen).map((r) => r.campaignId))],
      results,
      errors,
    };
  }

  /**
   * Hash checker otomatis (dipanggil worker / cron): cek ulang donasi yang terakhir dicek
   * lebih lama dari INTEGRITY_CHECK_INTERVAL_MS. Dibatasi per batch supaya aman di serverless.
   */
  async verifyStale(now = new Date()) {
    const { checkIntervalMs, batchSize } = env().integrity;
    const cutoff = new Date(now.getTime() - checkIntervalMs);
    const due = await this.prisma.donation.findMany({
      where: {
        status: 'PAID',
        // Hanya notarisasi milik chain aktif — dev lokal & production bisa berbagi database.
        blockchain: { status: 'CONFIRMED', chainId: this.blockchain.target().chainId },
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: cutoff } }],
      },
      select: { id: true },
      orderBy: { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: batchSize,
    });
    let verified = 0;
    let tampered = 0;
    let failed = 0;
    for (const { id } of due) {
      try {
        const r = await this.verifyDonation(id, null, { source: 'SCHEDULED' });
        if (r.status === 'TAMPERED') tampered++;
        else verified++;
      } catch (e) {
        if (e instanceof AppError && e.code === 'BLOCKCHAIN_RPC_ERROR') throw e; // RPC down → coba lagi tick berikutnya
        failed++;
        this.logger.warn(`Cek terjadwal donasi ${id} gagal: ${(e as Error).message}`);
      }
    }
    if (due.length) {
      const msg = `Hash checker terjadwal: ${due.length} dicek, ${verified} VERIFIED, ${tampered} TAMPERED, ${failed} gagal`;
      if (tampered) this.logger.warn(msg);
      else this.logger.log(msg);
    }
    return { checked: due.length, verified, tampered, failed };
  }

  /**
   * Data halaman "Bukti Donasi": hash DB vs hash on-chain + bukti transaksi.
   * Read-only — tidak mengubah status integritas (itu tugas checker).
   */
  async proof(donationId: string) {
    const donation = await this.prisma.donation.findUnique({
      where: { id: donationId },
      include: { donor: { select: { integritySubjectId: true } }, blockchain: true },
    });
    if (!donation) throw new AppError('DONATION_NOT_FOUND', 'Donasi tidak ditemukan.');
    const bc = donation.blockchain;

    const currentHash =
      donation.status === 'PAID' && donation.donatedAt
        ? hashDonation({
            donationId: donation.id,
            integritySubjectId: donation.donor.integritySubjectId,
            amount: donation.amount,
            donatedAt: donation.donatedAt,
          }).hash
        : null;

    let hashOnChain: string | null = null;
    let onChainError: string | null = null;
    if (bc?.status === 'CONFIRMED') {
      try {
        const h = await this.blockchain.readOnchainHash(bc.onchainKey);
        hashOnChain = this.blockchain.isZero(h) ? null : h;
      } catch (e) {
        onChainError = (e as Error).message;
      }
    }

    const chainId = bc?.chainId ?? this.blockchain.target().chainId;
    return {
      donationId: donation.id,
      campaignId: donation.campaignId,
      integrityStatus: donation.integrityStatus,
      lastCheckedAt: donation.lastCheckedAt,
      /** Hash yang disimpan DB saat settlement (yang dikirim ke chain). */
      hashDb: donation.hash,
      /** Hash yang dihitung ulang dari data DB saat ini — beda dari hashOnChain berarti data diubah. */
      currentHash,
      hashOnChain,
      match: currentHash && hashOnChain ? currentHash.toLowerCase() === hashOnChain.toLowerCase() : null,
      txHash: bc?.txHash ?? null,
      blockNumber: bc?.blockNumber ?? null,
      /** Waktu notarisasi terkonfirmasi di blockchain. */
      timestamp: bc?.confirmedAt ?? null,
      donatedAt: donation.donatedAt,
      notarizationStatus: bc?.status ?? null,
      network: bc?.network ?? this.blockchain.target().network,
      chainId,
      contractAddress: bc?.contractAddress ?? (this.blockchain.target().contractAddress || null),
      etherscanUrl: this.blockchain.explorerTx(chainId, bc?.txHash ?? null),
      onChainError,
      checkedAt: new Date(),
    };
  }
}
