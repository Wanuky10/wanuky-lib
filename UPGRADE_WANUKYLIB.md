# UPGRADE_WANUKYLIB.md
## Panduan Upgrade `@wanuky10/template-engine` & `@wanuky10/web-editor` — v1.1.0 → v2.0.0

Dokumen ini adalah **satu-satunya referensi** saat mengimplementasi upgrade wanuky-lib.
Baca seluruh dokumen sebelum menulis satu baris kode. Setiap keputusan di sini
sudah mempertimbangkan backward compatibility, security, dan konsistensi antar paket.

---

## Daftar Isi

1. [Prinsip Upgrade](#1-prinsip-upgrade)
2. [Struktur Monorepo](#2-struktur-monorepo)
3. [Shared: LRU Cache](#3-shared-lru-cache)
4. [template-engine: API v2](#4-template-engine-api-v2)
5. [web-editor / RichTextEditor: API v2](#5-web-editor--richtexteditor-api-v2)
6. [web-editor / ImageEditor: API v2](#6-web-editor--imageeditor-api-v2)
7. [Distribusi & Versioning](#7-distribusi--versioning)
8. [Checklist Implementasi](#8-checklist-implementasi)

---

## 1. Prinsip Upgrade

### Breaking vs Non-Breaking

```
BREAKING (butuh major version bump):
  - Rename method atau hapus method yang ada
  - Ubah signature method (urutan/tipe parameter)
  - Ubah tipe return value yang ada
  - Ubah nama option key yang ada

NON-BREAKING (aman sebagai minor/patch):
  - Tambah method baru
  - Tambah option baru dengan default value
  - Tambah property baru di return object
  - Fix bug yang tidak mengubah API signature
```

v2.0.0 ini adalah **major release** karena:
- `simpan()` di ImageEditor berubah dari `void` ke `Promise<Blob>`
- `getDataUrl()` berubah dari `string` ke `Promise<string>`
- `getNilai()` di RichTextEditor sekarang mengembalikan HTML yang sudah disanitasi
- Option `ukuranMaks` di template-engine diperluas dari `number` ke `{ jumlah, max }`

### Aturan implementasi

- Semua file menggunakan `"type": "module"` — tidak ada `require()` atau `module.exports`
- Tidak ada dependensi kecuali yang tercantum eksplisit di section masing-masing paket
- Private fields menggunakan `#` (native JS private, bukan konvensi `_`)
- Semua async menggunakan `async/await`, bukan `.then()` chains
- Error yang dilempar selalu merupakan instance dari custom class (tidak pernah `throw new Error('string')` polos)

---

## 2. Struktur Monorepo

```
wanuky-lib/
├── package.json                    ← root, "private": true, workspaces
├── .changeset/                     ← changesets untuk versioning
│   └── config.json
├── .github/
│   └── workflows/
│       └── publish.yml             ← auto-publish ke GitHub Packages
├── packages/
│   ├── template-engine/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.js            ← public API exports
│   │   │   ├── engine.js           ← buatEngine() factory
│   │   │   ├── parser.js           ← tokenizer + renderer
│   │   │   ├── lru-cache.js        ← LRUCache class (shared)
│   │   │   └── errors.js           ← TemplateError class
│   │   └── tests/
│   │       ├── engine.test.js
│   │       ├── parser.test.js
│   │       └── cache.test.js
│   └── web-editor/
│       ├── package.json
│       ├── src/
│       │   ├── index.js            ← public API exports
│       │   ├── rich-text-editor.js
│       │   ├── image-editor.js
│       │   ├── format-manager.js   ← Selection API operations
│       │   ├── sanitizer.js        ← HTML sanitasi tanpa dependensi eksternal
│       │   ├── exif-reader.js      ← EXIF orientation parser
│       │   └── errors.js           ← EditorError class
│       └── tests/
│           ├── rich-text-editor.test.js
│           ├── image-editor.test.js
│           └── sanitizer.test.js
```

### Root `package.json`

```json
{
  "name": "wanuky-lib",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run --reporter=verbose",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "build": "npm run build --workspaces --if-present",
    "version": "changeset version",
    "release": "changeset publish"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "vitest": "^1.6.0"
  },
  "engines": { "node": ">=18" }
}
```

---

## 3. Shared: LRU Cache

Digunakan oleh `template-engine`. Implementasi ini adalah satu file, tidak ada dependensi.

**File:** `packages/template-engine/src/lru-cache.js`

```js
/**
 * LRU Cache berbasis Map dengan eviction otomatis.
 * Map di JS menjaga insertion order — ini yang memungkinkan LRU tanpa struktur tambahan.
 */
export class LRUCache {
  #cache = new Map();
  #maxSize;

  /** @param {number} maxSize - Maksimum entri sebelum evict. Default: 200 */
  constructor(maxSize = 200) {
    if (maxSize < 1) throw new RangeError('LRUCache: maxSize harus >= 1');
    this.#maxSize = maxSize;
  }

  /**
   * Ambil nilai. Otomatis promote ke "most recently used".
   * @returns {unknown | undefined}
   */
  get(key) {
    if (!this.#cache.has(key)) return undefined;
    const value = this.#cache.get(key);
    // Re-insert ke akhir = tandai sebagai most recently used
    this.#cache.delete(key);
    this.#cache.set(key, value);
    return value;
  }

  /**
   * Set nilai. Jika cache penuh, hapus entri paling lama tidak diakses.
   */
  set(key, value) {
    if (this.#cache.has(key)) {
      this.#cache.delete(key);
    } else if (this.#cache.size >= this.#maxSize) {
      // .keys().next().value = first key = least recently used
      this.#cache.delete(this.#cache.keys().next().value);
    }
    this.#cache.set(key, value);
  }

  has(key) { return this.#cache.has(key); }
  delete(key) { return this.#cache.delete(key); }
  clear() { this.#cache.clear(); }

  get size() { return this.#cache.size; }
  get maxSize() { return this.#maxSize; }
}
```

---

## 4. template-engine: API v2

### 4.1 Options Schema (Lengkap)

```js
/**
 * @typedef {Object} EngineOptions
 * @property {string}  dirViews             - Path absolut ke direktori views. WAJIB.
 * @property {string}  dirLayouts           - Path absolut ke direktori layouts. WAJIB.
 * @property {boolean} [cache=true]         - Aktifkan file cache.
 * @property {number}  [cacheMaxSize=200]   - Maks entri cache sebelum LRU evict.
 * @property {boolean} [debug=false]        - Log detail render ke stderr.
 * @property {number}  [maxIncludeDepth=20] - Kedalaman include maksimum (cegah circular).
 */
```

### 4.2 Public API

**File:** `packages/template-engine/src/index.js`

```js
export { buatEngine } from './engine.js';
export { TemplateError } from './errors.js';
```

**File:** `packages/template-engine/src/engine.js`

```js
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LRUCache } from './lru-cache.js';
import { render } from './parser.js';
import { TemplateError } from './errors.js';

/**
 * Factory — buat instance engine.
 *
 * @param {EngineOptions} options
 * @returns {EngineInstance}
 */
export function buatEngine(options = {}) {
  // Validasi opsi wajib
  if (!options.dirViews)   throw new TypeError('buatEngine: dirViews wajib diisi');
  if (!options.dirLayouts) throw new TypeError('buatEngine: dirLayouts wajib diisi');

  const config = {
    dirViews:        resolve(options.dirViews),
    dirLayouts:      resolve(options.dirLayouts),
    cache:           options.cache ?? true,
    cacheMaxSize:    options.cacheMaxSize ?? 200,
    debug:           options.debug ?? false,
    maxIncludeDepth: options.maxIncludeDepth ?? 20,
  };

  const fileCache = new LRUCache(config.cacheMaxSize);

  /**
   * Baca file template dari disk, dengan cache opsional.
   * @param {string} absolutePath
   * @returns {string}
   */
  function bacaFile(absolutePath) {
    if (config.cache) {
      const cached = fileCache.get(absolutePath);
      if (cached !== undefined) return cached;
    }
    try {
      const isi = readFileSync(absolutePath, 'utf8');
      if (config.cache) fileCache.set(absolutePath, isi);
      return isi;
    } catch (err) {
      throw new TemplateError(`File tidak ditemukan: ${absolutePath}`, {
        file: absolutePath,
        cause: err,
      });
    }
  }

  /**
   * Render view dengan data dan layout opsional.
   *
   * @param {string} namaView      - Nama file relatif dari dirViews, tanpa leading slash.
   *                                 Contoh: 'pages/artikel.html'
   * @param {Record<string, unknown>} [data={}]
   * @param {string|null} [layout=null] - Nama file relatif dari dirLayouts.
   *                                 Konten view di-inject ke tag <contents> dalam layout.
   * @returns {string}             - HTML hasil render.
   *
   * @throws {TemplateError}       - Jika file tidak ditemukan atau sintaks template salah.
   */
  function rendang(namaView, data = {}, layout = null) {
    const pathView = join(config.dirViews, namaView);
    const templateView = bacaFile(pathView);

    const htmlView = render(templateView, data, {
      dirViews: config.dirViews,
      bacaFile,
      maxDepth: config.maxIncludeDepth,
      debug: config.debug,
    });

    if (!layout) return htmlView;

    const pathLayout = join(config.dirLayouts, layout);
    const templateLayout = bacaFile(pathLayout);

    return render(templateLayout, data, {
      dirViews: config.dirViews,
      bacaFile,
      maxDepth: config.maxIncludeDepth,
      debug: config.debug,
      contents: htmlView, // konten yang di-inject ke <contents>
    });
  }

  /**
   * Render string template langsung tanpa baca file.
   * Berguna untuk template dari database atau email.
   *
   * @param {string} template
   * @param {Record<string, unknown>} [data={}]
   * @returns {string}
   */
  function renderString(template, data = {}) {
    return render(template, data, {
      dirViews: config.dirViews,
      bacaFile,
      maxDepth: config.maxIncludeDepth,
      debug: config.debug,
    });
  }

  /**
   * Render async — data bisa berupa Promise.
   * Berguna saat data fetching dan rendering terjadi bersamaan.
   *
   * @param {string} namaView
   * @param {Record<string, unknown> | Promise<Record<string, unknown>>} [data={}]
   * @param {string|null} [layout=null]
   * @returns {Promise<string>}
   */
  async function renderAsync(namaView, data = {}, layout = null) {
    const dataResolved = await data;
    return rendang(namaView, dataResolved, layout);
  }

  return {
    // --- Render Methods ---
    render: rendang,
    renderString,
    renderAsync,

    // --- Cache Management ---
    /** Hapus semua cache. */
    kosongkanCache() { fileCache.clear(); },

    /** Hapus cache untuk satu file. */
    hapusCache(namaView) {
      const absolute = join(config.dirViews, namaView);
      fileCache.delete(absolute);
    },

    /**
     * Info cache saat ini.
     * @returns {{ jumlah: number, max: number }}
     */
    get infoCache() {
      return { jumlah: fileCache.size, max: fileCache.maxSize };
    },
  };
}
```

### 4.3 Error Class

**File:** `packages/template-engine/src/errors.js`

```js
/**
 * @typedef {Object} TemplateErrorOptions
 * @property {string}   [file]           - Path absolut file template yang error.
 * @property {number}   [line]           - Nomor baris (1-based) lokasi error.
 * @property {string[]} [variabelTersedia] - Daftar key yang tersedia di data context.
 * @property {Error}    [cause]          - Error original (untuk error chaining).
 */

export class TemplateError extends Error {
  /** @type {string | undefined} */ file;
  /** @type {number | undefined} */ line;
  /** @type {string[] | undefined} */ variabelTersedia;

  /**
   * @param {string} message
   * @param {TemplateErrorOptions} [options={}]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'TemplateError';
    this.file = options.file;
    this.line = options.line;
    this.variabelTersedia = options.variabelTersedia;
  }

  /** Representasi string yang informatif untuk log. */
  toString() {
    const parts = [`TemplateError: ${this.message}`];
    if (this.file) parts.push(`  di: ${this.file}${this.line ? ` (baris ${this.line})` : ''}`);
    if (this.variabelTersedia?.length) {
      parts.push(`  data tersedia: [${this.variabelTersedia.map(v => `'${v}'`).join(', ')}]`);
    }
    return parts.join('\n');
  }
}
```

### 4.4 Parser — Fix Operator `>` di `<if>`

Masalah inti: parser sebelumnya split kondisi pada karakter `>` yang merupakan penutup tag HTML.
Solusinya adalah tokenizer berbasis state machine — baca karakter per karakter, track apakah
kita di dalam attribute, di dalam kondisi, atau di antara tag.

**File:** `packages/template-engine/src/parser.js`

Pola yang wajib diimplementasikan untuk `<if>`:

```js
/**
 * Parse kondisi dari tag <if kondisi="..."> dengan benar.
 * Kondisi ada di dalam atribut — bukan di antara `<` dan `>`.
 *
 * Format: <if kondisi="variabel > 10">
 * Regex: ambil nilai dari atribut `kondisi`
 */
function parseTagIf(tagString) {
  // Ambil konten atribut kondisi — aman karena kita parse atribut, bukan tag boundary
  const match = tagString.match(/kondisi=["']([^"']+)["']/);
  if (!match) {
    throw new TemplateError(`Tag <if> tidak memiliki atribut kondisi yang valid: ${tagString}`);
  }
  return match[1].trim(); // string kondisi mentah, mis: "jumlah > 10"
}

/**
 * Evaluasi kondisi dengan context data.
 * PENTING: gunakan new Function dengan scope terbatas — jangan eval() global.
 *
 * @param {string} kondisiStr  - mis: "pengguna.aktif && skor >= 100"
 * @param {Record<string, unknown>} data
 * @returns {boolean}
 */
function evaluasiKondisi(kondisiStr, data) {
  try {
    // Buat fungsi dengan semua key data sebagai parameter — tidak ada akses global
    const keys = Object.keys(data);
    const values = Object.values(data);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return Boolean(${kondisiStr});`);
    return fn(...values);
  } catch (err) {
    throw new TemplateError(
      `Kondisi tidak valid: "${kondisiStr}". ${err.message}`,
      { variabelTersedia: Object.keys(data) }
    );
  }
}
```

**Catatan implementasi:** operator `>`, `>=`, `<`, `<=`, `===`, `!==`, `&&`, `||`, `!` semua
bekerja karena kondisi ada di dalam nilai atribut HTML (`kondisi="..."`), bukan di antara
delimiter tag `<` dan `>`. Jangan parse dengan split/regex pada konten di luar atribut.

### 4.5 Contoh Penggunaan (Consumer Code — Tidak Berubah dari v1)

```js
import { buatEngine } from '@wanuky10/template-engine';

const engine = buatEngine({
  dirViews: new URL('frontend/views', import.meta.url).pathname,
  dirLayouts: new URL('frontend/views/layouts', import.meta.url).pathname,
  cache: process.env.NODE_ENV !== 'development',
  cacheMaxSize: 300,
});

// Sinkron (sama seperti v1)
const html = engine.render('pages/artikel.html', { judul, konten }, 'utama.html');

// BARU: async dengan data Promise
const htmlAsync = await engine.renderAsync(
  'pages/artikel.html',
  Model.cariArtikel(id),  // Promise<{ judul, konten }>
  'utama.html'
);

// BARU: info cache (sebelumnya hanya ukuranCache: number)
console.log(engine.infoCache); // { jumlah: 12, max: 300 }
```

---

## 5. web-editor / RichTextEditor: API v2

### 5.1 Options Schema (Lengkap)

```js
/**
 * @typedef {Object} RTEOptions
 * @property {string}   [nilaiAwal='']          - Konten HTML awal.
 * @property {'minimal'|'standard'|'full'|string[]} [toolbar='standard']
 * @property {number}   [maxLength=0]           - Batas karakter PLAIN TEXT. 0 = tanpa batas.
 * @property {boolean}  [readonly=false]
 * @property {SanitasiOptions} [sanitasi]       - Konfigurasi sanitasi output.
 * @property {PasteOptions}    [paste]           - Konfigurasi paste handler.
 * @property {number}   [maxHistori=100]        - Maks langkah undo. 0 = tidak terbatas.
 * @property {number}   [debounceUbah=300]      - Delay ms sebelum onUbah dipanggil.
 * @property {function} [onUbah]                - ({ html, teks, panjang }) => void
 * @property {function} [onFokus]               - () => void
 * @property {function} [onBlur]                - () => void
 * @property {function} [onLimitTercapai]       - ({ panjang, maks }) => void — dipanggil saat maxLength terlampaui
 * @property {function} [onUndoRedo]            - ({ bisaUndo, bisaRedo }) => void — saat state history berubah
 *
 * @typedef {Object} SanitasiOptions
 * @property {boolean}  [aktif=true]
 * @property {string[]} [tagDiizinkan]          - Default: tag standar RTE
 * @property {string[]} [atributDiizinkan]      - Default: ['href','src','alt','target','rel']
 * @property {boolean}  [paksakanHttps=true]    - Blokir http:// dan data: di href/src
 *
 * @typedef {Object} PasteOptions
 * @property {boolean}  [aktif=true]
 * @property {'strip'|'plain'} [mode='strip']  - strip: hapus style/attr berbahaya
 *                                                plain: ambil teks polos saja
 */
```

### 5.2 Public API — Method & Property

```js
class RichTextEditor {
  // ==========================================
  // LIFECYCLE
  // ==========================================

  /**
   * @param {string|HTMLElement} selectorAtauElemen
   * @param {RTEOptions} [options={}]
   */
  constructor(selectorAtauElemen, options = {}) {}

  /** Hapus event listeners, cleanup DOM yang ditambahkan library. */
  hancurkan() {}

  // ==========================================
  // DATA
  // ==========================================

  /**
   * Ambil nilai editor.
   * html: sudah disanitasi sesuai SanitasiOptions.
   * teks: plain text tanpa markup.
   * panjang: jumlah karakter teks (yang dibandingkan dengan maxLength).
   *
   * @returns {{ html: string, teks: string, panjang: number }}
   */
  getNilai() {}

  /**
   * Set konten editor secara programatik.
   * @param {string} html - HTML yang akan diset. Akan disanitasi sebelum diset.
   */
  setNilai(html) {}

  /** Kosongkan seluruh konten editor. */
  kosongkan() {}

  // ==========================================
  // FORMAT — menggantikan execCommand
  // ==========================================

  /**
   * Terapkan format ke teks yang sedang dipilih.
   * Jika format sudah aktif → toggle off.
   *
   * @param {'bold'|'italic'|'underline'|'strikethrough'|'code'} format
   */
  formatTeks(format) {}

  /**
   * Set block type teks yang sedang dipilih.
   *
   * @param {'p'|'h1'|'h2'|'h3'|'blockquote'|'pre'} tipe
   */
  setBlok(tipe) {}

  /**
   * Insert list di posisi cursor.
   * @param {'ul'|'ol'} tipe
   */
  insertList(tipe) {}

  /**
   * Insert link. Jika ada teks yang dipilih, teks itu menjadi label link.
   * @param {string} url
   * @param {string} [label] - Jika tidak diisi dan tidak ada selection, url digunakan sebagai label.
   */
  insertLink(url, label) {}

  /**
   * Insert gambar dari URL.
   * @param {string} url   - Harus HTTPS. Jika http:// atau data:, diblokir dan error dilempar.
   * @param {string} [alt]
   * @throws {EditorError} jika URL tidak valid atau tidak HTTPS.
   */
  insertGambar(url, alt) {}

  /** Hapus semua formatting dari teks yang dipilih. */
  hapusFormat() {}

  // ==========================================
  // HISTORY (undo/redo)
  // ==========================================

  undo() {}
  redo() {}

  /** @returns {boolean} */
  get bisaUndo() {}

  /** @returns {boolean} */
  get bisaRedo() {}

  // ==========================================
  // STATE
  // ==========================================

  /** @param {boolean} aktif */
  setReadonly(aktif) {}

  fokus() {}

  /** @returns {boolean} */
  get readonly() {}
}
```

### 5.3 Sanitizer — Implementasi Tanpa Dependensi Eksternal

Jangan tambahkan DOMPurify sebagai dependensi — browser sudah punya DOM parser.
Implementasi ini berjalan di browser environment.

**File:** `packages/web-editor/src/sanitizer.js`

```js
/** Tag yang diizinkan secara default untuk output RTE */
const TAG_DEFAULT = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
  'h1', 'h2', 'h3', 'ul', 'ol', 'li',
  'blockquote', 'code', 'pre', 'a', 'img',
]);

/** Atribut yang diizinkan per tag */
const ATRIBUT_AMAN = {
  a:   new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  '*': new Set([]), // tidak ada atribut global yang diizinkan
};

/** Protokol URL yang aman */
const PROTOKOL_AMAN = /^(https?:|mailto:|tel:)/i;

/**
 * Sanitasi HTML string.
 * Menggunakan DOM parser browser — tidak bisa dipakai di Node.js.
 *
 * @param {string} html
 * @param {SanitasiOptions} [opts={}]
 * @returns {string}
 */
export function sanitasi(html, opts = {}) {
  const tagDiizinkan = opts.tagDiizinkan
    ? new Set(opts.tagDiizinkan.map(t => t.toLowerCase()))
    : TAG_DEFAULT;

  const paksakanHttps = opts.paksakanHttps ?? true;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

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
      const atribSah = ATRIBUT_AMAN[tagName] ?? ATRIBUT_AMAN['*'];
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
```

### 5.4 FormatManager — Selection API (Pengganti execCommand)

**File:** `packages/web-editor/src/format-manager.js`

```js
import { EditorError } from './errors.js';

/**
 * Kelola operasi format teks dan undo/redo history.
 * Beroperasi langsung pada contenteditable element via Selection API.
 */
export class FormatManager {
  #editArea;
  #history = [];
  #historyIndex = -1;
  #maxHistori;
  #onUndoRedo;

  /**
   * @param {HTMLElement} editArea         - Elemen contenteditable
   * @param {number}      [maxHistori=100]
   * @param {Function}    [onUndoRedo]
   */
  constructor(editArea, maxHistori = 100, onUndoRedo = null) {
    this.#editArea = editArea;
    this.#maxHistori = maxHistori;
    this.#onUndoRedo = onUndoRedo;
  }

  // ==========================================
  // SNAPSHOT (Undo/Redo)
  // ==========================================

  /**
   * Simpan state sekarang ke history.
   * Panggil ini SEBELUM setiap operasi yang mengubah konten.
   */
  snapshot() {
    const state = {
      html: this.#editArea.innerHTML,
      // Serialize selection sebagai path dari root editArea
      selection: this.#serializeSelection(),
    };

    // Hapus history setelah posisi sekarang (invalidasi redo)
    this.#history = this.#history.slice(0, this.#historyIndex + 1);
    this.#history.push(state);

    // Batasi ukuran history
    if (this.#maxHistori > 0 && this.#history.length > this.#maxHistori) {
      this.#history.shift();
    } else {
      this.#historyIndex++;
    }

    this.#emitUndoRedo();
  }

  undo() {
    if (!this.bisaUndo) return;
    this.#historyIndex--;
    const state = this.#history[this.#historyIndex];
    this.#editArea.innerHTML = state.html;
    this.#restoreSelection(state.selection);
    this.#emitUndoRedo();
  }

  redo() {
    if (!this.bisaRedo) return;
    this.#historyIndex++;
    const state = this.#history[this.#historyIndex];
    this.#editArea.innerHTML = state.html;
    this.#restoreSelection(state.selection);
    this.#emitUndoRedo();
  }

  get bisaUndo() { return this.#historyIndex > 0; }
  get bisaRedo() { return this.#historyIndex < this.#history.length - 1; }

  #emitUndoRedo() {
    this.#onUndoRedo?.({ bisaUndo: this.bisaUndo, bisaRedo: this.bisaRedo });
  }

  // ==========================================
  // FORMAT INLINE
  // ==========================================

  /**
   * Toggle format inline. Jika selection sudah bold, remove. Jika belum, wrap.
   * @param {'strong'|'em'|'u'|'del'|'code'} tagName
   */
  toggleInline(tagName) {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;

    this.snapshot();
    const range = selection.getRangeAt(0);

    const existing = this.#cariAncestor(range.commonAncestorContainer, tagName.toUpperCase());

    if (existing) {
      // Unwrap: ganti elemen dengan children-nya
      const frag = document.createDocumentFragment();
      while (existing.firstChild) frag.appendChild(existing.firstChild);
      existing.replaceWith(frag);
    } else {
      try {
        const el = document.createElement(tagName);
        range.surroundContents(el);
      } catch {
        // Fallback jika selection melintasi boundary tag (partial overlap)
        const frag = range.extractContents();
        const el = document.createElement(tagName);
        el.appendChild(frag);
        range.insertNode(el);
        // Normalisasi selection
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(el);
        selection.addRange(newRange);
      }
    }
  }

  // ==========================================
  // FORMAT BLOK
  // ==========================================

  /**
   * Ubah block element di posisi cursor.
   * @param {'p'|'h1'|'h2'|'h3'|'blockquote'|'pre'} tagBaru
   */
  setBlok(tagBaru) {
    const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                               'BLOCKQUOTE', 'PRE', 'DIV', 'LI']);
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    this.snapshot();
    const range = selection.getRangeAt(0);
    const blockSekarang = this.#cariAncestorDenganSet(
      range.commonAncestorContainer,
      blockTags,
      this.#editArea
    );

    if (!blockSekarang) return;

    // Ganti tag sambil pertahankan children
    const elBaru = document.createElement(tagBaru);
    while (blockSekarang.firstChild) elBaru.appendChild(blockSekarang.firstChild);
    blockSekarang.replaceWith(elBaru);

    // Restore focus ke elemen baru
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(elBaru);
    newRange.collapse(false); // collapse ke akhir
    selection.addRange(newRange);
  }

  // ==========================================
  // LINK & GAMBAR
  // ==========================================

  /**
   * @param {string} url
   * @param {string} [label]
   */
  insertLink(url, label) {
    this.#validasiUrl(url);
    this.snapshot();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    if (!selection.isCollapsed) {
      // Wrap selection yang ada
      try {
        a.appendChild(range.extractContents());
      } catch {
        a.textContent = label ?? url;
      }
    } else {
      a.textContent = label ?? url;
    }

    range.insertNode(a);

    // Pindahkan cursor setelah link
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(a);
    newRange.collapse(true);
    selection.addRange(newRange);
  }

  /**
   * @param {string} url
   * @param {string} [alt='']
   * @throws {EditorError} jika URL tidak HTTPS
   */
  insertGambar(url, alt = '') {
    this.#validasiUrl(url);
    this.snapshot();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt;
    range.insertNode(img);
  }

  /** Hapus semua inline formatting dari selection. */
  hapusFormat() {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;

    this.snapshot();
    const range = selection.getRangeAt(0);
    const teks = range.toString();
    const textNode = document.createTextNode(teks);
    range.deleteContents();
    range.insertNode(textNode);
  }

  // ==========================================
  // PASTE HANDLER
  // ==========================================

  /**
   * Handle paste event — strip vendor markup.
   * @param {ClipboardEvent} e
   * @param {'strip'|'plain'} mode
   */
  handlePaste(e, mode = 'strip') {
    e.preventDefault();
    this.snapshot();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    let konten;

    if (mode === 'plain') {
      konten = document.createTextNode(e.clipboardData.getData('text/plain'));
    } else {
      const html = e.clipboardData.getData('text/html');
      if (html) {
        // Strip semua style, class, id, dan atribut berbahaya
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        this.#stripVendorMarkup(doc.body);
        const frag = document.createDocumentFragment();
        while (doc.body.firstChild) frag.appendChild(doc.body.firstChild);
        konten = frag;
      } else {
        // Fallback ke plain text
        const teks = e.clipboardData.getData('text/plain');
        // Ubah newline ke <br> atau <p>
        konten = document.createDocumentFragment();
        const paragraf = teks.split(/\n\n+/);
        for (const par of paragraf) {
          const p = document.createElement('p');
          p.textContent = par.trim();
          if (p.textContent) konten.appendChild(p);
        }
      }
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(konten);
    selection.collapseToEnd();
  }

  // ==========================================
  // PRIVATE HELPERS
  // ==========================================

  #cariAncestor(node, tagName) {
    let current = node;
    while (current && current !== this.#editArea) {
      if (current.nodeName === tagName.toUpperCase()) return current;
      current = current.parentNode;
    }
    return null;
  }

  #cariAncestorDenganSet(node, tagSet, batas) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (current && current !== batas) {
      if (tagSet.has(current.nodeName)) return current;
      current = current.parentNode;
    }
    return null;
  }

  #validasiUrl(url) {
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
        throw new EditorError(`URL tidak diizinkan: ${url}. Protokol harus https, http, mailto, atau tel.`);
      }
    } catch (e) {
      if (e instanceof EditorError) throw e;
      throw new EditorError(`URL tidak valid: ${url}`);
    }
  }

  #stripVendorMarkup(el) {
    // Hapus atribut style, class, id dari semua elemen
    const ATRIBUT_HAPUS = ['style', 'class', 'id', 'lang', 'xmlns', 'data-mce-style'];
    for (const child of el.querySelectorAll('*')) {
      for (const attr of ATRIBUT_HAPUS) child.removeAttribute(attr);
      // Hapus semua event handlers
      for (const attr of [...child.attributes]) {
        if (attr.name.startsWith('on')) child.removeAttribute(attr.name);
      }
    }
    // Hapus elemen vendor Word (o:p, w:..., etc.)
    for (const el of [...el.querySelectorAll('[class*="Mso"], o\\:p, w\\:wrap')]) {
      el.replaceWith(...el.childNodes);
    }
  }

  #serializeSelection() {
    // Simplified — untuk undo/redo basic, hanya simpan offset
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return {
      anchorOffset: sel.anchorOffset,
      focusOffset: sel.focusOffset,
    };
  }

  #restoreSelection(state) {
    if (!state) return;
    // Best-effort restore — position mungkin sudah tidak valid setelah innerHTML overwrite
    // Full restore butuh node path serialization yang lebih kompleks
  }
}
```

### 5.5 Error Class

**File:** `packages/web-editor/src/errors.js`

```js
export class EditorError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'EditorError';
  }
}
```

### 5.6 Contoh Penggunaan di Consumer Code

```js
import { RichTextEditor } from '@wanuky10/web-editor';

