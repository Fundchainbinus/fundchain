import { useQueryClient } from '@tanstack/react-query';
import { Blocks, LayoutDashboard, Menu, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useChainInfo, useMe, useUsers } from '../lib/hooks';
import { useSession } from '../lib/session';

function PersonaSwitcher() {
  const users = useUsers();
  const { actingUserId, setActingUser } = useSession();
  const qc = useQueryClient();
  return (
    <label className="flex items-center gap-2 text-sm">
      <UserRound size={16} className="text-white/80" aria-hidden />
      <span className="sr-only">Pilih pengguna</span>
      <select
        className="max-w-[210px] rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-white/40 [&>option]:text-slate-900"
        value={actingUserId ?? ''}
        onChange={(e) => {
          setActingUser(e.target.value || null);
          void qc.invalidateQueries();
        }}
      >
        <option value="">Pengunjung (publik)</option>
        {users.data?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.role === 'ADMIN' ? '🛡️ ' : '🎓 '}
            {u.name}
          </option>
        ))}
      </select>
    </label>
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
            <div className="hidden sm:block"><PersonaSwitcher /></div>
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
            <div className="mt-3 sm:hidden" onClick={(e) => e.stopPropagation()}><PersonaSwitcher /></div>
          </div>
        )}
      </header>

      <div className="border-b border-amber-200 bg-amber-50 text-xs text-amber-900">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5">
          <LayoutDashboard size={14} aria-hidden />
          <span>
            <b>Mode demo tanpa login</b> — pilih peran di pojok kanan atas.
            {me ? <> Sedang aktif sebagai <b>{me.name}</b> ({me.role === 'ADMIN' ? 'Admin' : 'Mahasiswa'}).</> : ' Saat ini sebagai pengunjung publik.'}
          </span>
        </div>
      </div>

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
        <h1 className="text-xl font-bold">{admin ? 'Khusus Admin BINUS' : 'Pilih pengguna dulu'}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {admin
            ? 'Halaman ini hanya untuk admin. Ganti peran ke "Admin BINUS" lewat pemilih di pojok kanan atas.'
            : 'Aplikasi berjalan dalam mode demo tanpa login. Pilih salah satu mahasiswa atau admin di pojok kanan atas.'}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
