const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleOAuth {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string }) => void;
  }): { requestAccessToken(opts?: { prompt?: string }): void };
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth } };
  }
}

let loading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Gagal memuat Google Sign-In. Periksa koneksi internet.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Buka popup login Google dan kembalikan access token. Harus dipanggil dari klik pengguna. */
export async function requestGoogleAccessToken(clientId: string): Promise<string> {
  await loadGis();
  return new Promise<string>((resolve, reject) => {
    window
      .google!.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error ?? 'Login Google gagal.'))),
        error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Popup login ditutup.' : 'Login Google gagal.')),
      })
      .requestAccessToken({ prompt: 'select_account' });
  });
}
