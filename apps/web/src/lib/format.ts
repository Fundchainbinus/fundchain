import { SDG_CATEGORIES } from '@fundchain/shared';

const rupiahFmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

// Figma menulis "Rp10.000.000" tanpa spasi.
export const rupiah = (n: number | null | undefined) => rupiahFmt.format(n ?? 0).replace(/\s/g, '');

export const fileSize = (bytes: number) =>
  bytes < 100 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;

export const dateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const date = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('id-ID', { dateStyle: 'medium' }) : '—';

export function daysLeft(deadline: string) {
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

export const shortHash = (h: string | null | undefined, n = 6) => (h ? `${h.slice(0, n + 2)}…${h.slice(-n)}` : '—');

export function sdg(code: string) {
  return SDG_CATEGORIES.find((s) => s.code === code);
}

export const percent = (current: number, target: number) =>
  target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