const editor = new RichTextEditor('#editor-artikel', {
  toolbar: 'standard',
  maxLength: 5000,  // karakter PLAIN TEXT — bukan karakter HTML
  sanitasi: {
    aktif: true,
    paksakanHttps: true,
    // tagDiizinkan: [...] // opsional, override default
  },
  paste: {
    aktif: true,
    mode: 'strip', // atau 'plain' untuk stripping agresif
  },
  maxHistori: 100,
  onUbah: ({ html, teks, panjang }) => {
    // html sudah disanitasi
    // panjang = teks.length, untuk bandingkan dengan maxLength
    btnSubmit.disabled = panjang === 0;
  },
  onLimitTercapai: ({ panjang, maks }) => {
    tampilkanToast(`Maksimum ${maks} karakter`, 'warning');
  },
  onUndoRedo: ({ bisaUndo, bisaRedo }) => {
    btnUndo.disabled = !bisaUndo;
    btnRedo.disabled = !bisaRedo;
  },
});

// Di controller — html dari getNilai() sudah aman, tapi tetap sanitasi di server
const { html, teks, panjang } = editor.getNilai();
await buatArtikel({ kontenHtml: html, ringkasan: teks.slice(0, 160) });
```

---

## 6. web-editor / ImageEditor: API v2

### 6.1 Options Schema (Lengkap)

```js
/**
 * @typedef {Object} ImageEditorOptions
 * @property {number} [ukuranMaks=2048]        - Panjang sisi terpanjang output (px). 0 = original.
 * @property {'image/jpeg'|'image/png'|'image/webp'} [formatOutput='image/webp']
 * @property {number}   [kualitasOutput=0.85]  - 0.0–1.0, untuk jpeg/webp.
 * @property {boolean}  [autoExif=true]        - Auto-koreksi orientasi EXIF.
 * @property {boolean}  [dragDrop=true]        - Aktifkan drag-and-drop file ke canvas.
 * @property {boolean}  [pasteClipboard=true]  - Aktifkan Ctrl+V gambar dari clipboard.
 * @property {CropOptions}    [crop]
 * @property {function} [onMuat]               - ({ lebar, tinggi, ukuranFile }) => void
 * @property {function} [onFilter]             - ({ brightness, contrast }) => void
 * @property {function} [onError]              - (EditorError) => void
 *
 * @typedef {Object} CropOptions
 * @property {number|null} [rasio=null]        - Aspect ratio. null = bebas. 1/1 = square. 16/9 = landscape.
 * @property {number}      [minLebar=50]       - Minimum crop width (px).
 * @property {number}      [minTinggi=50]      - Minimum crop height (px).
 */
