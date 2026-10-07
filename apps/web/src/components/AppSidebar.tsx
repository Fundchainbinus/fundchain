import { Glasses, House, LayoutDashboard, UserRound } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useMe } from '../lib/hooks';
import { RoleCard } from './RoleCard';

const ADMIN_MENU = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, filled: true },
  { to: '/admin/reviews', label: 'Review Campaign', icon: Glasses },
  { to: '/admin/integrity', label: 'Integritas', icon: Glasses },
  { to: '/admin/disbursements', label: 'Pencairan', icon: Glasses },
  { to: '/admin/audit', label: 'Audit Log', icon: Glasses },
];

/**
 * Sidebar biru BINUSMaya (Frame-1..5): kartu Role + menu. Di area admin berisi menu admin,
 * di area mahasiswa berisi menu FundChain. Dibuka/tutup lewat ikon grid di header.
 */
export function AppSidebar({ inAdmin, onNavigate }: { inAdmin: boolean; onNavigate?: () => void }) {
  const { me, isAdmin } = useMe();
  const menu = inAdmin
    ? ADMIN_MENU
    : [
        { to: '/', label: 'FundChain', icon: House, end: true, filled: false },
        ...(me ? [{ to: '/my/campaigns', label: 'Ruang Mahasiswa', icon: UserRound, end: false, filled: false }] : []),
        ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: LayoutDashboard, end: false, filled: true }] : []),
      ];

  return (
    <div className="flex h-full flex-col text-white">
      {/* CHANGE berpindah antara area admin dan area mahasiswa. */}
      <RoleCard
        role={inAdmin ? 'Admin' : !me ? 'Pengunjung' : isAdmin ? 'Admin' : 'Student'}
        name={me?.name}
        changeTo={isAdmin ? (inAdmin ? '/' : '/admin') : undefined}
        className="m-3"
      />
      <nav className="flex flex-col pt-1" aria-label={inAdmin ? 'Menu admin' : 'Menu FundChain'} onClick={onNavigate}>
        {menu.map((m) => (
          <NavLink
            key={m.to}
            to={m.to}
            end={m.end}
            className={({ isActive }) =>
              `ml-0.5 flex items-center gap-3 whitespace-nowrap rounded-l-full px-4 py-2.5 text-[17px] font-bold transition ${
                isActive ? 'bg-navy-deep text-white' : 'text-white hover:bg-white/10'
              }`
            }
          >
            <m.icon size={20} aria-hidden fill={m.filled ? 'currentColor' : 'none'} /> {m.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
