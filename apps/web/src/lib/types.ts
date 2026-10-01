import type {
  BlockchainStatus,
  CampaignStatus,
  DisbursementStatus,
  DonationStatus,
  IntegrityStatus,
  Role,
} from '@fundchain/shared';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  integritySubjectId: string;
}

export interface CampaignSummary {
  id: string;
  title: string;
  description: string;
  sdgCategory: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  status: CampaignStatus;
  rejectionReason: string | null;
  frozenReason: string | null;
  createdAt: string;
  creator: { id: string; name: string };
  donorCount: number;
}

export interface CampaignDetail extends Omit<CampaignSummary, 'donorCount'> {
  creatorId: string;
  donorCount: number;
  documents: { id: string; originalName: string; size: number; createdAt: string }[];
  reviews: { id: string; decision: 'APPROVE' | 'REJECT'; reason: string | null; createdAt: string; admin: { name: string } }[];
  integritySummary: Partial<Record<IntegrityStatus, number>>;
  funds: { raised: number; disbursed: number; approved: number; requested: number; available: number };
  viewer: { isOwner: boolean; isAdmin: boolean };
}

export interface PublicDonation {
  id: string;
  amount: number;
  donorName: string;
  donatedAt: string;
  hash: string | null;
  integrityStatus: IntegrityStatus;
  blockchainStatus: BlockchainStatus | null;
  txHash: string | null;
  explorerUrl: string | null;
}

export interface DonationDetail {
  id: string;
  amount: number;
  status: DonationStatus;
  isAnonymous: boolean;
  donor: { displayName: string; integritySubjectId: string };
  campaign: { id: string; title: string; status: CampaignStatus };
  donatedAt: string | null;
  createdAt: string;
  canonicalPayload: string | null;
  hash: string | null;
  integrityStatus: IntegrityStatus;
  lastCheckedAt: string | null;
  payment: {
    provider: string;
    method: string;
    status: string;
    amount: number;
    paidAt: string | null;
    expiresAt: string | null;
    qrString?: string | null;
    paymentUrl?: string | null;
  } | null;
  blockchain: {
    status: BlockchainStatus;
    network: string;
    chainId: number;
    contractAddress: string | null;
    onchainKey: string;
    txHash: string | null;
    blockNumber: number | null;
    retryCount: number;
    submittedAt: string | null;
    confirmedAt: string | null;
    explorerUrl: string | null;
    lastError?: string | null;
  } | null;
  viewer: { isDonor: boolean; isAdmin: boolean };
}

export interface MyDonation {
  id: string;
  amount: number;
  status: DonationStatus;
  campaign: { id: string; title: string; status: CampaignStatus };
  createdAt: string;
  donatedAt: string | null;
  integrityStatus: IntegrityStatus;
  blockchainStatus: BlockchainStatus | null;
  txHash: string | null;
}

export interface Disbursement {
  id: string;
  amount: number;
  description: string;
  status: DisbursementStatus;
  rejectionReason: string | null;
  requestedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  reviewedBy: string | null;
  proofName?: string;
}

export interface AdminDisbursement extends Omit<Disbursement, 'reviewedBy'> {
  campaign: { id: string; title: string; status: CampaignStatus; currentAmount: number };
  requester: { id: string; name: string };
  admin: { name: string } | null;
  proofName: string;
}

export interface VerifyResult {
  donationId: string;
  campaignId: string;
  status: 'VERIFIED' | 'TAMPERED';
  currentPayload: string;
  currentHash: string;
  storedHash: string | null;
  onChainHash: string;
  campaignFrozen: boolean;
  checkedAt: string;
}

export interface ChainInfo {
  network: string;
  chainId: number;
  contractAddress: string | null;
  ready: boolean;
  reason: string | null;
  relayer: { address: string; balance: string | null; lowBalance: boolean } | null;
  explorerUrl: string | null;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; name: string; role: string } | null;
}

export interface ActivityItem {
  id: string;
  action: string;
  actor: { name: string; role: string };
  metadata: Record<string, unknown>;
  createdAt: string;
}
