/**
 * Deteksi teks asal ketik ("hasjdhjshd…", "asdasdasd", "aaaaaaa") untuk deskripsi campaign
 * dan pengajuan lain yang dibaca donatur. Sengaja longgar: hanya menolak pola yang hampir
 * pasti bukan kalimat, bukan menilai gaya bahasa.
 */

/** Kata terpanjang yang wajar. Kata majemuk Indonesia/Inggris jarang melewati 25 huruf. */
const MAX_WORD_LETTERS = 30;
const MIN_WORDS = 8;
/** Rasio huruf vokal teks Indonesia/Inggris ~0,35–0,45; ketikan acak di keyboard jauh di bawahnya. */
const MIN_VOWEL_RATIO = 0.25;

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;

/** Pesan masalah (Bahasa Indonesia) atau null bila teks terlihat seperti kalimat sungguhan. */
export function gibberishProblem(text: string): string | null {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w && !URL_RE.test(w));
  const letters = words.join('').replace(/[^a-z]/gi, '');

  const longest = words.reduce((max, w) => Math.max(max, w.replace(/[^a-z]/gi, '').length), 0);
  if (longest > MAX_WORD_LETTERS) {
    return `Ada rangkaian ${longest} huruf tanpa spasi. Tulis deskripsi dalam kalimat yang bisa dibaca donatur.`;
  }
  // Per kata, bukan teks gabungan, agar kata yang memang diulang antar-kalimat tidak ikut terdeteksi.
  if (words.some((w) => /([a-z]{1,6})\1{3,}/i.test(w))) {
    return 'Deskripsi berisi pola huruf yang berulang. Tulis deskripsi dalam kalimat yang bisa dibaca donatur.';
  }
  if (words.length < MIN_WORDS) {
    return `Deskripsi terlalu singkat: minimal ${MIN_WORDS} kata.`;
  }
  if (letters.length >= 20) {
    const vowels = letters.replace(/[^aiueo]/gi, '').length;
    if (vowels / letters.length < MIN_VOWEL_RATIO) {
      return 'Deskripsi tampak seperti ketikan acak. Tulis deskripsi dalam kalimat yang bisa dibaca donatur.';
    }
  }
  const counts = new Map<string, number>();
  for (const w of words) {
    const k = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  if (words.length >= MIN_WORDS && top / words.length > 0.5) {
    return 'Deskripsi mengulang kata yang sama. Tulis deskripsi dalam kalimat yang bisa dibaca donatur.';
  }
  return null;
}