```

### 6.2 Public API — Method & Property

```js
class ImageEditor {
  // ==========================================
  // LIFECYCLE
  // ==========================================

  /**
   * @param {string|HTMLElement} selectorAtauElemen
   * @param {ImageEditorOptions} [options={}]
   */
  constructor(selectorAtauElemen, options = {}) {}

  hancurkan() {}

  // ==========================================
  // LOAD
  // ==========================================

  /**
   * Muat file gambar ke editor.
   * Otomatis koreksi EXIF jika options.autoExif = true.
   *
   * @param {File} file
   * @returns {Promise<void>}
   * @throws {EditorError} jika file bukan gambar atau terlalu besar.
   */
  async muatFile(file) {}

  /**
   * Muat dari URL (harus HTTPS).
   * @param {string} url
   * @returns {Promise<void>}
   */
  async muatUrl(url) {}

  // ==========================================
  // TRANSFORM — semua non-destructive (re-render dari imgAsli)
  // ==========================================

  /** @param {'kiri'|'kanan'} arah */
  rotasi(arah) {}

  /** @param {'h'|'v'} sumbu */
  flip(sumbu) {}

  /** @param {number} faktor - Mis: 1.2 untuk zoom in 20% */
  zoom(faktor) {}

  zoomReset() {}

  /**
   * Set brightness. Non-destructive — gunakan CSS filter, bukan pixel manipulation.
   * @param {number} nilai - 0–200. 100 = normal. 0 = hitam. 200 = dua kali terang.
   */
  setBrightness(nilai) {}

