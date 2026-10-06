import { useQueryClient } from '@tanstack/react-query';
import { Blocks, LogIn, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { errorMessage, post } from '../lib/api';
import { requestGoogleAccessToken } from '../lib/google';
import { useChainInfo, useConfig, useMe } from '../lib/hooks';
import { useSession } from '../lib/session';

function GoogleAuthButton() {
  const { me } = useMe();
  const config = useConfig();
  const setToken = useSession((s) => s.setToken);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    const clientId = config.data?.googleClientId;
    if (!clientId) return setError('Login Google belum dikonfigurasi.');
    setBusy(true);
    setError(null);
    try {
      const accessToken = await requestGoogleAccessToken(clientId);
      const res = await post<{ token: string }>('/auth/google', { accessToken });
      setToken(res.token);
      setOpen(false);
      void qc.invalidateQueries();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    setToken(null);
    qc.clear();
  };

  if (me) {
    return (
      <div className="flex items-center gap-2 text-sm text-white">
        <span className="max-w-[160px] truncate" title={me.email}>
          {me.name}
        </span>
        <button
          onClick={logout}
          className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2.5 py-1.5 text-sm hover:bg-white/20"
        >
          <LogOut size={14} aria-hidden /> Keluar
        </button>
      </div>
    );
  }
  const close = () => {
    setOpen(false);
    setError(null);
  };
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
      >
        <LogIn size={14} aria-hidden /> Login
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Login"
        >
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <button onClick={close} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600" aria-label="Tutup">
              <X size={18} />
            </button>
            <Blocks size={32} className="mx-auto text-accent" aria-hidden />
            <h2 className="mt-3 text-xl font-bold text-slate-900">Masuk ke FundChain</h2>
            <p className="mt-1 text-sm text-slate-500">Gunakan akun Google Anda untuk melanjutkan.</p>
            <button
              onClick={login}
              disabled={busy}
              className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <GoogleLogo />
              {busy ? 'Menunggu popup Google…' : 'Login dengan Google'}
            </button>
            {error && (
              <p className="mt-3 text-xs text-red-600" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function ChainIndicator() {
  const { data } = useChainInfo();
  if (!data) return null;
  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-white/80 lg:inline-flex"
      title={data.ready ? `${data.network} · ${data.contractAddress}` : data.reason ?? ''}
    >
      <span className={`h-2 w-2 rounded-full ${data.ready ? 'bg-emerald-400' : 'bg-red-400'}`} />
      {data.ready ? `Chain: ${data.network}` : 'Chain offline'}
    </span>
  );
}

export function Layout() {
  const { me, isAdmin } = useMe();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const links = [
    { to: '/', label: 'Jelajahi', end: true },
    ...(me ? [{ to: '/my/campaigns', label: 'Campaign Saya' }, { to: '/my/donations', label: 'Donasi Saya' }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin' }] : []),
  ];
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 bg-navy shadow">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 text-white">
            <Blocks size={24} className="text-accent" aria-hidden />
            <span className="text-lg font-bold tracking-tight">FundChain</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigasi utama">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <ChainIndicator />
            <div className="hidden sm:block"><GoogleAuthButton /></div>
            <button className="text-white md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {open && (
          <div className="border-t border-white/10 px-4 pb-4 md:hidden" onClick={() => setOpen(false)}>
            <nav className="flex flex-col gap-1 pt-2">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-3 sm:hidden" onClick={(e) => e.stopPropagation()}><GoogleAuthButton /></div>
          </div>
        )}
      </header>

      <main key={location.pathname} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500">
          FundChain · Data di database, bukti di blockchain. Setiap donasi lunas di-hash (Keccak-256) dan dicatat di smart
          contract sehingga manipulasi data dapat terdeteksi.
        </div>
      </footer>
    </div>
  );
}

/** Pembatas halaman yang butuh identitas. */
export function RequireUser({ admin, children }: { admin?: boolean; children: React.ReactNode }) {
  const { me, isLoading, isAdmin } = useMe();
  if (isLoading) return null;
  if (!me || (admin && !isAdmin)) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-bold">{me && admin ? 'Khusus Admin' : 'Login dulu'}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {me && admin
            ? 'Halaman ini hanya untuk admin. Akun Google Anda tidak memiliki akses admin.'
            : 'Silakan klik "Login dengan Google" di pojok kanan atas untuk melanjutkan.'}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
