/** Membuat PDF 1 halaman yang valid (dengan xref) — untuk data seed & contoh upload. */
export function buildSamplePdf(title: string, lines: string[]): Buffer {
  const text = [
    `BT /F1 20 Tf 60 770 Td (${esc(title)}) Tj ET`,
    ...lines.map((l, i) => `BT /F1 12 Tf 60 ${730 - i * 20} Td (${esc(l)}) Tj ET`),
  ].join('\n');
  return assemble([text]);
}

/** Satu bagian dokumen: judul bagian + paragraf, butir, dan/atau tabel dua kolom (teks | nominal). */
export interface PdfSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: { head: [string, string]; rows: [string, string][]; total?: [string, string] };
}

export interface PdfDocument {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
  footer?: string;
}

/**
 * PDF A4 multi-halaman dengan teks yang dibungkus otomatis (Helvetica). Cukup untuk proposal
 * dan bukti milestone yang benar-benar terbaca, tanpa dependensi tambahan.
 * Lebar teks diukur dengan metrik glyph Helvetica asli, jadi tidak ada baris yang melewati margin kanan.
 */
export function buildDocumentPdf(doc: PdfDocument): Buffer {
  const LEFT = 56;
  const RIGHT = 539; // A4 = 595pt; margin kanan sama dengan kiri
  const TOP = 786;
  const BOTTOM = 64;
  const WIDTH = RIGHT - LEFT;
  const pages: string[][] = [[]];
  let y = TOP;
  const page = () => pages[pages.length - 1];
  const ensure = (h: number) => {
    if (y - h < BOTTOM) {
      pages.push([]);
      y = TOP;
    }
  };
  const text = (t: string, size: number, x: number, font: Font = 'F1') =>
    page().push(`BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(t)}) Tj ET`);
  const rule = (gray = 0.8, w = 0.6) => page().push(`q ${gray} G ${w} w ${LEFT} ${y.toFixed(2)} m ${RIGHT} ${y.toFixed(2)} l S Q`);
  const line = (t: string, size: number, x = LEFT, font: Font = 'F1', lead = 1.4) => {
    ensure(size * lead);
    text(t, size, x, font);
    y -= size * lead;
  };
  const wrapped = (t: string, size: number, font: Font = 'F1', x = LEFT, lead = 1.4) => {
    for (const l of wrap(t, size, RIGHT - x, font)) line(l, size, x, font, lead);
  };

  // Kepala dokumen: judul (dibungkus bila panjang), subjudul, garis pemisah.
  wrapped(doc.title, 17, 'F2', LEFT, 1.25);
  if (doc.subtitle) {
    y -= 2;
    wrapped(doc.subtitle, 10, 'F1');
  }
  y -= 2;
  rule(0.55, 1);
  y -= 16;

  for (const s of doc.sections) {
    ensure(52); // judul bagian tidak tertinggal sendirian di bawah halaman
    y -= 4;
    wrapped(s.heading, 12.5, 'F2', LEFT, 1.45);
    for (const p of s.paragraphs ?? []) {
      wrapped(p, 10.5);
      y -= 4;
    }
    for (const b of s.bullets ?? []) {
      const [first, ...rest] = wrap(b, 10.5, WIDTH - 14);
      ensure(10.5 * 1.4);
      text('-', 10.5, LEFT + 2);
      line(first, 10.5, LEFT + 14);
      for (const r of rest) line(r, 10.5, LEFT + 14);
    }
    if (s.bullets?.length) y -= 2;
    if (s.table) {
      const amountW = 120;
      const row = ([a, b]: [string, string], font: Font = 'F1') => {
        const parts = wrap(a, 10, WIDTH - amountW - 12, font);
        ensure(parts.length * 14 + 4);
        // Nominal rata kanan di margin kanan, sejajar baris pertama teks.
        text(b, 10, RIGHT - textWidth(b, 10, font), font);
        for (const p of parts) line(p, 10, LEFT, font, 1.4);
      };
      row(s.table.head, 'F2');
      y += 10;
      rule(0.6);
      y -= 14;
      for (const r of s.table.rows) row(r);
      if (s.table.total) {
        y += 10;
        rule(0.6);
        y -= 14;
        row(s.table.total, 'F2');
      }
      y -= 4;
    }
    y -= 6;
  }
  if (doc.footer) {
    ensure(40);
    y -= 4;
    rule(0.8);
    y -= 14;
    wrapped(doc.footer, 8.5, 'F1', LEFT, 1.4);
  }
  const total = pages.length;
  return assemble(
    pages.map((ops, i) => {
      const label = esc(`Halaman ${i + 1}/${total}`);
      const x = RIGHT - textWidth(`Halaman ${i + 1}/${total}`, 8.5, 'F1');
      return [...ops, `BT /F1 8.5 Tf ${x.toFixed(2)} 36 Td (${label}) Tj ET`].join('\n');
    }),
  );
}

type Font = 'F1' | 'F2';

/* Lebar glyph Helvetica / Helvetica-Bold (AFM Adobe, per 1000 em) untuk karakter 32..126, StandardEncoding. */
// prettier-ignore
const HELVETICA = [278,278,355,556,556,889,667,222,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,222,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const HELVETICA_BOLD = [278,333,474,556,556,889,722,278,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,278,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Lebar teks (pt) setelah karakter dinormalkan seperti di PDF (lihat esc). */
export function textWidth(t: string, size: number, font: Font = 'F1'): number {
  const table = font === 'F2' ? HELVETICA_BOLD : HELVETICA;
  let w = 0;
  for (const ch of normalize(t)) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? table[c - 32] : 556;
  }
  return (w * size) / 1000;
}

function normalize(s: string) {
  return s
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^ -~]/g, '?');
}

function esc(s: string) {
  return normalize(s).replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Pembungkus kata berdasarkan lebar glyph sebenarnya; kata yang lebih panjang dari satu baris dipotong paksa. */
function wrap(text: string, size: number, width: number, font: Font = 'F1'): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next, size, font) <= width) {
      cur = next;
      continue;
    }
    if (cur) out.push(cur);
    cur = word;
    while (textWidth(cur, size, font) > width) {
      let cut = cur.length - 1;
      while (cut > 1 && textWidth(cur.slice(0, cut), size, font) > width) cut--;
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

/** Rakit objek PDF: katalog, pohon halaman, satu content stream per halaman, dua font standar. */
function assemble(contents: string[]): Buffer {
  const n = contents.length;
  // Nomor objek: 1 katalog, 2 pages, 3 font regular, 4 font bold, lalu (halaman, konten) berpasangan.
  const pageObj = (i: number) => 5 + i * 2;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${contents.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  contents.forEach((text, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${pageObj(i) + 1} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`);
  });
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
