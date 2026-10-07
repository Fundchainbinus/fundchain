import { Smile } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Kartu "Role" dari header BINUSMaya di Figma. Tombol CHANGE berpindah antara
 * area admin dan area mahasiswa (hanya muncul bila `changeTo` diisi).
 */
export function RoleCard({ role, name, changeTo, className = '' }: { role: string; name?: string; changeTo?: string; className?: string }) {
  return (
    <div className={`flex min-h-[176px] flex-col justify-between rounded-md bg-navy-deep p-4 text-white ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[17px]">
          <Smile size={18} aria-hidden /> Role
        </p>
        {changeTo && (
          <Link
            to={changeTo}
            className="rounded bg-gradient-to-b from-[#F7A63A] to-accent px-3 py-1 text-[11px] uppercase tracking-wide text-white hover:brightness-105"
          >
            Change
          </Link>
        )}
      </div>
      <div>
        <p className="text-[17px] font-semibold">{role}</p>
        {name && <p className="mt-1 truncate text-xs text-white/80" title={name}>{name}</p>}
        <p className="mt-1 text-xs text-white/80">BINUS University</p>
      </div>
    </div>
  );
}
