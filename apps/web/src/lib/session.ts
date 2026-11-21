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

/**
 * Migrasi sekali jalan: hapus token Bearer lama (sebelum BFD-11) dari localStorage. Bila tadinya ada,
 * anggap "pernah login" supaya /auth/me dicoba — cookie mungkin sudah dipasang API baru; bila tidak,
 * 401 akan mereset penanda ini.
 */
function migrateLegacyToken(): boolean {
  try {
    const legacy = localStorage.getItem('fundchain-session-google');
    if (legacy === null) return false;
    localStorage.removeItem('fundchain-session-google');
    return legacy.includes('"token":"');
  } catch {
    return false;
  }
}

const hadLegacyToken = migrateLegacyToken();

export const useSession = create<SessionState>()(
  persist((set) => ({ signedIn: hadLegacyToken, setSignedIn: (signedIn) => set({ signedIn }) }), {
    name: 'fundchain-session',
  }),
);
