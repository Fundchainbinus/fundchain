import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  GraduationCap,
  Grid3x3,
  HandCoins,
  Info,
  Languages,
  Library,
  LifeBuoy,
  type LucideIcon,
  MonitorPlay,
  Newspaper,
  Settings2,
  Sparkles,
  Trophy,
  UserRound,
} from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useChainInfo, useMe, useUsers } from '../lib/hooks';
import { useSession } from '../lib/session';

/** Ikon aplikasi BINUSMAYA lain — hanya dekorasi agar FundChain terlihat sebagai salah satu modul. */
const APPS: { label: string; icon: LucideIcon; tint: string }[] = [
  { label: 'LMS', icon: GraduationCap, tint: 'bg-sky-600' },
  { label: 'Academic Service', icon: BookOpen, tint: 'bg-rose-500' },
  { label: 'Beelingua', icon: Languages, tint: 'bg-teal-500' },
  { label: 'Library', icon: Library, tint: 'bg-amber-500' },
  { label: 'Student Activity', icon: Trophy, tint: 'bg-indigo-500' },
  { label: 'BINUS Support', icon: LifeBuoy, tint: 'bg-sky-500' },
  { label: 'Enrichment', icon: Sparkles, tint: 'bg-orange-500' },
  { label: 'Freshmen', icon: CalendarDays, tint: 'bg-cyan-600' },
  { label: 'Nekuu', icon: Newspaper, tint: 'bg-pink-500' },
  { label: 'Thesis', icon: MonitorPlay, tint: 'bg-red-500' },
  { label: 'BINUS Square', icon: Building2, tint: 'bg-blue-500' },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Good Morning';
  if (h < 15) return 'Good Afternoon';
  if (h < 18) return 'Good Evening';
  return 'Good Night';
}

function TopBar() {
  const { me } = useMe();
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Grid3x3 size={18} className="text-slate-500" aria-hidden />
        <Link to="/" className="text-lg font-extrabold tracking-tight text-slate-900">
          BINUS<span className="font-semibold text-accent">MAYA</span>
        </Link>
        <span className="hidden h-5 w-px bg-slate-300 sm:block" />
        <span className="hidden text-xs font-medium uppercase tracking-wide text-slate-600 sm:block">My Dashboard</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex overflow-hidden rounded-full border border-slate-200 text-[11px] font-semibold" aria-hidden>
            <span className="px-2 py-0.5 text-slate-500">ID</span>
            <span className="bg-accent px-2 py-0.5 text-white">EN</span>
          </div>
          <Bell size={18} className="text-slate-500" aria-hidden />
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-light text-brand" title={me?.name ?? 'Pengunjung'}>
            <UserRound size={16} />
          </span>
        </div>
      </div>
    </header>
  );
}

