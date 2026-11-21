import { Award, HandHeart, House, LayoutDashboard, Megaphone } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useMe } from '../lib/hooks';

/**
 * Navigasi bawah khusus layar kecil (< md). Konten diberi ruang lewat kelas `.has-bottom-nav`
 * di Layout agar tidak tertutup; tinggi bar mengikuti safe-area (iPhone dengan home indicator).
 */
export function BottomNav() {
  const { isAdmin } = useMe();
  const items = [
    { to: '/', label: 'Beranda', icon: House, end: true },
    { to: '/my/donations', label: 'Donasi', full: 'Donasi saya', icon: HandHeart, end: false },
    { to: '/my/points', label: 'Poin', full: 'Poin Comserve', icon: Award, end: false },
    { to: '/my/campaigns', label: 'Campaign', full: 'Campaign saya', icon: Megaphone, end: false },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: LayoutDashboard, end: false }] : []),
  ];
  return (
    <nav className="bottom-nav fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white md:hidden" aria-label="Navigasi bawah">
      <ul className="flex">
        {items.map((it) => (
          <li key={it.to} className="min-w-0 flex-1">
            <NavLink
              to={it.to}
              end={it.end}
              aria-label={'full' in it ? it.full : undefined}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight transition ${
                  isActive ? 'font-semibold text-accent' : 'text-slate-500 hover:text-ink'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <it.icon size={22} aria-hidden strokeWidth={isActive ? 2.25 : 1.75} />
                  <span className="max-w-full truncate">{it.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
