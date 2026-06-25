/**
 * sanitizer-core.js — primitif sanitasi HTML yang dipakai bersama.
 *
 * @module @wanuky10/web-editor/sanitizer-core
 * @internal Modul ini TIDAK diekspor lewat index.js. Hanya dipakai oleh
 *           sanitizer.js (API publik `sanitasi()`) dan richTextEditor.js
 *           (fungsi privat `sanitasiHtml()`).
 *
 * @adr     Ekstraksi primitif, bukan unifikasi whitelist/strategi URL
 * @context sanitizer.js dan richTextEditor.js punya threat model yang BERBEDA
 *          secara sengaja: sanitizer.js's sanitasi() adalah API publik paket ini
 *          (diekspor di index.js) — dirancang ketat untuk HTML yang sumbernya
 *          bisa dari luar (whitelist protokol href/src ketat: https/mailto/tel
 *          saja, tanpa atribut style). richTextEditor.js's sanitasiHtml() murni
 *          privat — membersihkan HTML hasil document.execCommand/contentEditable
 *          milik browser sendiri dan HTML hasil paste, yang butuh keleluasaan
 *          lebih: tabel, atribut style (terbatas), dan data: URL untuk gambar
 *          yang diupload user sebagai base64 (fitur upload gambar RichTextEditor
 *          bergantung pada ini — tanpa data: URL, gambar upload akan rusak).
 * @decision Hanya logic yang BENAR-BENAR identik di kedua sisi — pelucutan
 *          atribut event handler (on*), deteksi protokol javascript: yang
 *          berbahaya, dan penambahan rel="noopener noreferrer" pada
 *          target="_blank" — diekstrak ke sini sebagai fungsi murni yang
 *          menerima parameter (bukan whitelist hardcoded). Kebijakan whitelist
 *          tag/atribut dan strategi validasi URL (ketat-whitelist vs
 *          permisif-blacklist) tetap jadi keputusan masing-masing pemanggil.
 * @tradeoff Tidak menghasilkan satu fungsi sanitasi tunggal — duplikasi pada
 *          level "policy" (daftar tag, daftar atribut per tag) tetap ada di
 *          dua tempat. Tapi ini duplikasi yang BENAR (dua kebutuhan keamanan
 *          yang berbeda), bukan duplikasi yang salah (logic yang seharusnya
 *          identik tapi ditulis dua kali dan bisa diverge saat bug fix).
 * @alternatives (1) Paksa richTextEditor pakai sanitasi() dari sanitizer.js
 *          dengan opsi baru (izinkan data:, filter style) — ditolak: sanitasi()
 *          adalah API publik, menambah opsi untuk kebutuhan privat memperbesar
 *          permukaan API publik tanpa manfaat bagi konsumen eksternal.
 *          (2) Biarkan dua implementasi terpisah total — ditolak: tidak
 *          menyelesaikan duplikasi logic (event handler, protokol javascript,
 *          rel=noopener) yang rawan diverge saat salah satu sisi di-patch
 *          tapi sisi lain lupa.
 */

/**
 * Hapus semua atribut event handler (on*) dari elemen.
 * Selalu dipanggil terlepas dari whitelist atribut pemanggil — event handler
 * tidak pernah boleh lolos di jalur sanitasi apa pun.
 *
 * @param {Element} elemen
 * @returns {void}
 */
export function lucutiEventHandler(elemen) {
  for (const attr of Array.from(elemen.attributes ?? [])) {
    if (attr.name.toLowerCase().startsWith('on')) {
      elemen.removeAttribute(attr.name);
    }
  }
}

/**
 * Cek apakah nilai URL memakai protokol javascript: (case-insensitive,
 * mentolerir leading whitespace seperti " javascript:alert(1)").
 *
 * @param {string} nilaiUrl
 * @returns {boolean}
 */
export function isProtokolBerbahaya(nilaiUrl) {
  return /^\s*javascript:/i.test(nilaiUrl ?? '');
}

/**
 * Validasi nilai URL terhadap whitelist protokol eksplisit.
 * Dipakai jalur ketat (sanitizer.js) — berbeda dari isProtokolBerbahaya()
 * yang dipakai jalur permisif (richTextEditor.js, blacklist-style).
 *
 * @param {string} nilaiUrl
 * @param {RegExp} protokolDiizinkan
 * @returns {boolean}
 */
export function isProtokolDiizinkan(nilaiUrl, protokolDiizinkan) {
  return protokolDiizinkan.test((nilaiUrl ?? '').trim().toLowerCase());
}

/**
 * Tambahkan rel="noopener noreferrer" pada elemen <a target="_blank">.
 * Mencegah reverse tabnabbing (tab asal bisa dimanipulasi via window.opener).
 *
 * @param {Element} elemenA
 * @returns {void}
 */
export function amankanTargetBlank(elemenA) {
  if (elemenA.getAttribute('target') === '_blank') {
    elemenA.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * Filter properti CSS di dalam atribut style — hanya izinkan properti yang
 * eksplisit ada di daftar putih, hapus sisanya. Mengembalikan string kosong
 * jika tidak ada properti yang lolos (pemanggil harus removeAttribute jika
 * hasil kosong).
 *
 * @param {string} nilaiStyle
 * @param {RegExp} properiDiizinkan - regex yang match "nama-properti:" di awal deklarasi
 * @returns {string}
 */
export function filterStyle(nilaiStyle, properiDiizinkan) {
  return (nilaiStyle ?? '')
    .split(';')
    .map((deklarasi) => deklarasi.trim())
    .filter((deklarasi) => properiDiizinkan.test(deklarasi))
    .join('; ');
}
