/**
 * Pindahkan catatan notarisasi dari chain lokal (Hardhat, 31337) ke antrean Sepolia.
 * Hash yang dinotarisasi tetap hash TERSIMPAN saat settlement — tidak dihitung ulang.
 *   pnpm --filter @fundchain/api exec ts-node --transpile-only scripts/move-to-sepolia.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.blockchainTransaction.findMany({ where: { chainId: 31337 }, select: { donationId: true } });
  const { count } = await prisma.blockchainTransaction.updateMany({
    where: { chainId: 31337 },
    data: {
      network: 'sepolia',
      chainId: 11155111,
      contractAddress: null,
      status: 'QUEUED',
      txHash: null,
      blockNumber: null,
      submittedAt: null,
      confirmedAt: null,
      retryCount: 0,
      nextAttemptAt: new Date(),
      lastError: 'Dipindahkan dari chain lokal ke Sepolia',
    },
  });
  await prisma.auditLog.create({
    data: {
      action: 'BLOCKCHAIN_MOVED_TO_SEPOLIA',
      entityType: 'System',
      metadata: JSON.stringify({ count, donationIds: rows.map((r) => r.donationId) }),
    },
  });
  const queued = await prisma.blockchainTransaction.count({ where: { chainId: 11155111, status: { in: ['QUEUED', 'RETRYING'] } } });
  console.log(`Dipindahkan: ${count} · total antrean Sepolia: ${queued}`);
}

main().finally(() => prisma.$disconnect());
