import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Mode demo tanpa login: pengguna aktif dipilih lewat persona switcher.
 * Hanya ID yang disimpan; role selalu ditentukan backend.
 */
interface SessionState {
  actingUserId: string | null;
  setActingUser: (id: string | null) => void;
}

export const useSession = create<SessionState>()(
  persist((set) => ({ actingUserId: null, setActingUser: (id) => set({ actingUserId: id }) }), {
    name: 'fundchain-session',
  }),
);
