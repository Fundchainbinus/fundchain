import { useQueryClient } from '@tanstack/react-query';
import { Bell, Blocks, LogIn, LogOut, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { errorMessage, post } from '../lib/api';
import { requestGoogleAccessToken } from '../lib/google';
import { useConfig, useMe } from '../lib/hooks';
import { AppSidebar } from './AppSidebar';
import { RoleCard } from './RoleCard';
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
      <div className="relative">
        <button onClick={() => setOpen(!open)} aria-label="Menu akun" aria-expanded={open} className="block rounded-full">
          <Avatar name={me.name} />
        </button>
        {open && (
          <div className="absolute right-0 top-10 z-50 w-56 rounded-md border border-line bg-white p-3 text-sm shadow-lg">
            <p className="truncate font-semibold text-ink">{me.name}</p>
            <p className="truncate text-xs text-slate-500">{me.email}</p>
            <button onClick={logout} className="btn-secondary btn-sm mt-3 w-full">
              <LogOut size={14} aria-hidden /> Keluar
            </button>
          </div>
        )}
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
        className="btn-primary btn-sm"
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

/** Logo BINUSMAYA (dipotong dari frame ekspor Figma). */
export function BinusmayaLogo() {
  return <img src="/figma/binusmaya-logo.png" alt="BINUSMAYA" className="h-[18px] w-auto select-none" draggable={false} />;
}

function DotsGrid() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0 text-ink" aria-hidden>
      {[2, 9, 16].flatMap((y) => [2, 9, 16].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2" fill="currentColor" />))}
    </svg>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white" aria-hidden>
      {initials}
    </span>
  );
}

/** Toggle bahasa seperti di Figma. Aplikasi baru tersedia dalam Bahasa Indonesia. */
function LanguageToggle() {
  return (
    <div className="hidden overflow-hidden rounded-full border border-line text-xs sm:flex" role="group" aria-label="Bahasa">
      <span className="bg-accent px-3 py-1.5 text-white">ID</span>
      <button type="button" disabled title="Bahasa Inggris belum tersedia" className="px-3 py-1.5 text-ink disabled:cursor-not-allowed">
        EN
      </button>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
}

// Baris aplikasi BINUSMaya dari Pengunjung.png. Hanya FundChain yang aktif di aplikasi ini.
const APPS = [
  ['lms', 'LMS'],
  ['academic-service', 'Academic Service'],
  ['beelingua', 'Beelingua'],
  ['library', 'Library'],
  ['student-activity', 'Student Activity'],
  ['binus-support', 'BINUS Support'],
  ['enrichment', 'Enrichment'],
  ['freshmen', 'Freshmen'],
  ['neksus', 'Neksus'],
  ['thesis', 'Thesis'],
  ['binus-square', 'BINUS Square'],
  ['fundchain', 'FundChain'],
  ['customize', 'Customize'],
];

/** Banner, kartu Role, dan baris aplikasi seperti header "MY DASHBOARD" di Pengunjung.png. */
function StudentBanner() {
  const { me, isAdmin } = useMe();
  return (
    <div className="bg-white">
      <div className="relative">
        <div className="h-[160px] bg-cover bg-center" style={{ backgroundImage: 'url(/figma/banner.jpg)' }} />
        <div className="absolute inset-x-0 top-6 flex items-start gap-4 px-4">
          <RoleCard
            role={!me ? 'Pengunjung' : isAdmin ? 'Admin' : 'Student'}
            name={me?.name}
            changeTo={isAdmin ? '/admin' : undefined}
            className="hidden w-[280px] shrink-0 sm:flex"
          />
          <div className="pt-8 text-white">
            <p className="text-[22px]">{greeting()},</p>
            <p className="text-2xl uppercase sm:text-[30px] sm:leading-tight [overflow-wrap:anywhere]">{me?.name ?? 'Binusian'}</p>
          </div>
        </div>
      </div>
      <div className="no-scrollbar flex gap-6 overflow-x-auto px-4 pb-6 pt-[78px] sm:justify-between sm:gap-2" aria-label="Aplikasi BINUSMaya">
        {APPS.map(([key, label]) =>
          key === 'fundchain' ? (
            <Link key={key} to="/" className="flex w-[84px] shrink-0 flex-col items-center gap-1.5 text-center" aria-current="page">
              <img src="/figma/app-fundchain-active.png" alt="" className="h-12 w-12" />
              <span className="text-[11px] font-bold text-navy-deep">{label}</span>
            </Link>
          ) : (
            <span key={key} className="flex w-[84px] shrink-0 flex-col items-center gap-1.5 text-center" aria-hidden>
              <img src={`/figma/app-${key}.png`} alt="" className="h-12 w-12" />
              <span className="text-[11px] text-ink">{label}</span>
            </span>
          ),
        )}
      </div>
    </div>
  );
}

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;

export function Layout() {
  const { me, isAdmin } = useMe();
  const location = useLocation();
  const inAdmin = location.pathname.startsWith('/admin');
  // Admin di desktop: sidebar menempel di kiri (Frame-1). Selain itu: laci yang muncul saat ikon grid diklik.
  const [sidebarOpen, setSidebarOpen] = useState(() => inAdmin && isDesktop());
  const docked = inAdmin && isDesktop();
  useEffect(() => setSidebarOpen(inAdmin && isDesktop()), [inAdmin]);

  const links = [
    { to: '/', label: 'FundChain', end: true },
    ...(me ? [{ to: '/my/campaigns', label: 'Ruang Mahasiswa' }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Admin' }] : []),
  ];
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `-mb-px whitespace-nowrap border-b-2 px-5 py-3 text-[15px] transition ${isActive ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-ink'}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-line bg-white">
        <div className="flex h-[54px] items-center gap-4 px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            className="-m-2 rounded p-2 hover:bg-slate-100"
          >
            <DotsGrid />
          </button>
          <Link to="/" className="flex min-w-0 items-center gap-4" aria-label="FundChain beranda">
            <BinusmayaLogo />
            <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />
            <span className="hidden text-sm uppercase text-ink sm:inline">{inAdmin ? 'FundChain' : 'My Dashboard'}</span>
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <LanguageToggle />
            <Bell size={20} className="hidden text-slate-400 sm:block" aria-hidden />
            <GoogleAuthButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {sidebarOpen && (
          <>
            {!docked && (
              <div className="fixed inset-0 top-[55px] z-30 bg-black/40" onClick={() => setSidebarOpen(false)} aria-hidden />
            )}
            <aside
              id="app-sidebar"
              className={`w-[232px] shrink-0 bg-navy ${docked ? '' : 'fixed bottom-0 left-0 top-[55px] z-40 overflow-y-auto shadow-xl'}`}
            >
              <AppSidebar inAdmin={inAdmin} onNavigate={docked ? undefined : () => setSidebarOpen(false)} />
            </aside>
          </>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {!inAdmin && (
            <>
              <StudentBanner />
              <nav className="no-scrollbar flex justify-center overflow-x-auto overflow-y-hidden border-b border-line bg-white" aria-label="Navigasi utama">
                {links.map((l) => (
                  <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                    {l.label}
                  </NavLink>
                ))}
              </nav>
            </>
          )}
          <main key={location.pathname} className={inAdmin ? 'flex flex-1 flex-col' : 'w-full flex-1 bg-[#F5F5F5] px-4 pb-12 pt-6'}>
            <Outlet />
          </main>

          {/* Admin punya footer gelap sendiri di kolom konten (lihat AdminLayout). */}
          {!inAdmin && (
            <footer className="border-t border-line bg-white">
              <div className="flex justify-between gap-4 px-4 py-4 text-[13px] text-ink">
                <span>© {new Date().getFullYear()} BINUS Higher Education</span>
                <span>BINUSMAYA</span>
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pembatas halaman yang butuh identitas. */
export function RequireUser({ admin, children }: { admin?: boolean; children: React.ReactNode }) {
  const { me, isLoading, isAdmin } = useMe();
  if (isLoading) return null;
  if (!me || (admin && !isAdmin)) {
    return (
      <div className="card mx-auto my-8 max-w-lg p-8 text-center">
        <h1 className="text-xl font-bold">{me && admin ? 'Khusus Admin' : 'Login dulu'}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {me && admin
            ? 'Halaman ini hanya untuk admin. Akun Google Anda tidak memiliki akses admin.'
            : 'Silakan klik "Login" di pojok kanan atas untuk melanjutkan.'}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
