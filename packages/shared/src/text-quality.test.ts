import { describe, expect, it } from 'vitest';
import { gibberishProblem } from './text-quality';

describe('gibberishProblem (deskripsi campaign)', () => {
  it('menolak teks dari screenshot production ("hasjdhjshd…")', () => {
    const mash = 'hasjdhjshdjahdhasjdhjshdjahdhasjdhjshdjahdhasjdhjshdjahd'.repeat(6) + ' jahd';
    expect(gibberishProblem(mash)).toMatch(/tanpa spasi/);
  });

  it('menolak pola huruf berulang meski diberi spasi', () => {
    expect(gibberishProblem('asdasdasdasdasd qweqweqweqwe zxczxczxczxc asdasd asdasd asd asd asd')).toMatch(/berulang/);
  });

  it('menolak deskripsi kurang dari 8 kata', () => {
    expect(gibberishProblem('Bantu kami membeli buku sekolah')).toMatch(/minimal 8 kata/);
  });

  it('menolak ketikan acak berspasi yang nyaris tanpa vokal', () => {
    expect(gibberishProblem('sdfg hjkl qwrt zxcv bnmk lkjh gfds trwq pltk')).toMatch(/ketikan acak/);
  });

  it('menolak kata yang sama diulang-ulang', () => {
    expect(gibberishProblem('donasi donasi donasi donasi donasi donasi untuk buku anak')).toMatch(/mengulang/);
  });

  it('menerima deskripsi seed dan contoh nyata', () => {
    const real = [
      'Membangun sistem penyaringan dan penampungan air bersih untuk 200 keluarga di Desa Sukamaju, Bogor. Dana digunakan untuk pipa, tandon, filter, dan pelatihan perawatan oleh warga.',
      'Rintisan bank sampah di kampus untuk memilah dan mendaur ulang sampah plastik mahasiswa.',
      'Kelas pemrograman dasar selama 8 minggu untuk remaja putus sekolah di Jakarta Barat.',
      'Free weekly coding classes for 30 teenagers in West Jakarta, covering HTML, CSS and JavaScript basics.',
      'Detail anggaran ada di https://binus.ac.id/fundchain/proposal-anggaran-lengkap-tahun-2026 untuk dibaca donatur kampanye ini.',
    ];
    for (const t of real) expect(gibberishProblem(t)).toBeNull();
  });
});