  /**
   * Set contrast. Non-destructive.
   * @param {number} nilai - 0–200. 100 = normal.
   */
  setContrast(nilai) {}

  /** Reset semua filter (brightness, contrast) ke nilai default. */
  resetFilter() {}

  // ==========================================
  // CROP
  // ==========================================

  /**
   * Aktifkan mode crop.
   * Menampilkan overlay crop dengan 8 resize handle.
   */
  mulaiCrop() {}

  /**
   * Terapkan crop saat ini.
   * @returns {{ x, y, lebar, tinggi }} koordinat crop dalam piksel gambar asli.
   */
  terapkanCrop() {}

  /** Batalkan mode crop tanpa menerapkan. */
  batalCrop() {}

  // ==========================================
  // SAVE — ASYNC
  // ==========================================

  /**
   * Simpan hasil editing sebagai Blob.
   * Terapkan semua transform dan filter ke output final.
   * Resize ke ukuranMaks jika gambar melebihi batas.
   *
   * @returns {Promise<Blob>}   — Gunakan Blob untuk upload ke server, lebih efisien dari data URL.
   */
  async simpan() {}

  /**
   * Ambil data URL (base64).
   * Gunakan Blob + URL.createObjectURL() jika memungkinkan — lebih efisien.
   *
   * @returns {Promise<string>}
   */
  async getDataUrl() {}

