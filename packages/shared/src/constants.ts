export const ROLES = ['STUDENT', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'REJECTED',
  'FROZEN',
  'COMPLETED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** Status campaign yang boleh dilihat publik. */
export const PUBLIC_CAMPAIGN_STATUSES: CampaignStatus[] = ['ACTIVE', 'FROZEN', 'COMPLETED'];

export const DONATION_STATUSES = ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

export const INTEGRITY_STATUSES = ['PENDING', 'VERIFIED', 'TAMPERED'] as const;
export type IntegrityStatus = (typeof INTEGRITY_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'SETTLED', 'FAILED', 'EXPIRED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const BLOCKCHAIN_STATUSES = ['QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'RETRYING'] as const;
export type BlockchainStatus = (typeof BLOCKCHAIN_STATUSES)[number];

export const DISBURSEMENT_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'PAID'] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATUSES)[number];

export const REVIEW_DECISIONS = ['APPROVE', 'REJECT'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const SDG_CATEGORIES = [
  { code: 'NO_POVERTY', number: 1, label: 'Tanpa Kemiskinan' },
  { code: 'ZERO_HUNGER', number: 2, label: 'Tanpa Kelaparan' },
  { code: 'GOOD_HEALTH', number: 3, label: 'Kehidupan Sehat dan Sejahtera' },
  { code: 'QUALITY_EDUCATION', number: 4, label: 'Pendidikan Berkualitas' },
  { code: 'GENDER_EQUALITY', number: 5, label: 'Kesetaraan Gender' },
  { code: 'CLEAN_WATER', number: 6, label: 'Air Bersih dan Sanitasi Layak' },
  { code: 'CLEAN_ENERGY', number: 7, label: 'Energi Bersih dan Terjangkau' },
  { code: 'DECENT_WORK', number: 8, label: 'Pekerjaan Layak dan Pertumbuhan Ekonomi' },
  { code: 'INDUSTRY_INNOVATION', number: 9, label: 'Industri, Inovasi dan Infrastruktur' },
  { code: 'REDUCED_INEQUALITIES', number: 10, label: 'Berkurangnya Kesenjangan' },
  { code: 'SUSTAINABLE_CITIES', number: 11, label: 'Kota dan Permukiman Berkelanjutan' },
  { code: 'RESPONSIBLE_CONSUMPTION', number: 12, label: 'Konsumsi dan Produksi Bertanggung Jawab' },
  { code: 'CLIMATE_ACTION', number: 13, label: 'Penanganan Perubahan Iklim' },
  { code: 'LIFE_BELOW_WATER', number: 14, label: 'Ekosistem Lautan' },
  { code: 'LIFE_ON_LAND', number: 15, label: 'Ekosistem Daratan' },
  { code: 'PEACE_JUSTICE', number: 16, label: 'Perdamaian, Keadilan dan Kelembagaan yang Tangguh' },
  { code: 'PARTNERSHIPS', number: 17, label: 'Kemitraan untuk Mencapai Tujuan' },
] as const;
export type SdgCategory = (typeof SDG_CATEGORIES)[number]['code'];
export const SDG_CODES = SDG_CATEGORIES.map((s) => s.code) as SdgCategory[];

export const LIMITS = {
  DONATION_MIN: 10_000,
  DONATION_MAX: 1_000_000_000,
  TARGET_MAX: 1_000_000_000,
  TITLE_MIN: 5,
  TITLE_MAX: 200,
  DESCRIPTION_MIN: 20,
  REASON_MIN: 10,
  FILE_MAX_BYTES: 5 * 1024 * 1024,
  PAYMENT_EXPIRY_MINUTES: 15,
  NOTARIZE_MAX_ATTEMPTS: 5,
} as const;

/** ABI minimal DonationRegistry (human-readable, ethers v6). */
export const DONATION_REGISTRY_ABI = [
  'function notarize(bytes32 donationId, bytes32 hash)',
  'function verify(bytes32 donationId) view returns (bytes32)',
  'function isNotarized(bytes32 donationId) view returns (bool)',
  'function getRecord(bytes32 donationId) view returns (tuple(bytes32 hash, uint256 timestamp, address notarizedBy))',
  'function RELAYER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'event DonationNotarized(bytes32 indexed donationId, bytes32 hash, uint256 timestamp, address notarizedBy)',
  'error AlreadyNotarized(bytes32 donationId)',
  'error ZeroHash()',
] as const;

export const SEPOLIA_CHAIN_ID = 11155111;
export const HARDHAT_CHAIN_ID = 31337;

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  if (chainId === SEPOLIA_CHAIN_ID) return `https://sepolia.etherscan.io/tx/${txHash}`;
  return null;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  if (chainId === SEPOLIA_CHAIN_ID) return `https://sepolia.etherscan.io/address/${address}`;
  return null;
}
