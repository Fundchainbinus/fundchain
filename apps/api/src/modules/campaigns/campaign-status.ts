import type { CampaignStatus } from '@fundchain/shared';
import { AppError } from '../../common/app-error';

/** State machine campaign — satu-satunya tempat transisi status didefinisikan. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['ACTIVE', 'REJECTED'],
  REJECTED: ['PENDING_REVIEW'],
  ACTIVE: ['FROZEN', 'COMPLETED'],
  COMPLETED: ['FROZEN'],
  FROZEN: ['ACTIVE', 'COMPLETED'],
};

export const EDITABLE_STATUSES: CampaignStatus[] = ['DRAFT', 'REJECTED'];
export const DISBURSABLE_STATUSES: CampaignStatus[] = ['ACTIVE', 'COMPLETED'];

export function canTransition(from: string, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from as CampaignStatus]?.includes(to) ?? false;
}

export function assertTransition(from: string, to: CampaignStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError('CAMPAIGN_INVALID_STATUS', `Status campaign tidak bisa diubah dari ${from} ke ${to}.`);
  }
}
