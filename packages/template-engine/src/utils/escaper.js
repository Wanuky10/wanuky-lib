/**
 * Memetakan karakter HTML yang wajib di-escape ke entity-nya.
 * Menggunakan Map untuk O(1) lookup — lebih efisien dari objek biasa
 * karena iterasi dijamin terurut dan tidak ada prototype pollution.
 */
const KARAKTER_HTML = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#x27;'],
  ['`', '&#x60;'],
]);

// Regex dikompilasi sekali di module level — bukan di dalam fungsi —
// agar tidak di-recompile setiap kali escapeHtml dipanggil.
const REGEX_KARAKTER_HTML = /[&<>"'`]/g;

/**
 * Escape string agar aman disisipkan ke dalam HTML.
 * Wajib dipanggil di setiap titik interpolasi <{ variabel }>.
 *
 * @param {unknown} nilai - Nilai yang akan di-escape. Non-string dikonversi dulu.
 * @returns {string} String yang sudah aman untuk HTML.
 */
export function escapeHtml(nilai) {
  // Null/undefined dirender sebagai string kosong — bukan 'null' atau 'undefined'
  // yang bisa membingungkan pengguna akhir.
  if (nilai === null || nilai === undefined) return '';

  return String(nilai).replace(
    REGEX_KARAKTER_HTML,
    (karakter) => KARAKTER_HTML.get(karakter) ?? karakter,
  );
}

/**
 * Mengembalikan nilai mentah tanpa escaping — untuk kasus di mana
 * konten HTML dipercaya sepenuhnya (misalnya hasil render parsial internal).
 * Gunakan dengan sangat hati-hati: tidak pernah untuk input pengguna.
 *
 * @param {unknown} nilai
 * @returns {string}
 */
export function rawHtml(nilai) {
  if (nilai === null || nilai === undefined) return '';
  return String(nilai);
}
