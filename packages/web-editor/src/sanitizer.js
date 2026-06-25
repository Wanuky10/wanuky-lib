/**
 * Sanitasi HTML untuk output RichTextEditor.
 * Berjalan di browser environment — menggunakan DOM parser native.
 * Tidak bisa dipakai di Node.js tanpa jsdom/happy-dom.
 *
 * @adr Primitif event-handler-stripping & rel=noopener diimpor dari sanitizer-core.js (shared dengan
 *     richTextEditor.js's sanitasiHtml() privat). Lihat ADR lengkap di header
 *     sanitizer-core.js untuk alasan kenapa whitelist tag/atribut & strategi
 *     validasi URL TIDAK diunifikasi — dua modul ini punya threat model yang
 *     berbeda secara sengaja.
 */
import { lucutiEventHandler, isProtokolDiizinkan, amankanTargetBlank } from './sanitizer-core.js';

const TAG_DEFAULT = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
  'h1', 'h2', 'h3', 'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'a', 'img',
]);

const ATRIBUT_AMAN = {
  a:   new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  '*': new Set([]),
};

const PROTOKOL_AMAN = /^(https?:|mailto:|tel:)/i;

/**
 * @typedef {Object} SanitasiOptions
 * @property {boolean}  [aktif=true]
 * @property {string[]} [tagDiizinkan]     - Override daftar tag yang diizinkan
 * @property {boolean}  [paksakanHttps=true]
 */
// @adr Opsi `atributDiizinkan` dihapus dari typedef ini (V2.2.0).
// @context Opsi ini terdaftar di JSDoc sejak versi sebelumnya tapi tidak
//   pernah dibaca oleh bersihkanNode() — fungsi tersebut hanya menerima
//   tagDiizinkan & paksakanHttps, dan selalu fallback ke ATRIBUT_AMAN
//   hardcoded. Ini API yang mengklaim mendukung sesuatu yang sebenarnya
//   tidak pernah diimplementasi — berisiko menyesatkan konsumen yang
//   membaca typedef dan mengasumsikan override ini berfungsi.
// @decision Hapus dari dokumentasi alih-alih mengimplementasikannya secara
//   diam-diam. Tidak ada pemanggil internal yang memakai opsi ini (diverifikasi
//   via grep `atributDiizinkan` — hanya muncul di typedef ini sebelum
//   perubahan ini), dan karena `sanitasi()` hanya dipanggil secara internal
//   dalam monorepo ini saat ini (lihat catatan "internal-only" di README),
//   menghapusnya bukan breaking change bagi konsumen yang ada.
// @tradeoff Jika kelak dibutuhkan override atribut per-tag, opsi ini harus
//   diimplementasikan ulang dengan benar (dibaca di bersihkanNode(), bukan
//   sekadar didokumentasikan) — bukan dikembalikan begitu saja ke typedef.

/**
 * Sanitasi HTML string — hapus tag, atribut, dan URL berbahaya.
 *
 * @param {string} html
 * @param {SanitasiOptions} [opts={}]
 * @returns {string}
 */
export function sanitasi(html, opts = {}) {
  if (opts.aktif === false) return html;

  const tagDiizinkan = opts.tagDiizinkan
    ? new Set(opts.tagDiizinkan.map(t => t.toLowerCase()))
    : TAG_DEFAULT;

  const paksakanHttps = opts.paksakanHttps ?? true;

  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');

  bersihkanNode(doc.body, tagDiizinkan, paksakanHttps);

  return doc.body.innerHTML;
}

function bersihkanNode(node, tagDiizinkan, paksakanHttps) {
  const anakList = [...node.childNodes]; // snapshot — childNodes berubah saat kita modifikasi

  for (const anak of anakList) {
    if (anak.nodeType === Node.TEXT_NODE) continue;

    if (anak.nodeType === Node.ELEMENT_NODE) {
      const tagName = anak.tagName.toLowerCase();

      if (!tagDiizinkan.has(tagName)) {
        anak.replaceWith(...anak.childNodes);
        continue;
      }

      lucutiEventHandler(anak);

      const atribSah        = ATRIBUT_AMAN[tagName] ?? ATRIBUT_AMAN['*'];
      const atribUntukHapus = [];

      for (const attr of anak.attributes) {
        const namaAttr = attr.name.toLowerCase();

        if (!atribSah.has(namaAttr)) {
          atribUntukHapus.push(attr.name);
          continue;
        }

        if ((namaAttr === 'href' || namaAttr === 'src') && paksakanHttps) {
          if (!isProtokolDiizinkan(attr.value, PROTOKOL_AMAN)) {
            atribUntukHapus.push(attr.name);
          }
        }
      }

      for (const nama of atribUntukHapus) {
        anak.removeAttribute(nama);
      }

      if (tagName === 'a') {
        amankanTargetBlank(anak);
      }

      bersihkanNode(anak, tagDiizinkan, paksakanHttps);
    } else {
      anak.remove();
    }
  }
}
