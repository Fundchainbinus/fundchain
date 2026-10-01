/** Nama donor untuk tampilan publik: "Budi Santoso" → "Budi S.", anonim → "Anonim". */
export function publicDonorName(name: string, anonymous: boolean): string {
  if (anonymous) return 'Anonim';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function floorToSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}
