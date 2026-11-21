import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Sesi login (BFD-11). Token sesi TIDAK disimpan di browser: API memasang cookie httpOnly
 * `fc_session` yang otomatis ikut terkirim (same-origin lewat rewrite /api). Yang disimpan di sini
 * hanya penanda non-sensitif "pernah login" supaya pengunjung anonim tidak memanggil /auth/me.
 * Role & identitas selalu ditentukan backend.
 */
interface SessionState {
  signedIn: boolean;
  setSignedIn: (signedIn: boolean) => void;
}

// Bersihkan token Bearer lama (sebelum BFD-11) dari localStorage.
try {
  localStorage.removeItem('fundchain-session-google');
} catch {
  /* storage tidak tersedia */
}

export const useSession = create<SessionState>()(
  persist((set) => ({ signedIn: false, setSignedIn: (signedIn) => set({ signedIn }) }), {
    name: 'fundchain-session',
  }),
);
