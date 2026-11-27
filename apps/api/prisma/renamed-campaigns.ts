/**
 * Pengganti campaign uji coba di production (judul seperti "test20", "guegue", "Kampanye main gta 6").
 * Pemilik, kategori SDG, target, dan status tidak berubah; judul, deskripsi, dan proposal diganti
 * dengan rencana kegiatan yang realistis. Dipakai scripts/rename-test-campaigns.ts dan proposalFor().
 * Semua anggaran menjumlah tepat ke target campaign (dicek build() di proposals.ts).
 */
import type { ProposalInput } from './proposals';

export interface RenamedCampaign {
  /** ID campaign production; dicocokkan bersama judul lama supaya script tidak salah sasaran. */
  id: string;
  oldTitle: string;
  title: string;
  description: string;
  proposal: ProposalInput;
}

export const RENAMED_CAMPAIGNS: RenamedCampaign[] = [
  {
    id: '51d05fcf-1bb7-46f8-b774-6080ea4edd7b',
    oldTitle: 'test20',
    title: 'Klinik Konsultasi Hukum Gratis untuk Warga Kebon Jeruk',
    description:
      'Banyak warga Kebon Jeruk menghadapi sengketa sewa rumah, upah yang tidak dibayar, dan urusan dokumen kependudukan tanpa tahu hak mereka atau ke mana harus bertanya. ' +
      'Campaign ini membuka posko konsultasi hukum gratis dua kali sebulan selama 6 bulan bersama paralegal pendamping dan mahasiswa BINUS, ' +
      'serta membagikan 300 buku saku hak hukum warga. Dana dipakai untuk honor paralegal (Rp1.800.000), posko (Rp900.000), buku saku (Rp900.000), ' +
      'konsumsi sesi (Rp800.000), transportasi pendampingan (Rp400.000), serta dokumentasi dan laporan (Rp200.000).',
    proposal: {
      title: 'Klinik Konsultasi Hukum Gratis untuk Warga Kebon Jeruk',
      sdg: '16 - Perdamaian, Keadilan dan Kelembagaan yang Tangguh',
      location: 'Kelurahan Kebon Jeruk, Jakarta Barat',
      target: 5_000_000,
      team: ['Siti Rahma - ketua pelaksana', 'Dua paralegal dari lembaga bantuan hukum mitra', 'Empat relawan mahasiswa BINUS - pencatatan kasus dan penyuluhan'],
      background: [
        'Warga Kebon Jeruk kerap menghadapi masalah hukum sehari-hari: sengketa sewa rumah, upah yang tidak dibayar, dan dokumen kependudukan yang tertahan. ' +
          'Sebagian besar tidak mampu membayar pengacara dan tidak tahu bahwa ada jalur penyelesaian tanpa biaya.',
        'Pengurus RW mencatat lebih dari 30 keluhan warga dalam tiga bulan terakhir yang tidak pernah ditindaklanjuti karena warga tidak tahu harus mulai dari mana.',
      ],
      goals: [
        'Membuka posko konsultasi hukum gratis dua kali sebulan selama 6 bulan.',
        'Membantu minimal 60 warga memahami hak dan langkah penyelesaian masalahnya.',
        'Membagikan 300 buku saku hak hukum warga yang mudah dipahami.',
      ],
      beneficiaries: 'Sekitar 60 warga yang berkonsultasi langsung dan 300 keluarga penerima buku saku di empat RW Kelurahan Kebon Jeruk.',
      activities: [
        'Konsultasi tatap muka di posko balai warga, didampingi paralegal.',
        'Penyuluhan singkat tentang sewa-menyewa, ketenagakerjaan, dan administrasi kependudukan.',
        'Pendampingan ke kantor kelurahan atau dinas terkait untuk kasus yang perlu ditindaklanjuti.',
        'Pencatatan setiap kasus secara anonim untuk laporan akhir.',
      ],
      budget: [
        ['Honor paralegal pendamping (12 sesi)', 1_800_000],
        ['Sewa tempat dan perlengkapan posko', 900_000],
        ['Cetak buku saku hak hukum warga (300 eksemplar)', 900_000],
        ['Konsumsi sesi konsultasi dan penyuluhan', 800_000],
        ['Transportasi pendampingan kasus', 400_000],
        ['Dokumentasi dan laporan', 200_000],
      ],
      tranches: [
        'persiapan posko dan honor paralegal bulan pertama.',
        'cetak buku saku dan sesi bulan kedua.',
        'honor dan konsumsi sesi bulan ketiga dan keempat.',
        'transportasi pendampingan dan sesi bulan kelima.',
        'sesi bulan keenam, dokumentasi, dan laporan akhir.',
      ],
      schedule: ['Bulan 1: persiapan posko dan sosialisasi ke RW', 'Bulan 1-6: konsultasi dua kali sebulan', 'Bulan 6: evaluasi dan laporan'],
      indicators: [
        'Minimal 60 warga tercatat berkonsultasi.',
        '300 buku saku terdistribusi dengan tanda terima pengurus RW.',
        'Nota dan daftar hadir diunggah di setiap tahap pencairan.',
      ],
    },
  },
  {
    id: '18042c8b-e93b-4d37-b1ad-aa439cfdf4ab',
    oldTitle: 'testt',
    title: 'Cek Kesehatan Gratis untuk Lansia Kemanggisan',
    description:
      'Banyak lansia di sekitar kampus Kemanggisan jarang memeriksakan tekanan darah, gula darah, dan kolesterol karena biaya dan jarak ke fasilitas kesehatan. ' +
      'Campaign ini mengadakan tiga kali cek kesehatan gratis untuk 150 lansia bersama tenaga kesehatan puskesmas mitra. Dana dipakai untuk alat dan strip pemeriksaan (Rp2.250.000), ' +
      'tensimeter digital dan timbangan (Rp750.000), honor tenaga kesehatan (Rp1.000.000), makanan bergizi peserta (Rp600.000), kartu kesehatan (Rp200.000), serta dokumentasi dan laporan (Rp200.000).',
    proposal: {
      title: 'Cek Kesehatan Gratis untuk Lansia Kemanggisan',
      sdg: '3 - Kehidupan Sehat dan Sejahtera',
      location: 'Kelurahan Palmerah dan Kemanggisan, Jakarta Barat',
      target: 5_000_000,
      team: ['Admin BINUS - koordinator kegiatan', 'Dua tenaga kesehatan dari puskesmas mitra', 'Enam relawan mahasiswa BINUS - pendaftaran dan pencatatan'],
      background: [
        'Lansia di permukiman sekitar kampus Kemanggisan jarang memeriksakan kesehatan secara rutin. Hipertensi dan diabetes sering baru diketahui setelah muncul komplikasi.',
        'Posyandu lansia setempat aktif, tetapi tidak memiliki alat cek gula darah dan kolesterol sendiri.',
      ],
      goals: [
        'Memeriksa tekanan darah, gula darah, kolesterol, dan asam urat 150 lansia.',
        'Merujuk lansia dengan hasil tidak normal ke puskesmas.',
        'Memberi setiap peserta kartu kesehatan untuk mencatat hasil pemeriksaan berikutnya.',
      ],
      beneficiaries: 'Sekitar 150 lansia usia 60 tahun ke atas dari tiga posyandu lansia di Palmerah dan Kemanggisan.',
      activities: [
        'Tiga hari pemeriksaan kesehatan di posyandu lansia.',
        'Konsultasi singkat hasil pemeriksaan dengan tenaga kesehatan.',
        'Rujukan tertulis ke puskesmas untuk hasil yang tidak normal.',
        'Pembagian makanan bergizi dan kartu kesehatan.',
      ],
      budget: [
        ['Alat cek gula darah, kolesterol, asam urat dan strip (150 lansia)', 2_250_000],
        ['Tensimeter digital (2 unit) dan timbangan', 750_000],
        ['Honor tenaga kesehatan puskesmas mitra', 1_000_000],
        ['Makanan bergizi peserta', 600_000],
        ['Cetak kartu kesehatan dan poster', 200_000],
        ['Dokumentasi dan laporan', 200_000],
      ],
      tranches: [
        'alat cek dan strip untuk pemeriksaan pertama.',
        'tensimeter, timbangan, dan strip tambahan.',
        'honor tenaga kesehatan dan pemeriksaan kedua.',
        'pemeriksaan ketiga dan makanan bergizi.',
        'kartu kesehatan, dokumentasi, dan laporan akhir.',
      ],
      schedule: ['Minggu 1: koordinasi dengan puskesmas dan posyandu', 'Minggu 2, 4, 6: hari pemeriksaan', 'Minggu 7: rekap hasil dan laporan'],
      indicators: [
        'Minimal 150 lansia diperiksa dan tercatat.',
        'Seluruh hasil tidak normal mendapat surat rujukan.',
        'Nota pembelian dan daftar hadir diunggah di setiap tahap pencairan.',
      ],
    },
  },
  {
    id: 'aaae2f9e-6fc3-43d7-bea8-1cfa5db69354',
    oldTitle: 'Test SendalNaga',
    title: 'Lab Mini Robotika untuk SMK Bina Karya',
    description:
      'Siswa jurusan elektronika SMK Bina Karya belajar mikrokontroler hanya dari buku karena sekolah tidak memiliki perangkat praktik. ' +
      'Campaign ini menyediakan 4 kit robot Arduino beserta alat kerja dan kelas praktik 8 pertemuan oleh mahasiswa BINUS. Dana dipakai untuk kit robot (Rp2.400.000), ' +
      'sensor dan komponen cadangan (Rp800.000), alat kerja (Rp600.000), modul dan pelatihan (Rp800.000), lomba mini (Rp200.000), serta dokumentasi dan laporan (Rp200.000).',
    proposal: {
      title: 'Lab Mini Robotika untuk SMK Bina Karya',
      sdg: '9 - Industri, Inovasi dan Infrastruktur',
      location: 'SMK Bina Karya, Tangerang',
      target: 5_000_000,
      team: ['Budi Santoso - ketua pelaksana', 'Tiga mahasiswa Computer Engineering BINUS - pengajar', 'Guru produktif elektronika SMK Bina Karya'],
      background: [
        'Siswa jurusan elektronika SMK Bina Karya mempelajari mikrokontroler hanya dari buku dan video karena sekolah tidak memiliki perangkat praktik.',
        'Akibatnya lulusan kesulitan saat magang di industri yang sudah memakai otomasi sederhana.',
      ],
      goals: [
        'Menyediakan 4 kit robot Arduino lengkap untuk praktik berkelompok.',
        'Melatih 32 siswa merakit dan memprogram robot sederhana dalam 8 pertemuan.',
        'Meninggalkan modul ajar yang bisa dipakai guru setelah program selesai.',
      ],
      beneficiaries: '32 siswa kelas XI jurusan elektronika, dan angkatan berikutnya yang memakai lab yang sama.',
      activities: [
        'Pengadaan kit robot, sensor, dan alat kerja.',
        'Kelas praktik 8 pertemuan: rangkaian dasar, sensor, motor, dan robot penghindar rintangan.',
        'Lomba mini robot antar-kelompok di pertemuan terakhir.',
        'Serah terima kit dan modul ke sekolah.',
      ],
      budget: [
        ['Kit robot Arduino (4 set)', 2_400_000],
        ['Sensor dan komponen cadangan', 800_000],
        ['Solder, multimeter, dan alat kerja', 600_000],
        ['Modul dan honor pelatihan 8 pertemuan', 800_000],
        ['Lomba mini dan sertifikat', 200_000],
        ['Dokumentasi dan laporan', 200_000],
      ],
      tranches: [
        'dua kit robot pertama.',
        'dua kit robot berikutnya.',
        'sensor, komponen cadangan, dan alat kerja.',
        'modul dan pelatihan 8 pertemuan.',
        'lomba mini, dokumentasi, dan laporan akhir.',
      ],
      schedule: ['Minggu 1-2: pengadaan perangkat', 'Minggu 3-10: kelas praktik', 'Minggu 11: lomba mini dan serah terima'],
      indicators: [
        '4 kit robot tercatat di inventaris sekolah.',
        'Minimal 28 dari 32 siswa menyelesaikan proyek robot.',
        'Nota dan daftar hadir diunggah di setiap tahap pencairan.',
      ],
    },
  },
  {
    id: '586bba0c-e2f6-4468-8ec2-0ba25c373698',
    oldTitle: 'guegue',
    title: 'Penanaman 500 Pohon di Bantaran Kali Pesanggrahan',
    description:
      'Bantaran Kali Pesanggrahan di Jakarta Barat makin gundul sehingga tanah mudah longsor dan banjir lebih cepat naik saat hujan deras. ' +
      'Campaign ini menanam dan merawat 500 pohon bersama warga dan relawan mahasiswa BINUS selama 3 bulan. Dana dipakai untuk bibit (Rp2.500.000), pupuk dan media tanam (Rp700.000), ' +
      'ajir dan alat tanam (Rp500.000), perawatan 3 bulan (Rp800.000), konsumsi relawan (Rp300.000), serta dokumentasi dan laporan (Rp200.000).',
    proposal: {
      title: 'Penanaman 500 Pohon di Bantaran Kali Pesanggrahan',
      sdg: '13 - Penanganan Perubahan Iklim',
      location: 'Bantaran Kali Pesanggrahan, Kembangan, Jakarta Barat',
      target: 5_000_000,
      team: ['Budi Santoso - ketua pelaksana', 'Komunitas peduli Kali Pesanggrahan', 'Relawan mahasiswa BINUS'],
      background: [
        'Bantaran Kali Pesanggrahan di Kembangan makin gundul. Tanpa akar pohon, tanah mudah tergerus dan air naik lebih cepat ke permukiman saat hujan deras.',
        'Komunitas warga sudah menyiapkan lahan, tetapi belum memiliki bibit dan biaya perawatan pada bulan-bulan awal yang paling menentukan.',
      ],
      goals: [
        'Menanam 500 pohon peneduh dan pohon buah di sepanjang 1 km bantaran.',
        'Menjaga tingkat hidup bibit minimal 80% setelah 3 bulan.',
        'Membentuk jadwal perawatan bergilir oleh warga.',
      ],
      beneficiaries: 'Sekitar 400 keluarga di tiga RW yang tinggal di sepanjang bantaran kali.',
      activities: [
        'Pengadaan bibit trembesi, mahoni, dan pohon buah.',
        'Hari tanam bersama warga dan relawan.',
        'Penyiraman dan pemupukan rutin selama 3 bulan.',
        'Pendataan pohon yang hidup dan penyulaman bibit yang mati.',
      ],
      budget: [
        ['Bibit pohon (500 batang)', 2_500_000],
        ['Pupuk organik dan media tanam', 700_000],
        ['Ajir, tali, dan alat tanam', 500_000],
        ['Perawatan dan penyiraman 3 bulan', 800_000],
        ['Konsumsi relawan hari tanam', 300_000],
        ['Dokumentasi dan laporan', 200_000],
      ],
      tranches: [
        '200 bibit pertama.',
        '300 bibit berikutnya.',
        'pupuk, media tanam, ajir, dan alat tanam.',
        'hari tanam dan perawatan bulan pertama.',
        'perawatan bulan kedua-ketiga, dokumentasi, dan laporan akhir.',
      ],
      schedule: ['Minggu 1-2: pengadaan bibit dan persiapan lahan', 'Minggu 3: hari tanam', 'Minggu 4-15: perawatan dan pendataan'],
      indicators: [
        '500 pohon tertanam dan dipetakan lokasinya.',
        'Minimal 400 pohon hidup setelah 3 bulan.',
        'Nota dan foto berkala diunggah di setiap tahap pencairan.',
      ],
    },
  },
  {
    id: 'e76f34ff-00c7-46dc-9aac-222691e7fe90',
    oldTitle: 'contoh campaign dibuat cuy',
    title: 'Modal Usaha Mikro untuk Ibu-Ibu Kampung Sawah',
    description:
      'Sepuluh ibu rumah tangga di Kampung Sawah menjalankan usaha makanan rumahan, tetapi kekurangan modal untuk bahan baku dan kemasan yang layak jual. ' +
      'Campaign ini memberi modal bergulir, pelatihan pembukuan dan pemasaran online, serta pendampingan selama 4 bulan. Dana dipakai untuk modal bergulir 10 usaha (Rp3.500.000), ' +
      'pelatihan (Rp600.000), kemasan dan label (Rp500.000), pendampingan (Rp200.000), serta dokumentasi dan laporan (Rp200.000).',
    proposal: {
      title: 'Modal Usaha Mikro untuk Ibu-Ibu Kampung Sawah',
      sdg: '1 - Tanpa Kemiskinan',
      location: 'Kampung Sawah, Jakarta Barat',
      target: 5_000_000,
      team: ['Budi Santoso - ketua pelaksana', 'Dua relawan mahasiswa BINUS jurusan Akuntansi dan Marketing', 'Ketua PKK RW setempat'],
      background: [
        'Sepuluh ibu rumah tangga di Kampung Sawah menjual kue dan lauk rumahan untuk menambah penghasilan keluarga, tetapi modal mereka habis untuk kebutuhan sehari-hari.',
        'Tanpa kemasan yang layak dan pencatatan keuangan, usaha mereka sulit berkembang dan tidak bisa masuk ke warung atau toko daring.',
      ],
      goals: [
        'Memberi modal bergulir Rp350.000 kepada 10 usaha rumahan.',
        'Melatih pembukuan sederhana dan pemasaran lewat media sosial.',
        'Menaikkan omzet rata-rata peserta minimal 30% dalam 4 bulan.',
      ],
      beneficiaries: '10 ibu pelaku usaha rumahan beserta keluarganya (sekitar 40 orang).',
      activities: [
        'Seleksi peserta bersama PKK RW.',
        'Penyaluran modal bergulir untuk bahan baku.',
        'Pelatihan pembukuan, foto produk, dan penjualan daring.',
        'Pendampingan bulanan dan pencatatan omzet.',
      ],
      budget: [
        ['Modal bergulir 10 usaha (Rp350.000 per usaha)', 3_500_000],
        ['Pelatihan pembukuan dan pemasaran online', 600_000],
        ['Kemasan dan label produk', 500_000],
        ['Pendampingan bulanan', 200_000],
        ['Dokumentasi dan laporan', 200_000],
      ],
      tranches: [
        'modal untuk 3 usaha pertama.',
        'modal untuk 3 usaha berikutnya.',
        'modal untuk 4 usaha terakhir.',
        'pelatihan, kemasan, dan label.',
        'pendampingan, dokumentasi, dan laporan akhir.',
      ],
      schedule: ['Bulan 1: seleksi peserta dan penyaluran modal', 'Bulan 1-2: pelatihan', 'Bulan 2-4: pendampingan dan pencatatan omzet'],
      indicators: [
        '10 usaha menerima modal dengan tanda terima.',
        'Seluruh peserta memiliki buku kas sederhana.',
        'Nota dan laporan omzet diunggah di setiap tahap pencairan.',
      ],
    },
  },
  {
    id: '24c2ff28-1aef-491a-9abc-65cf3edbd503',
    oldTitle: 'test 3',
    title: 'Gerakan Kantin Tanpa Plastik di Kampus Kemanggisan',
    description:
      'Kantin di sekitar kampus Kemanggisan menghasilkan ratusan wadah dan botol plastik sekali pakai setiap hari. ' +
      'Campaign ini menyediakan 300 set wadah makan pakai ulang, dua stasiun isi ulang air minum, dan tempat sampah terpilah, disertai kampanye bawa wadah sendiri. ' +
      'Dana dipakai untuk wadah dan alat makan (Rp2.400.000), stasiun isi ulang (Rp1.200.000), tempat sampah terpilah (Rp600.000), kampanye (Rp400.000), ' +
      'insentif tenant (Rp200.000), serta dokumentasi dan laporan (Rp200.000).',
    proposal: {
      title: 'Gerakan Kantin Tanpa Plastik di Kampus Kemanggisan',
      sdg: '12 - Konsumsi dan Produksi yang Bertanggung Jawab',
      location: 'Kantin sekitar kampus BINUS Kemanggisan, Jakarta Barat',
      target: 5_000_000,
      team: ['a sigam - ketua pelaksana', 'Himpunan mahasiswa peduli lingkungan', 'Perwakilan tenant kantin'],
      background: [
        'Kantin di sekitar kampus Kemanggisan menghasilkan ratusan wadah styrofoam, kantong plastik, dan botol sekali pakai setiap hari.',
        'Survei awal menunjukkan banyak mahasiswa mau membawa wadah sendiri bila ada tempat isi ulang air dan potongan harga dari kantin.',
      ],
      goals: [
        'Mengurangi sampah plastik sekali pakai kantin minimal 50% dalam 3 bulan.',
        'Menyediakan 300 set wadah makan pakai ulang untuk dipinjam atau dibeli murah.',
        'Memasang dua stasiun isi ulang air minum gratis.',
      ],
      beneficiaries: 'Sekitar 1.500 mahasiswa pengguna kantin dan 12 tenant kantin.',
      activities: [
        'Pengadaan wadah, alat makan, dan stasiun isi ulang.',
        'Pemasangan tempat sampah terpilah dan poster panduan.',
        'Program diskon untuk pembeli yang membawa wadah sendiri.',
        'Penimbangan sampah plastik mingguan sebelum dan sesudah program.',
      ],
      budget: [
        ['Wadah dan alat makan pakai ulang (300 set)', 2_400_000],
        ['Stasiun isi ulang air minum (2 unit)', 1_200_000],
        ['Tempat sampah terpilah (4 set)', 600_000],
        ['Kampanye dan poster', 400_000],
        ['Insentif tenant kantin (diskon bawa wadah)', 200_000],
        ['Dokumentasi dan laporan', 200_000],
      ],
      tranches: [
        '150 set wadah pertama.',
        '150 set wadah berikutnya.',
        'dua stasiun isi ulang air minum.',
        'tempat sampah terpilah dan kampanye.',
        'insentif tenant, dokumentasi, dan laporan akhir.',
      ],
      schedule: ['Minggu 1-2: pengadaan dan penimbangan awal', 'Minggu 3: peluncuran kampanye', 'Minggu 3-14: program berjalan dan penimbangan mingguan'],
      indicators: [
        'Berat sampah plastik kantin turun minimal 50% dibanding minggu pertama.',
        '300 set wadah tersalurkan dan tercatat.',
        'Nota dan data penimbangan diunggah di setiap tahap pencairan.',
      ],
    },
  },
  {
    id: 'e9253a0f-cd32-4cd6-adda-1371f0cde08f',
    oldTitle: 'test 2 agra',
    title: 'Pelatihan Anti-Perundungan untuk 10 Sekolah Menengah',
    description:
      'Kasus perundungan di sekolah menengah sering tidak dilaporkan karena siswa takut dan sekolah tidak punya mekanisme pengaduan yang aman. ' +
      'Campaign ini melatih duta anti-perundungan di 10 SMP dan SMA bersama psikolog, serta memasang kotak pengaduan anonim. Dana dipakai untuk modul (Rp1.000.000), ' +
      'honor fasilitator psikolog (Rp2.000.000), transportasi (Rp800.000), konsumsi pelatihan (Rp800.000), poster dan kotak pengaduan (Rp200.000), serta dokumentasi dan laporan (Rp200.000).',
    proposal: {
      title: 'Pelatihan Anti-Perundungan untuk 10 Sekolah Menengah',
      sdg: '16 - Perdamaian, Keadilan dan Kelembagaan yang Tangguh',
      location: '10 SMP dan SMA di Jakarta Barat',
      target: 5_000_000,
      team: ['a sigam - ketua pelaksana', 'Dua psikolog fasilitator', 'Relawan mahasiswa Psikologi BINUS'],
      background: [
        'Perundungan di sekolah menengah sering tidak dilaporkan karena siswa takut dibalas dan sekolah belum punya mekanisme pengaduan yang aman.',
        'Guru BK di sekolah mitra meminta pendampingan untuk membentuk kelompok siswa yang bisa menjadi tempat pertama korban bercerita.',
      ],
      goals: [
        'Melatih 10 duta anti-perundungan di setiap sekolah (100 siswa).',
        'Memasang kotak pengaduan anonim di 10 sekolah.',
        'Menyusun alur penanganan laporan bersama guru BK.',
      ],
      beneficiaries: 'Sekitar 500 siswa peserta sosialisasi dan 100 duta anti-perundungan di 10 sekolah.',
      activities: [
        'Sosialisasi kelas tentang bentuk perundungan dan cara melapor.',
        'Pelatihan duta anti-perundungan bersama psikolog.',
        'Pemasangan kotak pengaduan dan poster.',
        'Penyusunan alur penanganan laporan bersama guru BK.',
      ],
      budget: [
        ['Modul dan lembar kerja (500 siswa)', 1_000_000],
        ['Honor fasilitator psikolog (10 sesi)', 2_000_000],
        ['Transportasi tim ke 10 sekolah', 800_000],
        ['Konsumsi pelatihan duta anti-perundungan', 800_000],
        ['Poster dan kotak pengaduan', 200_000],
        ['Dokumentasi dan laporan', 200_000],
      ],
      tranches: [
        'modul dan sesi di 2 sekolah pertama.',
        'sesi di sekolah ketiga sampai kelima.',
        'sesi di sekolah keenam sampai kedelapan.',
        'sesi di dua sekolah terakhir dan kotak pengaduan.',
        'konsumsi pelatihan duta, dokumentasi, dan laporan akhir.',
      ],
      schedule: ['Minggu 1-2: koordinasi dengan sekolah', 'Minggu 3-12: satu sekolah per minggu', 'Minggu 13: evaluasi dan laporan'],
      indicators: [
        '100 duta anti-perundungan terlatih dan bersertifikat.',
        'Kotak pengaduan terpasang di 10 sekolah dengan tanda terima kepala sekolah.',
        'Nota dan daftar hadir diunggah di setiap tahap pencairan.',
      ],
    },
  },
  {
    id: '533d3bab-7a6b-48be-a4ea-a86911a07080',
    oldTitle: 'Kampanye main gta 6',
    title: 'Kelas Membuat Game Edukasi untuk Remaja Karang Taruna',
    description:
      'Remaja Karang Taruna di Palmerah banyak menghabiskan waktu bermain game, tetapi belum pernah belajar cara membuatnya. ' +
      'Campaign ini mengadakan kelas membuat game edukasi sederhana selama 6 pertemuan memakai perangkat lunak gratis, dibimbing mahasiswa BINUS, dan ditutup dengan pameran karya. ' +
      'Dana dipakai untuk internet (Rp300.000), modul (Rp200.000), konsumsi (Rp400.000), hadiah dan sertifikat (Rp200.000), serta dokumentasi dan laporan (Rp100.000).',
    proposal: {
      title: 'Kelas Membuat Game Edukasi untuk Remaja Karang Taruna',
      sdg: '9 - Industri, Inovasi dan Infrastruktur',
      location: 'Sekretariat Karang Taruna, Palmerah, Jakarta Barat',
      target: 1_200_000,
      team: ['Kai - ketua pelaksana', 'Dua mahasiswa Game Application and Technology BINUS - pengajar', 'Pengurus Karang Taruna'],
      background: [
        'Remaja Karang Taruna di Palmerah banyak menghabiskan waktu bermain game, tetapi belum pernah belajar bagaimana game dibuat.',
        'Membuat game edukasi sederhana melatih logika, kerja tim, dan kreativitas, dan bisa dimulai dengan perangkat lunak gratis serta laptop pinjaman kampus.',
      ],
      goals: [
        'Mengajarkan dasar pembuatan game 2D kepada 20 remaja dalam 6 pertemuan.',
        'Menghasilkan minimal 5 game edukasi buatan kelompok peserta.',
        'Memamerkan karya peserta kepada warga dan pengurus kelurahan.',
      ],
      beneficiaries: '20 remaja anggota Karang Taruna usia 14-20 tahun.',
      activities: [
        'Pengenalan desain game dan perangkat lunak gratis.',
        'Praktik membuat game 2D bertema pelajaran sekolah secara berkelompok.',
        'Uji coba game oleh anak-anak sekitar.',
        'Pameran karya dan pembagian sertifikat.',
      ],
      budget: [
        ['Paket data dan internet (6 pertemuan)', 300_000],
        ['Cetak modul dan panduan', 200_000],
        ['Konsumsi 6 pertemuan', 400_000],
        ['Hadiah pameran dan sertifikat', 200_000],
        ['Dokumentasi dan laporan', 100_000],
      ],
      tranches: [
        'modul dan internet pertemuan pertama.',
        'konsumsi dan internet pertemuan kedua-ketiga.',
        'konsumsi dan internet pertemuan keempat-kelima.',
        'pertemuan keenam dan persiapan pameran.',
        'hadiah, sertifikat, dokumentasi, dan laporan akhir.',
      ],
      schedule: ['Minggu 1: pendaftaran peserta', 'Minggu 2-7: enam pertemuan', 'Minggu 8: pameran karya dan laporan'],
      indicators: [
        'Minimal 16 dari 20 peserta mengikuti seluruh pertemuan.',
        'Minimal 5 game edukasi selesai dan bisa dimainkan.',
        'Nota dan daftar hadir diunggah di setiap tahap pencairan.',
      ],
    },
  },
];
