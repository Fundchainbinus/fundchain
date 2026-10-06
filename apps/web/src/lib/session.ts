import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Sesi login Google. Hanya token sesi dari API yang disimpan; role selalu ditentukan backend.
 */
interface SessionState {
  token: string | null;
  setToken: (token: string | null) => void;
}

export const useSession = create<SessionState>()(
  persist((set) => ({ token: null, setToken: (token) => set({ token }) }), {
    name: 'fundchain-session-google',
  }),
);
