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
 */
export function buildDocumentPdf(doc: PdfDocument): Buffer {
  const LEFT = 60;
  const RIGHT = 535;
  const TOP = 780;
  const BOTTOM = 70;
  const pages: string[][] = [[]];
  let y = TOP;
  const page = () => pages[pages.length - 1];
  const ensure = (h: number) => {
    if (y - h < BOTTOM) {
      pages.push([]);
      y = TOP;
    }
  };
  const line = (text: string, size: number, x = LEFT, font = 'F1') => {
    ensure(size + 4);
    page().push(`BT /${font} ${size} Tf ${x} ${y} Td (${esc(text)}) Tj ET`);
    y -= size + 5;
  };
  const wrapped = (text: string, size: number, x = LEFT, indent = 0) => {
    for (const l of wrap(text, size, RIGHT - x - indent)) line(l, size, x + indent);
  };

  line(doc.title, 18, LEFT, 'F2');
  if (doc.subtitle) wrapped(doc.subtitle, 11);
  y -= 8;
  for (const s of doc.sections) {
    ensure(40);
    y -= 6;
    line(s.heading, 13, LEFT, 'F2');
    for (const p of s.paragraphs ?? []) {
      wrapped(p, 10.5);
      y -= 4;
    }
    for (const b of s.bullets ?? []) {
      const [first, ...rest] = wrap(b, 10.5, RIGHT - LEFT - 14);
      line(`-  ${first}`, 10.5);
      for (const r of rest) line(r, 10.5, LEFT + 14);
    }
    if (s.table) {
      const amountX = RIGHT - 110;
      const row = ([a, b]: [string, string], font = 'F1') => {
        const parts = wrap(a, 10, amountX - LEFT - 10);
        ensure(parts.length * 15);
        page().push(`BT /${font} 10 Tf ${amountX} ${y} Td (${esc(b)}) Tj ET`);
        for (const p of parts) line(p, 10, LEFT, font);
      };
      row(s.table.head, 'F2');
      for (const r of s.table.rows) row(r);
      if (s.table.total) row(s.table.total, 'F2');
    }
  }
  if (doc.footer) {
    y -= 10;
    wrapped(doc.footer, 9);
  }
  const total = pages.length;
  return assemble(
    pages.map((ops, i) => [...ops, `BT /F1 9 Tf ${RIGHT - 60} 40 Td (${esc(`Halaman ${i + 1}/${total}`)}) Tj ET`].join('\n')),
  );
}

function esc(s: string) {
  return s
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Pembungkus kata berdasarkan perkiraan lebar rata-rata glyph Helvetica (~0,5 em). */
function wrap(text: string, size: number, width: number): string[] {
  const max = Math.max(10, Math.floor(width / (size * 0.5)));
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= max) cur += ' ' + word;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  return out;
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