  /**
   * Ambil File object dari hasil editing.
   * @param {string} [namaFile='edited-image']
   * @returns {Promise<File>}
   */
  async getFile(namaFile = 'edited-image') {}

  // ==========================================
  // STATE
  // ==========================================

  /** Reset ke gambar asli yang dimuat. */
  reset() {}

  /** @returns {boolean} apakah gambar sudah dimuat */
  get sudahMuat() {}

  /**
   * Info dimensi gambar yang sedang diedit.
   * @returns {{ lebar: number, tinggi: number } | null}
   */
  get dimensi() {}
}
```

### 6.3 EXIF Reader — Tanpa Dependensi Eksternal

**File:** `packages/web-editor/src/exif-reader.js`

```js
/**
 * Baca orientasi EXIF dari File JPEG.
 * Hanya baca minimal byte yang dibutuhkan — tidak parse seluruh file.
 *
 * Nilai orientasi EXIF:
 * 1 = normal, 3 = 180°, 6 = 90° CW, 8 = 90° CCW
 * 2, 4, 5, 7 = mirror variants (jarang di foto kamera biasa)
 *
 * @param {File|Blob} file
 * @returns {Promise<1|2|3|4|5|6|7|8>} - Default 1 jika tidak ada EXIF atau bukan JPEG.
 */
