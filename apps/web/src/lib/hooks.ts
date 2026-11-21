import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ApiError, get } from './api';
import { useSession } from './session';
import type { ChainInfo, User } from './types';

/** Pengguna yang sedang login (null bila belum login / sesi kedaluwarsa). */
export function useMe() {
  // Sesi ada di cookie httpOnly (BFD-11); `signedIn` hanya penanda supaya pengunjung anonim tidak memanggil /me.
  const signedIn = useSession((s) => s.signedIn);
  const q = useQuery({
    queryKey: ['me', signedIn],
    queryFn: () => get<User>('/auth/me'),
    enabled: signedIn,
    staleTime: 60_000,
    retry: false,
  });
  const setSignedIn = useSession((s) => s.setSignedIn);
  // Sesi kedaluwarsa / dicabut (logout di perangkat lain) / user hilang → keluar otomatis.
  useEffect(() => {
    if (signedIn && q.error instanceof ApiError && q.error.status === 401) setSignedIn(false);
  }, [signedIn, q.error, setSignedIn]);
  const me = signedIn ? (q.data ?? null) : null;
  return { me, isLoading: signedIn && q.isLoading, isAdmin: me?.role === 'ADMIN' };
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () =>
      get<{ googleClientId: string; devTools: boolean; demoMode?: boolean; paymentProvider: string; chain: { network: string; chainId: number } }>(
        '/config',
      ),
    staleTime: 60_000,
  });
}

export function useChainInfo() {
  return useQuery({ queryKey: ['chain'], queryFn: () => get<ChainInfo>('/blockchain/info'), refetchInterval: 15_000 });
}
