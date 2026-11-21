/**
 * Kumpulkan bukti notarisasi on-chain (BFD-50/90) — READ-ONLY, tanpa secret.
 *
 * Sengaja TIDAK meng-import `hardhat` / tidak memakai `--network sepolia`:
 * hardhat.config.ts menjalankan dotenv dan bisa ikut memuat private key.
 * Script ini hanya memakai ethers JsonRpcProvider ke RPC publik.
 *
 * Pakai (dari folder contracts/):
 *   npx ts-node scripts/collect-evidence.ts
 *
 * Env opsional (semuanya bukan secret):
 *   EVIDENCE_RPC_URL      default https://sepolia.gateway.tenderly.co (RPC publik tanpa key).
 *                         Catatan: publicnode memangkas histori log (error 4444 "pruned
 *                         history unavailable"), jadi tidak bisa dipakai untuk getLogs lama.
 *   EVIDENCE_DEPLOYMENT   default deployments/sepolia.json
 *   EVIDENCE_CHUNK        ukuran awal range eth_getLogs (default 10000 blok)
 *   EVIDENCE_VERIFY_COUNT jumlah event yang dicek ulang via verify() (default 3)
 *   EVIDENCE_JSON         path output JSON (opsional)
 */
import { Contract, JsonRpcProvider, formatEther, getAddress } from 'ethers';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ABI = [
  'event DonationNotarized(bytes32 indexed donationId, bytes32 hash, uint256 timestamp, address notarizedBy)',
  'function verify(bytes32 donationId) view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function RELAYER_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
];

interface EvidenceRow {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  blockTimestamp: number;
  donationKey: string;
  hash: string;
  eventTimestamp: number;
  notarizedBy: string;
}

async function getLogsChunked(
  provider: JsonRpcProvider,
  contract: Contract,
  fromBlock: number,
  toBlock: number,
  initialChunk: number,
) {
  const filter = contract.filters.DonationNotarized();
  const topics = await filter.getTopicFilter();
  const address = await contract.getAddress();
  const logs = [];
  let chunk = initialChunk;
  let start = fromBlock;
  while (start <= toBlock) {
    const end = Math.min(start + chunk - 1, toBlock);
    try {
      const part = await provider.getLogs({ address, topics, fromBlock: start, toBlock: end });
      logs.push(...part);
      console.error(`  blok ${start}-${end}: ${part.length} event`);
      start = end + 1;
    } catch (e) {
      if (chunk <= 500) throw e;
      chunk = Math.floor(chunk / 2);
      console.error(`  getLogs gagal (${(e as Error).message.slice(0, 80)}), perkecil chunk ->${chunk}`);
    }
  }
  return logs;
}

async function main() {
  const rpcUrl = process.env.EVIDENCE_RPC_URL || 'https://sepolia.gateway.tenderly.co';
  const depFile = path.resolve(
    __dirname,
    '..',
    process.env.EVIDENCE_DEPLOYMENT || path.join('deployments', 'sepolia.json'),
  );
  const chunk = Number(process.env.EVIDENCE_CHUNK || 10_000);
  const verifyCount = Number(process.env.EVIDENCE_VERIFY_COUNT || 3);

  const dep = JSON.parse(fs.readFileSync(depFile, 'utf8'));
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const { chainId } = await provider.getNetwork();
  if (Number(chainId) !== dep.chainId) {
    throw new Error(`chainId RPC ${chainId} != deployment ${dep.chainId}`);
  }
  const contract = new Contract(dep.address, ABI, provider);
  const latest = await provider.getBlockNumber();

  console.error(`RPC        : ${rpcUrl}`);
  console.error(`Contract   : ${dep.address}`);
  console.error(`Range blok : ${dep.blockNumber} - ${latest}`);

  const logs = await getLogsChunked(provider, contract, dep.blockNumber, latest, chunk);

  const blockTs = new Map<number, number>();
  const rows: EvidenceRow[] = [];
  for (const log of logs) {
    const parsed = contract.interface.parseLog(log)!;
    if (!blockTs.has(log.blockNumber)) {
      const b = await provider.getBlock(log.blockNumber);
      blockTs.set(log.blockNumber, b!.timestamp);
    }
    rows.push({
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      blockTimestamp: blockTs.get(log.blockNumber)!,
      donationKey: parsed.args.donationId,
      hash: parsed.args.hash,
      eventTimestamp: Number(parsed.args.timestamp),
      notarizedBy: getAddress(parsed.args.notarizedBy),
    });
  }

  // verify() ulang untuk N event: pertama, tengah, terakhir.
  const picks = [...new Set([0, Math.floor(rows.length / 2), rows.length - 1])]
    .filter((i) => i >= 0 && i < rows.length)
    .slice(0, verifyCount);
  const verifications = [];
  for (const i of picks) {
    const onchain: string = await contract.verify(rows[i].donationKey);
    verifications.push({
      donationKey: rows[i].donationKey,
      txHash: rows[i].txHash,
      eventHash: rows[i].hash,
      verifyResult: onchain,
      match: onchain.toLowerCase() === rows[i].hash.toLowerCase(),
    });
  }

  const relayerRole: string = await contract.RELAYER_ROLE();
  const adminRole: string = await contract.DEFAULT_ADMIN_ROLE();
  const notarizers = [...new Set(rows.map((r) => r.notarizedBy))];
  const roles = {
    relayerInDeployment: dep.relayer,
    relayerHasRole: (await contract.hasRole(relayerRole, dep.relayer)) as boolean,
    adminInDeployment: dep.admin,
    adminHasDefaultAdmin: (await contract.hasRole(adminRole, dep.admin)) as boolean,
  };
  const relayerBalanceEth = formatEther(await provider.getBalance(dep.relayer));
  const code = await provider.getCode(dep.address);

  const result = {
    collectedAt: new Date().toISOString(),
    rpcUrl,
    chainId: Number(chainId),
    contract: dep.address,
    deploymentBlock: dep.blockNumber,
    latestBlockScanned: latest,
    contractCodeBytes: (code.length - 2) / 2,
    totalEvents: rows.length,
    notarizers,
    roles,
    relayerBalanceEth,
    verifications,
    events: rows,
  };

  if (process.env.EVIDENCE_JSON) {
    fs.writeFileSync(process.env.EVIDENCE_JSON, JSON.stringify(result, null, 2));
    console.error(`JSON disimpan ke ${process.env.EVIDENCE_JSON}`);
  }

  console.log(`Total event DonationNotarized: ${rows.length} (blok ${dep.blockNumber}-${latest})`);
  console.log(`Saldo relayer ${dep.relayer}: ${relayerBalanceEth} ETH`);
  console.log(`Role: ${JSON.stringify(roles)}`);
  console.log('');
  console.log('| # | Tx | Blok | Waktu (UTC) | donationId key | hash |');
  console.log('|---|----|------|-------------|----------------|------|');
  rows.forEach((r, i) => {
    const t = new Date(r.blockTimestamp * 1000).toISOString().replace('.000Z', 'Z');
    console.log(
      `| ${i + 1} | [${r.txHash.slice(0, 10)}...](https://sepolia.etherscan.io/tx/${r.txHash}) | ${r.blockNumber} | ${t} | \`${r.donationKey}\` | \`${r.hash}\` |`,
    );
  });
  console.log('');
  for (const v of verifications) {
    console.log(`verify(${v.donationKey}) = ${v.verifyResult} -> ${v.match ? 'MATCH' : 'MISMATCH'} (tx ${v.txHash})`);
  }
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