export async function bacaOrientasiExif(file) {
  // Baca 64KB pertama — cukup untuk EXIF header di hampir semua kamera
  const buffer = await file.slice(0, 65536).arrayBuffer();
  const view = new DataView(buffer);

  // Validasi JPEG SOI marker
  if (view.getUint16(0, false) !== 0xFFD8) return 1;

  let offset = 2;

  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    // APP1 marker = 0xFFE1 (EXIF ada di sini)
    if (marker === 0xFFE1) {
      // Pastikan ada 'Exif\0\0' header
      const exifHeader = view.getUint32(offset + 2, false);
      if (exifHeader !== 0x45786966) return 1; // bukan 'Exif'

      const tiffOffset = offset + 8; // skip 'Exif\0\0'

      // Deteksi byte order
      const byteOrder = view.getUint16(tiffOffset, false);
      const littleEndian = byteOrder === 0x4949; // 'II' = little endian

      // Offset ke IFD0 dari awal TIFF header
      const ifd0Offset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);

      // Jumlah entry di IFD0
      const jumlahEntry = view.getUint16(ifd0Offset, littleEndian);

      for (let i = 0; i < jumlahEntry; i++) {
        const entryOffset = ifd0Offset + 2 + (i * 12);
        const tag = view.getUint16(entryOffset, littleEndian);

        // Tag 0x0112 = Orientation
        if (tag === 0x0112) {
          const orientasi = view.getUint16(entryOffset + 8, littleEndian);
          return (orientasi >= 1 && orientasi <= 8) ? orientasi : 1;
        }
      }
    } else if ((marker & 0xFF00) !== 0xFF00) {
      break; // bukan marker yang valid, stop
    }

    // Skip ke marker berikutnya
    if (offset + 2 > view.byteLength) break;
    offset += view.getUint16(offset, false);
  }

  return 1; // tidak ada EXIF orientation
}

/**
 * Hitung rotation angle dan flip dari nilai orientasi EXIF.
 * @param {number} orientasi
 * @returns {{ rotate: number, flipH: boolean, flipV: boolean }}
 */
export function orientasiKeTransform(orientasi) {
  const map = {
    1: { rotate: 0,   flipH: false, flipV: false },
    2: { rotate: 0,   flipH: true,  flipV: false },
    3: { rotate: 180, flipH: false, flipV: false },
    4: { rotate: 0,   flipH: false, flipV: true  },
    5: { rotate: 90,  flipH: true,  flipV: false },
    6: { rotate: 90,  flipH: false, flipV: false },
    7: { rotate: 270, flipH: true,  flipV: false },
    8: { rotate: 270, flipH: false, flipV: false },
  };
  return map[orientasi] ?? map[1];
}
```

### 6.4 Render Loop — CSS Filter + OffscreenCanvas

Pattern inti untuk ImageEditor. Ini yang menggantikan pixel manipulation.

```js
// Di dalam class ImageEditor

#state = {
  brightness: 100,
  contrast: 100,
  rotate: 0,       // derajat: 0, 90, 180, 270
  flipH: false,
  flipV: false,
  zoomLevel: 1,
  panX: 0,
  panY: 0,
  cropAktif: false,
  cropRect: null,  // { x, y, lebar, tinggi } dalam koordinat canvas
};

#imgAsli = null;   // HTMLImageElement — TIDAK PERNAH dimodifikasi
#canvas = null;
#ctx = null;

/**
 * Re-render canvas dari imgAsli + state saat ini.
 * Dipanggil setiap kali state berubah.
 * TIDAK melakukan pixel manipulation — hanya transform + CSS filter.
 */
