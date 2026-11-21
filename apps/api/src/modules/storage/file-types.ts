import * as path from 'node:path';

export type FileKind = 'pdf' | 'png' | 'jpg';

export const SIGNATURES: Record<FileKind, { magic: number[]; ext: string[]; mime: string[] }> = {
  pdf: { magic: [0x25, 0x50, 0x44, 0x46, 0x2d], ext: ['.pdf'], mime: ['application/pdf'] },
  png: { magic: [0x89, 0x50, 0x4e, 0x47], ext: ['.png'], mime: ['image/png'] },
  jpg: { magic: [0xff, 0xd8, 0xff], ext: ['.jpg', '.jpeg'], mime: ['image/jpeg'] },
};

/** Jumlah byte awal yang cukup untuk mengecek semua magic bytes. */
export const MAGIC_HEAD_BYTES = 16;

export const FILE_PURPOSES = ['campaign-document', 'disbursement-proof'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const PURPOSE_KINDS: Record<FilePurpose, FileKind[]> = {
  'campaign-document': ['pdf'],
  'disbursement-proof': ['pdf', 'png', 'jpg'],
};

export const PURPOSE_FOLDER: Record<FilePurpose, string> = {
  'campaign-document': 'proposals',
  'disbursement-proof': 'disbursements',
};

export function isPurpose(value: unknown): value is FilePurpose {
  return typeof value === 'string' && (FILE_PURPOSES as readonly string[]).includes(value);
}

/** Jenis file yang cocok dengan ekstensi + mime (tanpa melihat isi). */
export function kindByName(allowed: FileKind[], fileName: string, mime: string): FileKind | undefined {
  const ext = path.extname(fileName).toLowerCase();
  return allowed.find((k) => SIGNATURES[k].ext.includes(ext) && SIGNATURES[k].mime.includes(mime));
}

export function magicMatches(kind: FileKind, head: Uint8Array): boolean {
  return SIGNATURES[kind].magic.every((byte, i) => head[i] === byte);
}

export function kindLabel(allowed: FileKind[]): string {
  return allowed.map((k) => k.toUpperCase()).join('/');
}

export function safeOriginalName(fileName: string): string {
  return path.basename(fileName).slice(0, 200);
}
