import { get } from './api';
import type { PointsSummary } from './types';

/** Poin comserve donatur (BFD-103), dihitung BE dari donasi PAID (GET /me/points). */
export function fetchMyPoints(): Promise<PointsSummary> {
  return get<PointsSummary>('/me/points');
}