#render() {
  if (!this.#imgAsli) return;

  const { lebar, tinggi } = this.#hitungDimensiCanvas();
  this.#canvas.width = lebar;
  this.#canvas.height = tinggi;

  const ctx = this.#ctx;
  ctx.save();
  ctx.clearRect(0, 0, lebar, tinggi);

  // Apply zoom dan pan
  ctx.translate(this.#state.panX, this.#state.panY);
  ctx.scale(this.#state.zoomLevel, this.#state.zoomLevel);

  // Apply rotation di tengah canvas
  ctx.translate(lebar / 2, tinggi / 2);
  ctx.rotate((this.#state.rotate * Math.PI) / 180);

  // Apply flip
  ctx.scale(
    this.#state.flipH ? -1 : 1,
    this.#state.flipV ? -1 : 1
  );

  // Apply CSS filter — GPU-accelerated, tidak block main thread
  ctx.filter = [
    `brightness(${this.#state.brightness}%)`,
    `contrast(${this.#state.contrast}%)`,
  ].join(' ');

  // Draw gambar asli — BUKAN pixel data yang sudah dimanipulasi
  ctx.drawImage(
    this.#imgAsli,
    -this.#imgAsli.naturalWidth / 2,
    -this.#imgAsli.naturalHeight / 2
  );

  ctx.restore();

  // Gambar crop overlay di atas (tanpa filter)
  if (this.#state.cropAktif && this.#state.cropRect) {
    this.#renderCropOverlay();
  }
}

/**
 * Simpan output final ke Blob via OffscreenCanvas.
 * Tidak block UI thread.
 *
 * @returns {Promise<Blob>}
 */
async #renderKeFinal() {
  const img = this.#imgAsli;

  // Hitung dimensi output setelah crop
  const cropSrc = this.#state.cropRect
    ? this.#cropCanvasKeGambar(this.#state.cropRect)
    : { x: 0, y: 0, lebar: img.naturalWidth, tinggi: img.naturalHeight };

  // Hitung dimensi final setelah resize ke ukuranMaks
  const { lebar: finalW, tinggi: finalH } = this.#hitungDimensiOutput(
    cropSrc.lebar,
    cropSrc.tinggi
  );

  const offscreen = new OffscreenCanvas(finalW, finalH);
  const ctx = offscreen.getContext('2d');

  // Apply transform
  ctx.translate(finalW / 2, finalH / 2);
  ctx.rotate((this.#state.rotate * Math.PI) / 180);
  ctx.scale(
    this.#state.flipH ? -1 : 1,
    this.#state.flipV ? -1 : 1
  );

  // Apply filter
  ctx.filter = [
    `brightness(${this.#state.brightness}%)`,
    `contrast(${this.#state.contrast}%)`,
  ].join(' ');

  // Draw hanya area crop dari gambar asli
  ctx.drawImage(
    img,
    cropSrc.x, cropSrc.y,         // source x, y
    cropSrc.lebar, cropSrc.tinggi, // source w, h
    -finalW / 2, -finalH / 2,      // dest x, y
    finalW, finalH                 // dest w, h
  );

  return offscreen.convertToBlob({
    type: this.#options.formatOutput,
    quality: this.#options.kualitasOutput,
  });
}

/**
 * Hitung dimensi output dengan constraint ukuranMaks.
 */
#hitungDimensiOutput(lebar, tinggi) {
  const maks = this.#options.ukuranMaks;
  if (!maks || (lebar <= maks && tinggi <= maks)) return { lebar, tinggi };

  const rasio = Math.min(maks / lebar, maks / tinggi);
  return {
    lebar: Math.round(lebar * rasio),
    tinggi: Math.round(tinggi * rasio),
  };
}
```

### 6.5 Pointer Events — Touch + Mouse Unified

```js
// Pasang di constructor setelah canvas dibuat

#pasangPointerEvents() {
  const canvas = this.#canvas;

  // Gunakan Pointer Events API — unified mouse, touch, pen
  canvas.addEventListener('pointerdown', this.#onPointerDown.bind(this));
  canvas.addEventListener('pointermove', this.#onPointerMove.bind(this));
  canvas.addEventListener('pointerup',   this.#onPointerUp.bind(this));
  canvas.addEventListener('pointercancel', this.#onPointerUp.bind(this));

  // Scroll zoom (desktop)
  canvas.addEventListener('wheel', this.#onWheel.bind(this), { passive: false });

  // Pinch zoom (touch)
  let touchAwal = null;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      touchAwal = {
        jarak: Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        ),
        zoomAwal: this.#state.zoomLevel,
      };
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && touchAwal) {
      e.preventDefault(); // cegah scroll halaman
      const jarakBaru = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const delta = jarakBaru / touchAwal.jarak;
      this.#state.zoomLevel = Math.max(0.1, Math.min(5, touchAwal.zoomAwal * delta));
      this.#render();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', () => { touchAwal = null; });
}

#dragState = null;

#onPointerDown(e) {
  canvas.setPointerCapture(e.pointerId);

  if (this.#state.cropAktif) {
    const handle = this.#hitTestCropHandle(e.offsetX, e.offsetY);
    if (handle) {
      this.#dragState = { mode: 'crop-resize', handle, startX: e.offsetX, startY: e.offsetY, rectAwal: { ...this.#state.cropRect } };
      return;
    }
    if (this.#hitTestCropArea(e.offsetX, e.offsetY)) {
      this.#dragState = { mode: 'crop-move', startX: e.offsetX, startY: e.offsetY, rectAwal: { ...this.#state.cropRect } };
      return;
    }
    // Klik di luar crop area = mulai crop baru
    this.#dragState = { mode: 'crop-new', startX: e.offsetX, startY: e.offsetY };
  } else {
    // Mode pan
    this.#dragState = { mode: 'pan', startX: e.offsetX - this.#state.panX, startY: e.offsetY - this.#state.panY };
  }
}

#onPointerMove(e) {
  if (!this.#dragState) return;
  const { mode } = this.#dragState;

  if (mode === 'pan') {
    this.#state.panX = e.offsetX - this.#dragState.startX;
    this.#state.panY = e.offsetY - this.#dragState.startY;
    this.#render();
  } else if (mode === 'crop-resize') {
    this.#updateCropResize(e.offsetX, e.offsetY);
    this.#render();
  } else if (mode === 'crop-move') {
    this.#updateCropMove(e.offsetX, e.offsetY);
    this.#render();
  } else if (mode === 'crop-new') {
    this.#updateCropNew(e.offsetX, e.offsetY);
    this.#render();
  }
}

#onPointerUp(e) {
  this.#dragState = null;
  this.#canvas.releasePointerCapture(e.pointerId);
}

/**
 * Resize crop dengan aspect ratio lock jika dikonfigurasi.
 */
#updateCropResize(x, y) {
  const { handle, rectAwal } = this.#dragState;
  let { x: cx, y: cy, lebar, tinggi } = rectAwal;
  const rasio = this.#options.crop?.rasio ?? null;

  const dx = x - this.#dragState.startX;
  const dy = y - this.#dragState.startY;

  // Update dimensi berdasarkan handle yang digeser
  if (handle.includes('e')) lebar = Math.max(rectAwal.lebar + dx, this.#options.crop?.minLebar ?? 50);
  if (handle.includes('s')) tinggi = Math.max(rectAwal.tinggi + dy, this.#options.crop?.minTinggi ?? 50);
  if (handle.includes('w')) { cx = rectAwal.x + dx; lebar = Math.max(rectAwal.lebar - dx, 50); }
  if (handle.includes('n')) { cy = rectAwal.y + dy; tinggi = Math.max(rectAwal.tinggi - dy, 50); }

  // Lock aspect ratio
  if (rasio !== null) {
    if (handle.includes('e') || handle.includes('w')) {
      tinggi = lebar / rasio;
    } else {
      lebar = tinggi * rasio;
    }
  }

  this.#state.cropRect = { x: cx, y: cy, lebar, tinggi };
}
```

### 6.6 Drag-and-Drop & Clipboard Paste

```js
#pasangDragDrop() {
  const container = this.#container;

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    container.dataset.dragover = 'true';
  });

  container.addEventListener('dragleave', () => {
    delete container.dataset.dragover;
  });

  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    delete container.dataset.dragover;
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      await this.muatFile(file).catch(err => this.#options.onError?.(err));
    }
  });
}

#pasangClipboard() {
  // Perlu referensi ke handler agar bisa dihapus saat hancurkan()
  this.#clipboardHandler = async (e) => {
    if (!this.#canvas.closest('body')) return; // editor sudah di-destroy
    const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      await this.muatFile(item.getAsFile()).catch(err => this.#options.onError?.(err));
    }
  };
  document.addEventListener('paste', this.#clipboardHandler);
}
```

### 6.7 Contoh Penggunaan di Consumer Code

```js
import { ImageEditor } from '@wanuky10/web-editor';

