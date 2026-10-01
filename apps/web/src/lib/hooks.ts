import { useQuery } from '@tanstack/react-query';
import { get } from './api';
import { useSession } from './session';
import type { ChainInfo, User } from './types';

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => get<User[]>('/users'), staleTime: 60_000 });
}

/** Pengguna aktif (persona yang dipilih). */
export function useMe() {
  const id = useSession((s) => s.actingUserId);
  const users = useUsers();
  const me = users.data?.find((u) => u.id === id) ?? null;
  return { me, isLoading: users.isLoading, isAdmin: me?.role === 'ADMIN' };
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () =>
      get<{ demoMode: boolean; devTools: boolean; paymentProvider: string; chain: { network: string; chainId: number } }>(
        '/config',
      ),
    staleTime: 60_000,
  });
}

export function useChainInfo() {
  return useQuery({ queryKey: ['chain'], queryFn: () => get<ChainInfo>('/blockchain/info'), refetchInterval: 15_000 });
}
