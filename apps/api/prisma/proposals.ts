/**
 * Isi proposal & deskripsi campaign contoh. Dipakai seed (data demo) dan
 * scripts/fix-campaign-content.ts (mengganti deskripsi/proposal asal ketik di database).
 * Semua angka anggaran menjumlah tepat ke target campaign.
 */
import type { PdfDocument, PdfSection } from './sample-pdf';

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`;

interface ProposalInput {
  title: string;
  sdg: string;
  location: string;
  target: number;
  team: string[];
  background: string[];
  goals: string[];
  beneficiaries: string;
  activities: string[];
  budget: [string, number][];
  /** Rencana penggunaan per tahap pencairan (20/40/60/80/100%). */
  tranches: [string, string, string, string, string];
  schedule: string[];
  indicators: string[];
}

function build(p: ProposalInput): PdfDocument {
  const sum = p.budget.reduce((a, [, n]) => a + n, 0);
  if (sum !== p.target) throw new Error(`Anggaran "${p.title}" ${sum} != target ${p.target}`);
  const sections: PdfSection[] = [
    { heading: '1. Latar Belakang', paragraphs: p.background },
    { heading: '2. Tujuan', bullets: p.goals },
    { heading: '3. Penerima Manfaat', paragraphs: [p.beneficiaries] },
    { heading: '4. Rencana Kegiatan', bullets: p.activities },
    {
      heading: '5. Rencana Anggaran Biaya',
      table: {
        head: ['Pos anggaran', 'Nominal'],
        rows: p.budget.map(([k, n]) => [k, rp(n)]),
        total: ['Total kebutuhan dana', rp(p.target)],
      },
    },
    {
      heading: '6. Rencana Pencairan Bertahap',
      paragraphs: [
        'Sesuai aturan FundChain, dana dicairkan dalam lima tahap kumulatif dari dana yang terkumpul. ' +
          'Setiap tahap diajukan dengan bukti penggunaan tahap sebelumnya dan disetujui admin BINUS.',
      ],
      bullets: p.tranches.map((t, i) => `Tahap ${i + 1} (sampai ${(i + 1) * 20}%): ${t}`),
    },
    { heading: '7. Jadwal Pelaksanaan', bullets: p.schedule },
    { heading: '8. Indikator Keberhasilan & Pelaporan', bullets: p.indicators },
    { heading: '9. Tim Pelaksana', bullets: p.team },
  ];
  return {
    title: `Proposal: ${p.title}`,
    subtitle: `SDG ${p.sdg} - ${p.location} - Target dana ${rp(p.target)}`,
    sections,
    footer:
      'Proposal ini diajukan melalui FundChain BINUS. Setiap donasi yang lunas dicatat hash-nya di blockchain, ' +
      'dan laporan penggunaan dana dipublikasikan di halaman campaign.',
  };
}

const PROPOSALS: Record<string, ProposalInput> = {
  'Air Bersih untuk Desa Sukamaju': {
    title: 'Air Bersih untuk Desa Sukamaju',
    sdg: '6 - Air Bersih dan Sanitasi Layak',
    location: 'Desa Sukamaju, Kabupaten Bogor',
    target: 15_000_000,
    team: ['Budi Santoso - ketua, koordinator lapangan', 'Dua relawan teknik sipil BINUS - perancangan jalur pipa', 'Ketua RW 04 Sukamaju - perwakilan warga'],
    background: [
      'Sekitar 200 keluarga di RW 04 Desa Sukamaju masih mengambil air dari sungai dan sumur dangkal yang keruh saat musim hujan. ' +
        'Puskesmas setempat mencatat kasus diare pada anak meningkat setiap Desember sampai Februari.',
      'Warga sudah memiliki mata air di bukit desa, tetapi belum ada pipa, penampungan, dan penyaringan yang membuat air tersebut layak dipakai sehari-hari.',
    ],
    goals: [
      'Mengalirkan air dari mata air ke dua titik penampungan di permukiman warga.',
      'Menyaring air dengan filter pasir, karbon aktif, dan membran agar jernih dan aman untuk kebutuhan rumah tangga.',
      'Membentuk kelompok warga yang mampu merawat sistem secara mandiri setelah program selesai.',
    ],
    beneficiaries: '200 keluarga (sekitar 750 jiwa) di RW 04, termasuk 2 sekolah dasar dan 1 posyandu yang berada di jalur pipa.',
    activities: [
      'Survei jalur pipa bersama warga dan perangkat desa.',
      'Pemasangan pipa sepanjang kurang lebih 600 meter dan dua tandon 1.000 liter.',
      'Pemasangan unit filter tiga tahap di setiap titik penampungan.',
      'Pelatihan perawatan filter dan pembentukan jadwal piket kelompok warga.',
      'Uji kualitas air di laboratorium sebelum dan sesudah program.',
    ],
    budget: [
      ['Pipa PVC 1,5 inci dan sambungan (600 m)', 3_200_000],
      ['Tandon air 1.000 liter (2 unit)', 3_000_000],
      ['Unit filter pasir, karbon aktif, dan membran (2 set)', 4_500_000],
      ['Pompa air dan panel listrik', 1_800_000],
      ['Pelatihan perawatan dan uji laboratorium', 1_200_000],
      ['Transportasi material dan relawan', 800_000],
      ['Dokumentasi dan laporan akhir', 500_000],
    ],
    tranches: [
      'pembelian pipa dan tandon tahap awal.',
      'filter air dan pelatihan perawatan untuk warga.',
      'sisa pipa, pompa, dan panel listrik.',
      'pemasangan di titik penampungan kedua dan uji laboratorium.',
      'perbaikan akhir, dokumentasi, dan laporan pertanggungjawaban.',
    ],
    schedule: ['Minggu 1-2: survei dan pembelian material', 'Minggu 3-6: pemasangan pipa, tandon, dan filter', 'Minggu 7: pelatihan warga', 'Minggu 8: uji kualitas air dan serah terima'],
    indicators: [
      'Air mengalir ke dua titik penampungan dengan kekeruhan di bawah standar Permenkes.',
      '15 warga terlatih merawat filter dan tercatat dalam jadwal piket.',
      'Laporan penggunaan dana beserta nota diunggah di setiap tahap pencairan.',
    ],
  },
  'Buku & Perpustakaan Mini untuk Anak Pesisir': {
    title: 'Buku & Perpustakaan Mini untuk Anak Pesisir',
    sdg: '4 - Pendidikan Berkualitas',
    location: 'Kecamatan Kronjo, Kabupaten Tangerang',
    target: 8_000_000,
    team: ['Siti Rahma - ketua, koordinator relawan', '12 relawan mahasiswa BINUS - pendamping membaca', 'Kepala sekolah tiga SD mitra'],
    background: [
      'Tiga sekolah dasar di pesisir Kronjo tidak memiliki perpustakaan. Buku yang tersedia hanya buku paket, sehingga minat baca siswa rendah. ' +
        'Hasil asesmen sekolah menunjukkan sebagian siswa kelas 3 belum lancar membaca.',
    ],
    goals: [
      'Menyediakan 500 buku bacaan anak yang sesuai jenjang di tiga sekolah.',
      'Membangun pojok baca dengan rak yang aman dan mudah dijangkau anak.',
      'Menjalankan program membaca mingguan selama satu semester bersama relawan.',
    ],
    beneficiaries: 'Sekitar 420 siswa SD di tiga sekolah mitra serta guru yang mendampingi program membaca.',
    activities: [
      'Kurasi dan pembelian buku cerita, ensiklopedia anak, dan buku pengetahuan lokal pesisir.',
      'Perakitan rak dan penataan pojok baca di setiap sekolah.',
      'Kelas membaca mingguan dan lomba resensi sederhana di akhir semester.',
    ],
    budget: [
      ['500 buku bacaan anak', 4_500_000],
      ['Rak buku kayu (3 unit)', 1_500_000],
      ['Alat tulis dan perlengkapan kelas membaca', 600_000],
      ['Transportasi relawan selama satu semester', 900_000],
      ['Dokumentasi dan laporan', 500_000],
    ],
    tranches: [
      'pembelian 120 buku tahap pertama.',
      'rak buku untuk sekolah pertama dan kedua.',
      'pembelian sisa buku.',
      'rak ketiga dan perlengkapan kelas membaca.',
      'transportasi relawan, dokumentasi, dan laporan akhir.',
    ],
    schedule: ['Bulan 1: kurasi dan pembelian buku', 'Bulan 2: pemasangan pojok baca', 'Bulan 2-6: kelas membaca mingguan', 'Bulan 6: evaluasi dan laporan'],
    indicators: ['500 buku tercatat di inventaris tiga sekolah.', 'Kehadiran rata-rata kelas membaca minimal 70%.', 'Peningkatan skor asesmen membaca siswa kelas 3.'],
  },
  'Panel Surya untuk SD Harapan': {
    title: 'Panel Surya untuk SD Harapan',
    sdg: '7 - Energi Bersih dan Terjangkau',
    location: 'SD Harapan, Kabupaten Lebak',
    target: 25_000_000,
    team: ['Andi Wijaya - ketua', 'Dosen pembimbing Teknik Elektro BINUS', 'Teknisi PLTS bersertifikat (mitra)'],
    background: [
      'Listrik di SD Harapan sering padam beberapa jam setiap hari sehingga laboratorium komputer sederhana jarang bisa dipakai. ' +
        'Sekolah juga menanggung biaya genset yang besar.',
    ],
    goals: ['Memasang PLTS atap 2 kWp dengan baterai cadangan.', 'Menjamin listrik stabil di jam belajar untuk 6 kelas dan laboratorium komputer.', 'Melatih guru memantau dan merawat sistem.'],
    beneficiaries: '180 siswa dan 9 guru SD Harapan.',
    activities: ['Audit kebutuhan listrik sekolah.', 'Pemasangan panel, inverter, dan baterai oleh teknisi bersertifikat.', 'Pelatihan pemantauan sistem untuk guru.'],
    budget: [
      ['Panel surya 550 Wp (4 unit)', 8_000_000],
      ['Inverter hybrid 3 kW', 6_500_000],
      ['Baterai LiFePO4 5 kWh', 7_000_000],
      ['Kabel, rangka, dan proteksi petir', 2_000_000],
      ['Jasa instalasi teknisi', 1_000_000],
      ['Pelatihan guru dan dokumentasi', 500_000],
    ],
    tranches: ['panel surya tahap pertama.', 'inverter hybrid.', 'baterai tahap pertama.', 'sisa baterai, kabel, dan rangka.', 'instalasi, pelatihan guru, dan laporan.'],
    schedule: ['Bulan 1: audit dan pengadaan', 'Bulan 2: instalasi dan uji coba', 'Bulan 3: pelatihan dan serah terima'],
    indicators: ['Sistem menghasilkan rata-rata 8 kWh per hari.', 'Tidak ada pemadaman di jam belajar selama 3 bulan pertama.'],
  },
  'Kelas Coding Gratis untuk Remaja': {
    // Sengaja kurang rinci: campaign ini REJECTED karena rincian dana per item belum ada.
    title: 'Kelas Coding Gratis untuk Remaja',
    sdg: '8 - Pekerjaan Layak dan Pertumbuhan Ekonomi',
    location: 'Jakarta Barat',
    target: 12_000_000,
    team: ['Siti Rahma - ketua', 'Mentor dari komunitas mahasiswa BINUS'],
    background: ['Banyak remaja putus sekolah di Jakarta Barat belum memiliki keterampilan digital untuk bekerja.'],
    goals: ['Mengadakan kelas pemrograman dasar selama 8 minggu.'],
    beneficiaries: '30 remaja usia 15-19 tahun.',
    activities: ['Kelas HTML, CSS, dan JavaScript dua kali seminggu.'],
    budget: [['Biaya operasional kelas', 12_000_000]],
    tranches: ['operasional kelas.', 'operasional kelas.', 'operasional kelas.', 'operasional kelas.', 'operasional kelas.'],
    schedule: ['8 minggu'],
    indicators: ['Peserta menyelesaikan kelas.'],
  },
  'Kebun Hidroponik Rusun Marunda': {
    title: 'Kebun Hidroponik Rusun Marunda',
    sdg: '2 - Tanpa Kelaparan',
    location: 'Rusunawa Marunda, Jakarta Utara',
    target: 10_000_000,
    team: ['Andi Wijaya - ketua', 'Pengurus koperasi warga Blok C', 'Dua relawan agribisnis BINUS'],
    background: ['Harga sayur di sekitar rusun tinggi dan warga tidak punya lahan tanam. Atap Blok C memiliki area kosong seluas 80 meter persegi yang belum dimanfaatkan.'],
    goals: ['Membangun kebun hidroponik NFT di atap Blok C.', 'Menyediakan sayur murah untuk warga.', 'Melatih warga menanam dan menjual hasil panen lewat koperasi.'],
    beneficiaries: '120 keluarga penghuni Blok C dan koperasi warga.',
    activities: ['Pemasangan rak NFT dan naungan paranet.', 'Pelatihan budidaya dan pencatatan panen.', 'Penjualan hasil panen melalui koperasi.'],
    budget: [
      ['Rak NFT dan pipa hidroponik', 3_500_000],
      ['Pompa air dan timer', 1_200_000],
      ['Nutrisi AB mix untuk 6 bulan', 1_500_000],
      ['Benih dan rockwool', 600_000],
      ['Naungan paranet atap', 1_800_000],
      ['Pelatihan budidaya dan pemasaran', 900_000],
      ['Dokumentasi dan laporan', 500_000],
    ],
    tranches: ['rak NFT tahap awal.', 'pompa, timer, dan paranet.', 'sisa rak dan benih.', 'nutrisi dan pelatihan.', 'pemasaran, dokumentasi, dan laporan.'],
    schedule: ['Bulan 1: pemasangan rak', 'Bulan 2: tanam perdana dan pelatihan', 'Bulan 3-6: panen dan penjualan'],
    indicators: ['Panen minimal 40 kg sayur per bulan.', 'Koperasi mencatat penjualan setiap bulan.'],
  },
  'Gerakan Seribu Buku untuk Anak Negeri': {
    title: 'Gerakan Seribu Buku untuk Anak Negeri',
    sdg: '4 - Pendidikan Berkualitas',
    location: 'Taman baca mitra di Kabupaten Bogor dan Tangerang',
    target: 5_000_000,
    team: ['Ketua pelaksana - mahasiswa BINUS (pembuat campaign)', 'Relawan pengumpul dan pemilah buku', 'Pengelola empat taman baca mitra'],
    background: [
      'Banyak taman baca masyarakat di pinggiran Jakarta hanya memiliki puluhan buku yang sudah dibaca berulang kali. ' +
        'Anak-anak datang setiap minggu, tetapi koleksi tidak bertambah sehingga minat baca menurun.',
      'Di sisi lain, mahasiswa dan keluarga di sekitar kampus memiliki buku layak baca yang tidak terpakai. ' +
        'Gerakan ini menghubungkan keduanya dan melengkapi kekurangan dengan pembelian buku baru.',
    ],
    goals: [
      'Mengumpulkan dan menyalurkan 1.000 buku layak baca ke empat taman baca mitra.',
      'Melengkapi setiap taman baca dengan rak yang memadai.',
      'Mengadakan kegiatan membaca bersama di setiap taman baca saat penyerahan buku.',
    ],
    beneficiaries: 'Sekitar 300 anak usia 6-14 tahun yang rutin datang ke empat taman baca mitra.',
    activities: [
      'Donasi buku bekas layak baca dari civitas BINUS, lalu pemilahan sesuai usia.',
      'Pembelian buku baru untuk jenjang yang kurang, terutama buku cerita bergambar dan pengetahuan dasar.',
      'Pengiriman buku dan rak ke empat taman baca.',
      'Kegiatan membaca bersama dan pencatatan koleksi di setiap taman baca.',
    ],
    budget: [
      ['Pembelian 400 buku baru untuk melengkapi 600 buku donasi', 3_000_000],
      ['Rak buku (4 unit)', 800_000],
      ['Pengiriman buku dan rak ke 4 lokasi', 600_000],
      ['Kegiatan membaca bersama (konsumsi dan alat peraga)', 400_000],
      ['Dokumentasi dan laporan', 200_000],
    ],
    tranches: [
      'pembelian 130 buku baru tahap pertama.',
      'pembelian 130 buku baru tahap kedua.',
      'sisa buku baru dan rak untuk dua taman baca.',
      'rak untuk dua taman baca berikutnya dan pengiriman.',
      'kegiatan membaca bersama, dokumentasi, dan laporan akhir.',
    ],
    schedule: ['Minggu 1-3: pengumpulan dan pemilahan buku donasi', 'Minggu 3-4: pembelian buku baru dan rak', 'Minggu 5-6: pengiriman dan kegiatan membaca bersama', 'Minggu 7: laporan akhir'],
    indicators: ['1.000 buku tercatat diterima empat taman baca, dengan tanda terima pengelola.', 'Foto dan daftar hadir kegiatan membaca bersama di setiap lokasi.', 'Nota pembelian diunggah di setiap tahap pencairan.'],
  },
  'Penyediaan Laptop Belajar untuk Rumah Singgah Pelita': {
    title: 'Penyediaan Laptop Belajar untuk Rumah Singgah Pelita',
    sdg: '4 - Pendidikan Berkualitas',
    location: 'Rumah Singgah Pelita, Jakarta Barat',
    target: 5_000_000,
    team: ['Ketua pelaksana - mahasiswa BINUS (pembuat campaign)', 'Dua relawan pengajar komputer', 'Pengurus Rumah Singgah Pelita'],
    background: [
      'Rumah Singgah Pelita menampung sekitar 40 anak usia sekolah yang belajar sepulang sekolah. Tugas sekolah kini banyak ' +
        'dikerjakan dan dikumpulkan secara daring, tetapi rumah singgah hanya memiliki satu komputer lama yang sering rusak.',
      'Akibatnya anak-anak bergantian memakai ponsel pengurus atau tidak mengumpulkan tugas tepat waktu.',
    ],
    goals: [
      'Menyediakan 3 laptop rekondisi layak pakai untuk kegiatan belajar bersama.',
      'Menyiapkan koneksi internet dan perangkat pendukung di ruang belajar.',
      'Melatih anak-anak dasar penggunaan dokumen, presentasi, dan keamanan internet.',
    ],
    beneficiaries: 'Sekitar 40 anak usia 9-17 tahun penghuni dan peserta belajar Rumah Singgah Pelita.',
    activities: [
      'Pembelian 3 laptop rekondisi bergaransi beserta perangkat lunak pendidikan gratis.',
      'Pemasangan router dan langganan internet untuk 6 bulan pertama.',
      'Kelas komputer dasar dua kali seminggu selama 2 bulan oleh relawan mahasiswa.',
      'Penyusunan jadwal pemakaian dan aturan perawatan laptop bersama pengurus.',
    ],
    budget: [
      ['Laptop rekondisi bergaransi 6 bulan (3 unit)', 3_600_000],
      ['Router dan langganan internet 6 bulan', 600_000],
      ['Tas, mouse, dan stopkontak pengaman', 300_000],
      ['Modul dan konsumsi kelas komputer', 300_000],
      ['Dokumentasi dan laporan', 200_000],
    ],
    tranches: [
      'laptop pertama.',
      'laptop kedua.',
      'laptop ketiga dan perlengkapan pendukung.',
      'router, internet, dan modul kelas.',
      'konsumsi kelas, dokumentasi, dan laporan akhir.',
    ],
    schedule: ['Minggu 1-2: pembelian laptop dan perangkat', 'Minggu 3: pemasangan internet dan aturan pemakaian', 'Minggu 3-10: kelas komputer dasar', 'Minggu 11: evaluasi dan laporan'],
    indicators: ['3 laptop tercatat di inventaris rumah singgah dengan tanda terima pengurus.', 'Minimal 30 anak mengikuti kelas komputer dasar.', 'Nota pembelian diunggah di setiap tahap pencairan.'],
  },
  'Kelas Coding Gratis untuk Remaja Indonesia': {
    title: 'Kelas Coding Gratis untuk Remaja Indonesia',
    sdg: '4 - Pendidikan Berkualitas',
    location: 'Jakarta Barat (luring) dan kelas daring',
    target: 5_000_000,
    team: ['Andi Wijaya - ketua', 'Empat mentor mahasiswa Computer Science BINUS', 'Karang taruna mitra sebagai penyedia tempat'],
    background: [
      'Banyak remaja putus sekolah dan lulusan SMA di Jakarta Barat belum memiliki keterampilan digital yang dibutuhkan untuk ' +
        'pekerjaan tingkat pemula. Kursus pemrograman berbayar tidak terjangkau bagi mereka.',
    ],
    goals: [
      'Mengadakan kelas pemrograman web dasar gratis selama 8 minggu untuk 30 peserta.',
      'Setiap peserta lulus dengan satu proyek website sederhana sebagai portofolio.',
    ],
    beneficiaries: '30 remaja usia 15-19 tahun dari keluarga berpenghasilan rendah, diseleksi bersama karang taruna mitra.',
    activities: [
      'Kelas HTML, CSS, dan JavaScript dasar dua kali seminggu (luring dan daring).',
      'Mentoring proyek mingguan oleh mahasiswa BINUS.',
      'Demo day: peserta mempresentasikan website buatannya.',
    ],
    budget: [
      ['Sewa 3 laptop untuk peserta tanpa perangkat (8 minggu)', 1_800_000],
      ['Paket data internet peserta kelas daring (30 orang x 2 bulan)', 1_500_000],
      ['Konsumsi kelas luring (16 pertemuan)', 1_000_000],
      ['Sertifikat dan acara demo day', 500_000],
      ['Dokumentasi dan laporan', 200_000],
    ],
    tranches: [
      'sewa laptop bulan pertama.',
      'paket data bulan pertama dan konsumsi.',
      'sewa laptop bulan kedua.',
      'paket data bulan kedua dan konsumsi.',
      'demo day, sertifikat, dokumentasi, dan laporan.',
    ],
    schedule: ['Minggu 1: seleksi peserta', 'Minggu 2-9: kelas dan mentoring', 'Minggu 10: demo day dan laporan'],
    indicators: ['Minimal 24 dari 30 peserta menyelesaikan kelas.', 'Setiap lulusan memiliki satu website yang dapat diakses.', 'Daftar hadir dan nota diunggah di setiap tahap pencairan.'],
  },
};

/** Deskripsi campaign yang layak tampil untuk "Gerakan Seribu Buku" (pengganti teks asal ketik di production). */
export const SERIBU_BUKU_DESCRIPTION =
  'Gerakan Seribu Buku mengumpulkan dan menyalurkan 1.000 buku layak baca ke empat taman baca masyarakat di Bogor dan Tangerang, ' +
  'yang selama ini hanya memiliki puluhan buku untuk sekitar 300 anak. Sebanyak 600 buku berasal dari donasi buku civitas BINUS, ' +
  'dan dana dipakai untuk membeli 400 buku baru (Rp3.000.000), empat rak buku (Rp800.000), pengiriman ke empat lokasi (Rp600.000), ' +
  'kegiatan membaca bersama (Rp400.000), serta dokumentasi dan laporan (Rp200.000). Setiap tahap pencairan disertai nota dan tanda terima dari pengelola taman baca.';

/** Konten siap pakai untuk campaign production yang deskripsinya asal ketik (dipakai fix-campaign-content.ts). */
export const PREPARED_DESCRIPTIONS: Record<string, string> = {
  'Gerakan Seribu Buku untuk Anak Negeri': SERIBU_BUKU_DESCRIPTION,
  'Penyediaan Laptop Belajar untuk Rumah Singgah Pelita':
    'Rumah Singgah Pelita di Jakarta Barat menampung sekitar 40 anak yang mengerjakan tugas sekolah secara daring, tetapi hanya punya satu komputer lama yang sering rusak. ' +
    'Campaign ini menyediakan 3 laptop rekondisi bergaransi (Rp3.600.000), router dan internet 6 bulan (Rp600.000), perlengkapan pendukung (Rp300.000), ' +
    'kelas komputer dasar oleh relawan mahasiswa BINUS (Rp300.000), serta dokumentasi dan laporan (Rp200.000).',
  'Kelas Coding Gratis untuk Remaja Indonesia':
    'Kelas pemrograman web dasar gratis selama 8 minggu untuk 30 remaja usia 15-19 tahun dari keluarga berpenghasilan rendah di Jakarta Barat, dibimbing mahasiswa Computer Science BINUS. ' +
    'Dana dipakai untuk sewa laptop bagi peserta tanpa perangkat (Rp1.800.000), paket data kelas daring (Rp1.500.000), konsumsi 16 pertemuan (Rp1.000.000), ' +
    'sertifikat dan demo day (Rp500.000), serta dokumentasi dan laporan (Rp200.000).',
};

/** Kategori SDG yang benar bila data production salah isi (mis. proyek buku tercatat SDG 14). */
export const PREPARED_SDG: Record<string, string> = {
  'Gerakan Seribu Buku untuk Anak Negeri': 'QUALITY_EDUCATION',
  'Penyediaan Laptop Belajar untuk Rumah Singgah Pelita': 'QUALITY_EDUCATION',
};

export function proposalFor(title: string): PdfDocument | null {
  const p = PROPOSALS[title];
  return p ? build(p) : null;
}

/** Bukti milestone contoh: daftar nota yang realistis untuk satu tahap. */
export function milestoneProofFor(title: string, items: [string, number][]): PdfDocument {
  const total = items.reduce((a, [, n]) => a + n, 0);
  return {
    title,
    subtitle: 'Laporan penggunaan dana dan daftar nota',
    sections: [
      {
        heading: 'Rincian pembelian',
        table: { head: ['Barang / jasa', 'Nominal'], rows: items.map(([k, n]) => [k, rp(n)]), total: ['Total', rp(total)] },
      },
      {
        heading: 'Keterangan',
        paragraphs: ['Nota asli disimpan oleh ketua pelaksana dan dapat diperiksa admin BINUS. Foto barang terlampir pada laporan akhir.'],
      },
    ],
  };
}