const imgEditor = new ImageEditor('#image-editor', {
  ukuranMaks: 1200,
  formatOutput: 'image/webp',
  kualitasOutput: 0.85,
  autoExif: true,     // auto-koreksi foto dari smartphone
  dragDrop: true,
  pasteClipboard: true,
  crop: {
    rasio: 1 / 1,     // lock ke square untuk foto profil
    minLebar: 100,
    minTinggi: 100,
  },
  onMuat: ({ lebar, tinggi }) => {
    console.log(`Gambar dimuat: ${lebar}×${tinggi}px`);
  },
  onError: (err) => {
    tampilkanToast(err.message, 'error');
  },
});

// Input file biasa
inputFile.addEventListener('change', async (e) => {
  await imgEditor.muatFile(e.target.files[0]);
});

// Save dan upload
btnSimpan.addEventListener('click', async () => {
  const blob = await imgEditor.simpan(); // Promise<Blob>

  // Blob langsung untuk FormData — lebih efisien dari data URL
  const formData = new FormData();
  formData.append('foto', blob, 'profile.webp');
  await fetch('/api/v1/profil/foto', { method: 'POST', body: formData });
});

// Cleanup saat navigate away
window.addEventListener('beforeunload', () => imgEditor.hancurkan());
```

---

## 7. Distribusi & Versioning

### 7.1 Package JSON per Paket

```json
// packages/template-engine/package.json
{
  "name": "@wanuky10/template-engine",
  "version": "2.0.0",
  "type": "module",
  "main": "./src/index.js",
  "exports": {
    ".": "./src/index.js"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "files": ["src/"],
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "vitest run"
  }
}

// packages/web-editor/package.json
{
  "name": "@wanuky10/web-editor",
  "version": "2.0.0",
  "type": "module",
  "main": "./src/index.js",
  "exports": {
    ".": "./src/index.js"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "files": ["src/"],
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "vitest run"
  }
}
```

**Tidak ada runtime dependencies.** Semua implementasi native.

### 7.2 GitHub Actions — Auto Publish

```yaml
# .github/workflows/publish.yml
name: Publish Packages

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://npm.pkg.github.com'
          scope: '@wanuky10'

      - run: npm ci

      - run: npm test --workspaces --if-present

      - run: npm publish --workspaces
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 7.3 Changesets Config

```json
// .changeset/config.json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

**Workflow rilis:**

```bash
# 1. Setelah selesai implementasi, buat changeset
npx changeset

# 2. Pilih package yang berubah + tipe bump (major/minor/patch)
# 3. Isi deskripsi perubahan

# 4. Update CHANGELOG.md dan package.json versions
npx changeset version

# 5. Commit
git add -A && git commit -m "chore: release v2.0.0"

# 6. Tag dan push — GitHub Actions yang akan publish
git tag v2.0.0
git push origin main --tags
```

---

## 8. Checklist Implementasi

Jalankan checklist ini **setelah setiap perubahan** sebelum commit.

### template-engine

```
[ ] LRUCache: test get/set/eviction dengan size 3 dan insert 4 item
[ ] LRUCache: get existing key memindahkannya ke posisi last (most recent)
[ ] buatEngine: throw TypeError jika dirViews atau dirLayouts tidak diisi
[ ] buatEngine: infoCache return { jumlah, max } bukan number
[ ] render: kondisi <if kondisi="a > b"> bekerja tanpa error parser
[ ] render: kondisi <if kondisi="a >= b && c !== d"> bekerja
[ ] render: variable tidak ditemukan → throw TemplateError dengan variabelTersedia
[ ] render: circular include lebih dari maxIncludeDepth → throw TemplateError
[ ] renderAsync: menerima Promise sebagai data dan menunggu resolve
[ ] renderString: render string template tanpa baca file
[ ] cache: file tidak dibaca ulang dari disk pada render kedua jika cache aktif
[ ] cache: file dibaca ulang setiap kali jika cache = false
[ ] hapusCache(namaView): hanya hapus satu entri, bukan semua
[ ] TemplateError.toString() mengandung path file dan variabel tersedia
```

### web-editor / RichTextEditor

```
[ ] getNilai().html: tidak mengandung <script>, on* attribute, data: URL
[ ] getNilai().html: <a href="javascript:..."> distrip
[ ] getNilai().panjang: sama dengan getNilai().teks.length (bukan innerHTML.length)
[ ] maxLength: onLimitTercapai dipanggil saat teks melebihi batas, bukan saat sama dengan
[ ] maxLength: paste yang melebihi batas dicegah, bukan ditampilkan lalu dihapus
[ ] formatTeks('bold'): toggle — bold on → off jika dipanggil dua kali
[ ] formatTeks: selection melintasi boundary tag tidak throw uncaught error
[ ] setBlok('h2'): ubah blok P ke H2, pertahankan konten dalam
[ ] insertGambar: throw EditorError jika URL http:// atau data:
[ ] insertLink: link baru memiliki rel="noopener noreferrer" jika target="_blank"
[ ] handlePaste mode 'strip': style dan class Word dihapus
[ ] handlePaste mode 'plain': hanya teks yang masuk
[ ] undo/redo: getNilai() setelah undo mengembalikan state sebelum operasi
[ ] bisaUndo: false di state awal (belum ada operasi)
[ ] hancurkan: tidak ada event listener yang tersisa setelah dipanggil
```

### web-editor / ImageEditor

```
[ ] muatFile: foto portrait iPhone (EXIF 6) tampil tegak, bukan miring
[ ] muatFile: file bukan gambar → throw EditorError, onError dipanggil
[ ] setBrightness/setContrast: tidak memanggil getImageData/putImageData
[ ] setBrightness/setContrast: perubahan tampak real-time tanpa lag di gambar 4K
[ ] simpan(): mengembalikan Promise<Blob>
[ ] simpan(): Blob berformat sesuai formatOutput yang dikonfigurasi
[ ] simpan(): dimensi output tidak melebihi ukuranMaks pada sisi terpanjang
[ ] getDataUrl(): mengembalikan Promise<string>, bukan string synchronous
[ ] getFile(): mengembalikan Promise<File> dengan nama yang benar
[ ] crop dengan rasio 1/1: resize handle menjaga lebar = tinggi
[ ] crop dengan rasio 16/9: drag handle vertikal auto-adjust lebar
[ ] drag-and-drop: muatFile dipanggil saat file di-drop ke container
[ ] clipboard paste: muatFile dipanggil saat Ctrl+V gambar
[ ] hancurkan: document paste listener dihapus
[ ] hancurkan: tidak ada memory leak dari Image object (URL.revokeObjectURL dipanggil)
[ ] rotasi + crop + filter: semua diterapkan bersama di output final
[ ] zoom + pan: terbatas dalam batas yang wajar (tidak bisa pan tak terbatas)
```

### Distribusi

```
[ ] npm test --workspaces lulus semua tanpa error
[ ] Tag git sesuai format v{major}.{minor}.{patch}
[ ] CHANGELOG.md terupdate via changeset version
[ ] .npmrc tidak mengandung token hardcode
[ ] GitHub Actions workflow memiliki permission packages: write
[ ] Consumer project bisa install tanpa error setelah publish
```