function Banner() {
  const { me, isAdmin } = useMe();
  const chain = useChainInfo().data;
  const role = !me ? 'Pengunjung' : isAdmin ? 'Admin' : 'Student';
  return (
    <section className="bg-gradient-to-r from-[#1f5f7a] via-[#8a6a4a] to-[#c9773a]">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center">
        <div className="w-full rounded-md bg-navy p-3 text-white md:w-56">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-white" /> Role</span>
            <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase">Change</span>
          </div>
          <p className="mt-5 text-sm font-semibold">{role}</p>
          <p className="text-xs text-white/70">{isAdmin ? 'Staff' : me ? 'Undergraduate' : 'Publik'}</p>
          <p className="text-xs text-white/70">BINUS University</p>
        </div>
        <div className="flex-1 text-white">
          <p className="text-sm">{greeting()},</p>
          <p className="mt-1 text-xl font-medium uppercase tracking-wide sm:text-2xl">{me?.name ?? 'Binusian'}</p>
        </div>
        {chain && (
          <div className="text-xs text-white md:w-60">
            <p className="font-semibold uppercase tracking-wide">Status blockchain</p>
            <p className="mt-2 flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${chain.ready ? 'bg-emerald-400' : 'bg-red-400'}`} />
              {chain.ready ? chain.network : 'Chain offline'}
            </p>
            <p className="text-white/80">{chain.ready ? `Chain ID ${chain.chainId} · DonationRegistry` : chain.reason}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function AppRow() {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4">
        <div className="flex gap-2 overflow-x-auto py-4 lg:justify-between">
          {APPS.map((a) => (
            <div key={a.label} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 text-center" aria-hidden>
              <span className={`flex h-9 w-9 items-center justify-center rounded-full text-white ${a.tint}`}>
                <a.icon size={16} />
              </span>
              <span className="text-[10px] leading-tight text-slate-600">{a.label}</span>
            </div>
          ))}
          <Link to="/" className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 text-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white ring-2 ring-accent/30">
              <HandCoins size={16} />
            </span>
            <span className="text-[10px] font-semibold leading-tight text-slate-900">FundChain</span>
          </Link>
          <div className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 text-center" aria-hidden>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-400 text-white"><Settings2 size={16} /></span>
            <span className="text-[10px] leading-tight text-slate-600">Customize</span>
          </div>
        </div>
        <div className="flex justify-center">
          <span className="border-b-2 border-accent px-3 pb-2 text-xs font-medium text-accent">FundChain</span>
        </div>
      </div>
    </div>
  );
}

function PersonaSwitcher() {
  const users = useUsers();
  const { me } = useMe();
  const { actingUserId, setActingUser } = useSession();
  const qc = useQueryClient();
  const pick = (id: string | null) => {
    setActingUser(id);
    void qc.invalidateQueries();
  };
  const options = [
    { id: null as string | null, label: 'Pengunjung' },
    ...(users.data ?? []).map((u) => ({ id: u.id as string | null, label: u.role === 'ADMIN' ? u.name : `${u.name} · Student` })),
  ];
  return (
    <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-center">
      <div className="lg:w-52">
        <p className="text-xs font-semibold text-slate-800">Persona FundChain · {me?.name ?? 'Pengunjung'}</p>
        <p className="text-[11px] text-slate-500">Terpisah dari identitas BINUSMAYA di atas.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pilih persona">
        {options.map((o) => {
          const active = (actingUserId ?? null) === o.id;
          return (
            <button
              key={o.id ?? 'public'}
              role="radio"
              aria-checked={active}
              onClick={() => pick(o.id)}
              className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition ${active ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand/50'}`}
            >
              {o.label}
              {active && <Check size={12} />}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500 lg:ml-auto lg:max-w-xs">
        Tanpa login di mode demo. Microsoft BINUS SSO direncanakan untuk produksi.
      </p>
    </div>
  );
}

export function Layout() {
  const { me, isAdmin } = useMe();
  const location = useLocation();

  const links = [
    { to: '/', label: 'Jelajahi Kampanye', end: true },
    ...(me ? [{ to: '/my/campaigns', label: 'Ruang Mahasiswa' }, { to: '/my/donations', label: 'Donasi Saya' }] : []),
    ...(isAdmin ? [{ to: '/admin', label: 'Administrasi' }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <Banner />
      <AppRow />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">FundChain</h1>
            <p className="text-xs text-slate-500">Penggalangan dana mahasiswa BINUS · transparan dari donasi hingga pencairan.</p>
          </div>
          <span className="badge bg-accent-light text-accent">Data demo</span>
        </div>
        <PersonaSwitcher />
        <div className="mt-3 flex items-start gap-2 rounded-md border border-brand/20 bg-brand-50 px-3 py-2 text-xs text-slate-700">
          <Info size={14} className="mt-0.5 shrink-0 text-brand" aria-hidden />
          <span>Blockchain hanya menyimpan hash bukti yang immutable, bukan dana donasi. Dana diproses di luar blockchain.</span>
        </div>

        <nav className="mt-5 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Navigasi FundChain">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${isActive ? 'border-brand text-brand' : 'border-transparent text-slate-500 hover:text-slate-800'}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div key={location.pathname} className="pt-6">
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl justify-between px-4 py-4 text-[11px] text-slate-500">
          <span>© {new Date().getFullYear()} BINUS Higher Education</span>
          <span className="font-semibold">BINUSMAYA</span>
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
        <h1 className="text-lg font-semibold">{admin ? 'Khusus Admin BINUS' : 'Pilih persona dulu'}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {admin
            ? 'Halaman ini hanya untuk admin. Pilih persona "Admin BINUS" di kartu Persona FundChain di atas.'
            : 'Aplikasi berjalan dalam mode demo tanpa login. Pilih salah satu mahasiswa atau admin di kartu Persona FundChain di atas.'}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
