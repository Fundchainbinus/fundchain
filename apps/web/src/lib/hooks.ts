import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, get } from './api';
import { useSession } from './session';
import type { ChainInfo, User } from './types';

/** Pengguna yang sedang login (null bila belum login / sesi kedaluwarsa). */
export function useMe() {
  const token = useSession((s) => s.token);
  const q = useQuery({
    queryKey: ['me', token],
    queryFn: () => get<User>('/me'),
    enabled: !!token,
    staleTime: 60_000,
    retry: false,
  });
  const setToken = useSession((s) => s.setToken);
  // Sesi kedaluwarsa / user hilang → keluar otomatis.
  useEffect(() => {
    if (token && q.error instanceof ApiError && q.error.status === 401) setToken(null);
  }, [token, q.error, setToken]);
  const me = token ? (q.data ?? null) : null;
  return { me, isLoading: !!token && q.isLoading, isAdmin: me?.role === 'ADMIN' };
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () =>
      get<{ googleClientId: string; devTools: boolean; paymentProvider: string; chain: { network: string; chainId: number } }>(
        '/config',
      ),
    staleTime: 60_000,
  });
}

export function useChainInfo() {
  return useQuery({ queryKey: ['chain'], queryFn: () => get<ChainInfo>('/blockchain/info'), refetchInterval: 15_000 });
}
