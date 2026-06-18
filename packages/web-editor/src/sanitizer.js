/**
 * Sanitasi HTML untuk output RichTextEditor.
 * Berjalan di browser environment — menggunakan DOM parser native.
 * Tidak bisa dipakai di Node.js tanpa jsdom/happy-dom.
 */

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
 * @property {string[]} [atributDiizinkan] - Override daftar atribut global
 * @property {boolean}  [paksakanHttps=true]
 */

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
        // Hapus tag tapi pertahankan konten teks di dalamnya
        anak.replaceWith(...anak.childNodes);
        continue;
      }

      // Bersihkan atribut
      const atribSah        = ATRIBUT_AMAN[tagName] ?? ATRIBUT_AMAN['*'];
      const atribUntukHapus = [];

      for (const attr of anak.attributes) {
        const namaAttr = attr.name.toLowerCase();

        // Selalu hapus event handler (on*)
        if (namaAttr.startsWith('on')) {
          atribUntukHapus.push(attr.name);
          continue;
        }

        if (!atribSah.has(namaAttr)) {
          atribUntukHapus.push(attr.name);
          continue;
        }

        // Validasi URL di href dan src
        if ((namaAttr === 'href' || namaAttr === 'src') && paksakanHttps) {
          const nilai = attr.value.trim().toLowerCase();
          if (!PROTOKOL_AMAN.test(nilai)) {
            atribUntukHapus.push(attr.name);
          }
        }
      }

      for (const nama of atribUntukHapus) {
        anak.removeAttribute(nama);
      }

      // Tambahkan rel="noopener noreferrer" ke semua link yang target="_blank"
      if (tagName === 'a' && anak.getAttribute('target') === '_blank') {
        anak.setAttribute('rel', 'noopener noreferrer');
      }

      // Rekursif ke children
      bersihkanNode(anak, tagDiizinkan, paksakanHttps);
    } else {
      // Hapus comment, processing instruction, dll.
      anak.remove();
    }
  }
}
