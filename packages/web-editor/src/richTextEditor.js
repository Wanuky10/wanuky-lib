/**
 * RichTextEditor v2.0.0 — editor teks kaya berbasis contenteditable native.
 *
 * Baru di v2.0.0:
 *   - Alignment    : rata kiri, tengah, kanan, penuh
 *   - Color picker : warna teks & sorotan via dropdown palet
 *   - Font size    : dropdown ukuran font
 *   - Table        : sisipkan tabel NxM via dialog
 *   - Paste cleanup: strip HTML kotor dari Word/Office secara otomatis
 *   - Image upload : file input + drag & drop → base64 data URL (bukan hanya URL)
 *   - Event system : on/off/emit menggantikan callback tunggal; backward-compat dijaga
 *   - Markdown     : shortcut **bold**, _italic_, ## heading, > kutipan di keydown
 *   - Word count   : hitung kata + karakter di counter
 *   - API baru     : insertHtml(), getSelectedText(), scrollKeCursor()
 *   - Tool baru    : superscript, subscript, hr, alignLeft/Center/Right/Justify
 *
 * Cara pakai:
 *   import { RichTextEditor } from '@wanuky10/web-editor';
 *
 *   const rte = new RichTextEditor('#editor', { toolbarPreset: 'full' });
 *
 *   // Event system baru (direkomendasikan):
 *   rte.on('ubah', ({ html, teks, jumlahKata }) => console.log(jumlahKata));
 *   rte.on('fokus', () => console.log('editor aktif'));
 *
 *   // Backward-compat v1.x — callback tunggal masih diterima:
 *   new RichTextEditor('#editor', { onUbah: ({ html }) => save(html) });
 */

// ─────────────────────────────────────────────────────────────
// Konstanta & konfigurasi
// ─────────────────────────────────────────────────────────────

/**
 * @adr     Tetap menggunakan document.execCommand sebagai mekanisme format utama
 * @context execCommand deprecated di spec, namun belum ada pengganti standar yang
 *          kompatibel lintas browser untuk contenteditable. Selection API + Range
 *          terlalu low-level untuk setiap format command.
 * @decision Tetap pakai execCommand; encapsulate di _eksekusiTool agar mudah diganti
 * @tradeoff Bergantung pada browser behavior; tidak bisa dikontrol penuh
 * @alternatives Selection API (ditolak: terlalu verbose per command), ProseMirror
 *               (ditolak: dependensi eksternal berat)
 */

const DEFINISI_TOOL = {
  // ── Format teks ─────────────────────────────────────────────
  bold:          { perintah: 'bold',                     ikon: 'B',    label: 'Tebal (Ctrl+B)',       tag: 'b'                    },
  italic:        { perintah: 'italic',                   ikon: 'I',    label: 'Miring (Ctrl+I)',      tag: 'i'                    },
  underline:     { perintah: 'underline',                ikon: 'U',    label: 'Garis bawah (Ctrl+U)', tag: 'u'                    },
  strikethrough: { perintah: 'strikeThrough',            ikon: 'S',    label: 'Coret',                tag: 's'                    },
  superscript:   { perintah: 'superscript',              ikon: 'x²',   label: 'Superscript',          tag: 'sup'                  },
  subscript:     { perintah: 'subscript',                ikon: 'x₂',   label: 'Subscript',            tag: 'sub'                  },

  // ── Heading & blok ──────────────────────────────────────────
  h1:            { perintah: 'formatBlock', nilai: 'h1', ikon: 'H1',   label: 'Judul 1'                                          },
  h2:            { perintah: 'formatBlock', nilai: 'h2', ikon: 'H2',   label: 'Judul 2'                                          },
  h3:            { perintah: 'formatBlock', nilai: 'h3', ikon: 'H3',   label: 'Judul 3'                                          },
  p:             { perintah: 'formatBlock', nilai: 'p',  ikon: 'P',    label: 'Paragraf'                                         },
  blockquote:    { perintah: 'blockquote',               ikon: '"',    label: 'Kutipan',              khusus: true                },
  code:          { perintah: 'formatBlock', nilai: 'pre',ikon: '</>',  label: 'Blok kode'                                        },
  hr:            { perintah: 'insertHorizontalRule',     ikon: '─',    label: 'Garis pemisah'                                    },

  // ── Daftar ──────────────────────────────────────────────────
  ul:            { perintah: 'insertUnorderedList',      ikon: '≡',    label: 'Daftar bullet'                                    },
  ol:            { perintah: 'insertOrderedList',        ikon: '1.',   label: 'Daftar nomor'                                     },

  // ── Alignment ───────────────────────────────────────────────
  alignLeft:     { perintah: 'justifyLeft',              ikon: '⬅',    label: 'Rata kiri'                                        },
  alignCenter:   { perintah: 'justifyCenter',            ikon: '↔',    label: 'Rata tengah'                                      },
  alignRight:    { perintah: 'justifyRight',             ikon: '➡',    label: 'Rata kanan'                                       },
  alignJustify:  { perintah: 'justifyFull',              ikon: '⁞',    label: 'Rata penuh'                                       },

  // ── Warna & ukuran ──────────────────────────────────────────
  foreColor:     { perintah: 'foreColor',                ikon: 'A',    label: 'Warna teks',           khusus: true, tipe: 'dropdown-warna'    },
  hiliteColor:   { perintah: 'hiliteColor',              ikon: '▌',    label: 'Warna sorotan',        khusus: true, tipe: 'dropdown-warna'    },
  fontSize:      { perintah: 'fontSize',                 ikon: 'Aa',   label: 'Ukuran font',          khusus: true, tipe: 'dropdown-ukuran'   },

  // ── Media & tautan ──────────────────────────────────────────
  link:          { perintah: 'createLink',               ikon: '🔗',   label: 'Tambah tautan',        khusus: true                },
  insertImage:   { perintah: 'insertImage',              ikon: '🖼',   label: 'Sisipkan gambar',      khusus: true                },
  table:         { perintah: 'table',                    ikon: '⊞',    label: 'Sisipkan tabel',       khusus: true                },

  // ── Utilitas ────────────────────────────────────────────────
  removeFormat:  { perintah: 'removeFormat',             ikon: '✕',    label: 'Hapus format'                                     },
  undo:          { perintah: 'undo',                     ikon: '↩',    label: 'Urungkan (Ctrl+Z)',    khusus: true                },
  redo:          { perintah: 'redo',                     ikon: '↪',    label: 'Ulangi (Ctrl+Y)',      khusus: true                },
};

const PRESET_TOOLBAR = {
  minimal:  ['bold', 'italic', '|', 'link'],
  standard: [
    'bold', 'italic', 'underline', '|',
    'h2', 'h3', '|',
    'ul', 'ol', '|',
    'link', 'removeFormat',
  ],
  full: [
    'bold', 'italic', 'underline', 'strikethrough', 'superscript', 'subscript', '|',
    'h1', 'h2', 'h3', 'p', '|',
    'alignLeft', 'alignCenter', 'alignRight', 'alignJustify', '|',
    'fontSize', 'foreColor', 'hiliteColor', '|',
    'ul', 'ol', 'blockquote', 'code', 'hr', '|',
    'table', 'link', 'insertImage', 'removeFormat', '|',
    'undo', 'redo',
  ],
};

/** Palet 18 warna standar untuk color picker. */
const PALET_WARNA = [
  '#000000', '#1a1a1a', '#333333', '#666666', '#999999', '#ffffff',
  '#cc0000', '#ff6600', '#ffcc00', '#009900', '#0066cc', '#6600cc',
  '#ff6699', '#ff9966', '#ffff66', '#66ff66', '#66ccff', '#cc99ff',
];

/** Ukuran font — execCommand fontSize menerima nilai 1–7. */
const PILIHAN_UKURAN_FONT = [
  { nilai: '1', label: 'Kecil sekali (8pt)' },
  { nilai: '2', label: 'Kecil (10pt)'       },
  { nilai: '3', label: 'Normal (12pt)'      },
  { nilai: '4', label: 'Besar (14pt)'       },
  { nilai: '5', label: 'Besar sekali (18pt)'},
  { nilai: '6', label: 'Sangat besar (24pt)'},
  { nilai: '7', label: 'Maksimal (36pt)'    },
];

const TAG_DIIZINKAN = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sup', 'sub',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a', 'img', 'span', 'div',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'figure', 'figcaption',
]);

const ATRIBUT_DIIZINKAN = {
  a:     ['href', 'title', 'target', 'rel'],
  img:   ['src', 'alt', 'width', 'height', 'loading'],
  span:  ['class', 'style'],
  div:   ['class', 'style'],
  p:     ['style'],
  td:    ['colspan', 'rowspan', 'style'],
  th:    ['colspan', 'rowspan', 'scope', 'style'],
  table: ['class', 'style'],
  code:  ['class'],
  pre:   ['class'],
};

/**
 * Pola markdown shortcut: {regex, perintah, nilai?, hapusPemicu}
 * Dijalankan ketika user menekan Space atau Enter.
 */
const MARKDOWN_SHORTCUTS = [
  { pola: /^#{3}\s$/,  perintah: 'formatBlock', nilai: 'h3'         },
  { pola: /^#{2}\s$/,  perintah: 'formatBlock', nilai: 'h2'         },
  { pola: /^#\s$/,     perintah: 'formatBlock', nilai: 'h1'         },
  { pola: /^>\s$/,     perintah: 'formatBlock', nilai: 'blockquote' },
  { pola: /^```\s$/,   perintah: 'formatBlock', nilai: 'pre'        },
  { pola: /^-\s$/,     perintah: 'insertUnorderedList'               },
  { pola: /^\d+\.\s$/, perintah: 'insertOrderedList'                },
];

// ─────────────────────────────────────────────────────────────
// Utilitas private
// ─────────────────────────────────────────────────────────────

/**
 * Sanitasi HTML — whitelist tag + atribut, cegah XSS.
 * @param {string} html
 * @returns {string}
 */
function sanitasiHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  function bersihkanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return;
    const tag = node.tagName?.toLowerCase();
    if (!tag) return;

    if (!TAG_DIIZINKAN.has(tag)) {
      const frag = document.createDocumentFragment();
      while (node.firstChild) frag.appendChild(node.firstChild);
      node.parentNode?.replaceChild(frag, node);
      return;
    }

    const izin = ATRIBUT_DIIZINKAN[tag] ?? [];
    for (const attr of Array.from(node.attributes ?? [])) {
      if (!izin.includes(attr.name)) {
        node.removeAttribute(attr.name);
      }
    }

    if (tag === 'a') {
      const href = node.getAttribute('href') ?? '';
      if (/^\s*javascript:/i.test(href)) node.removeAttribute('href');
      if (node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }

    if (tag === 'img') {
      const src = node.getAttribute('src') ?? '';
      // Izinkan data URL base64 untuk gambar yang diupload
      if (!/^\s*javascript:/i.test(src)) {
        node.setAttribute('loading', 'lazy');
      } else {
        node.removeAttribute('src');
      }
    }

    // Bersihkan style attribute — hanya izinkan properti tertentu
    if (node.hasAttribute('style')) {
      const gaya = node.getAttribute('style');
      const gayaBersih = gaya
        .split(';')
        .map((s) => s.trim())
        .filter((s) => /^(color|background-color|text-align|font-size)\s*:/i.test(s))
        .join('; ');
      gayaBersih ? node.setAttribute('style', gayaBersih) : node.removeAttribute('style');
    }

    for (const anak of Array.from(node.childNodes)) bersihkanNode(anak);
  }

  for (const anak of Array.from(div.childNodes)) bersihkanNode(anak);
  return div.innerHTML;
}

/**
 * Membersihkan HTML yang di-paste dari Word/Office.
 * Menghapus: tag Word/Office, style berlebih, komentar, namespace XML.
 *
 * @param {string} html
 * @returns {string}
 */
function bersihkanHtmlPaste(html) {
  return html
    // Hapus komentar HTML (termasuk blok kondisional Word [if gte mso])
    .replace(/<!--[\s\S]*?-->/g, '')
    // Hapus tag Office/Word namespace: <o:p>, <w:sdtPr>, <m:oMath> dll
    .replace(/<\/?[a-z]+:[^>]*>/gi, '')
    // Hapus tag yang tidak relevan: style, script, meta, link, xml
    .replace(/<(style|script|meta|link|xml)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Hapus atribut class yang mengandung prefix Office/Word (Mso*)
    .replace(/\s+class="[^"]*Mso[^"]*"/gi, '')
    // Hapus atribut lang, valign, width, height pada sel tabel
    .replace(/\s+(lang|valign|width|height|bgcolor|border|cellspacing|cellpadding)="[^"]*"/gi, '')
    // Normalisasi spasi berlebih
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Konversi HTML ke plain text dengan preservasi baris baru.
 * @param {string} html
 * @returns {string}
 */
function htmlKePlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  const TAG_BLOK = new Set(['p','div','h1','h2','h3','h4','h5','h6','li','blockquote','pre','tr']);

  function ambilTeks(node, buf) {
    for (const anak of node.childNodes) {
      if (anak.nodeType === Node.TEXT_NODE) {
        buf.push(anak.textContent);
      } else if (anak.nodeType === Node.ELEMENT_NODE) {
        const t = anak.tagName.toLowerCase();
        if (TAG_BLOK.has(t)) { buf.push('\n'); ambilTeks(anak, buf); buf.push('\n'); }
        else if (t === 'br') buf.push('\n');
        else if (t === 'td' || t === 'th') { ambilTeks(anak, buf); buf.push('\t'); }
        else ambilTeks(anak, buf);
      }
    }
  }

  const buf = [];
  ambilTeks(div, buf);
  return buf.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Hitung jumlah kata dari teks plain.
 * @param {string} teks
 * @returns {number}
 */
function hitungKata(teks) {
  return teks.trim() ? teks.trim().split(/\s+/).length : 0;
}

/**
 * Baca file sebagai base64 data URL.
 * @param {File} file
 * @returns {Promise<string>}
 */
function bacaFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────
// Kelas utama
// ─────────────────────────────────────────────────────────────

export class RichTextEditor {
  /**
   * @param {string|HTMLElement} selektor
   * @param {object} [opsi]
   * @param {string[]}  [opsi.toolbar]          - Array nama tool + '|' separator
   * @param {string}    [opsi.toolbarPreset]     - 'minimal' | 'standard' (default) | 'full'
   * @param {string}    [opsi.placeholder]       - Teks placeholder
   * @param {number}    [opsi.debounceMs]        - Debounce event 'ubah' (default: 300)
   * @param {string}    [opsi.nilaiAwal]         - HTML awal
   * @param {boolean}   [opsi.readonly]          - Mode hanya baca
   * @param {number}    [opsi.maxLength]         - Batas karakter (0 = tidak terbatas)
   * @param {boolean}   [opsi.markdownShortcut]  - Aktifkan markdown shortcut (default: true)
   * @param {boolean}   [opsi.pasteCleanup]      - Bersihkan paste dari Word (default: true)
   * @param {Function}  [opsi.onUbah]            - Backward-compat: ({ html, teks, jumlahKata }) => void
   * @param {Function}  [opsi.onFokus]           - Backward-compat: () => void
   * @param {Function}  [opsi.onBlur]            - Backward-compat: () => void
   */
  constructor(selektor, opsi = {}) {
    const kontainer =
      typeof selektor === 'string' ? document.querySelector(selektor) : selektor;
    if (!kontainer) throw new Error(`[RichTextEditor] Elemen tidak ditemukan: "${selektor}"`);

    this._opsi = {
      toolbar:         null,
      toolbarPreset:   'standard',
      placeholder:     'Mulai mengetik...',
      debounceMs:      300,
      nilaiAwal:       '',
      readonly:        false,
      maxLength:       0,
      markdownShortcut: true,
      pasteCleanup:    true,
      onUbah:          null,
      onFokus:         null,
      onBlur:          null,
      ...opsi,
    };

    this._kontainer        = kontainer;
    this._timerDebounce    = null;
    this._seleksiTersimpan = null;
    this._dropdownAktif    = null;

    // Event system
    this._listeners = new Map();

    // Backward-compat: daftarkan callback lama sebagai listener
    if (this._opsi.onUbah)  this.on('ubah',  this._opsi.onUbah);
    if (this._opsi.onFokus) this.on('fokus', this._opsi.onFokus);
    if (this._opsi.onBlur)  this.on('blur',  this._opsi.onBlur);

    this._bangunUI();
    this._pasangEventListener();

    if (this._opsi.readonly)   this._aktifkanReadonly(true);
    if (this._opsi.nilaiAwal)  this.setNilai(this._opsi.nilaiAwal);

    // Emit 'ready' setelah satu tick agar listener yang dipasang setelah konstruktor bisa terima
    setTimeout(() => this.emit('ready', { editor: this }), 0);
  }

  // ─────────────────────────────────────────────
  // Event system: on / off / emit
  // ─────────────────────────────────────────────

  /**
   * Mendaftarkan listener untuk event tertentu.
   * Event yang tersedia: 'ubah', 'fokus', 'blur', 'ready', 'seleksi-ubah'
   *
   * @param {string}   event
   * @param {Function} fn
   * @returns {this}
   */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return this;
  }

  /**
   * Melepas listener.
   * @param {string}   event
   * @param {Function} fn
   * @returns {this}
   */
  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
    return this;
  }

  /**
   * Memanggil semua listener untuk event tertentu.
   * Error di listener tidak crash editor.
   *
   * @param {string} event
   * @param {unknown} [data]
   */
  emit(event, data) {
    for (const fn of this._listeners.get(event) ?? []) {
      try { fn(data); } catch (err) {
        // Jangan biarkan error listener crash editor; log untuk debugging
        console.error(`[RichTextEditor] Error di listener "${event}":`, err);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Resolusi toolbar
  // ─────────────────────────────────────────────

  _resolveToolbar() {
    const daftar = this._opsi.toolbar
      ?? PRESET_TOOLBAR[this._opsi.toolbarPreset]
      ?? PRESET_TOOLBAR.standard;
    return daftar.filter((item) => item === '|' || item in DEFINISI_TOOL);
  }

  // ─────────────────────────────────────────────
  // Pembangunan UI
  // ─────────────────────────────────────────────

  _bangunUI() {
    this._kontainer.classList.add('wanuky-rte');
    this._kontainer.setAttribute('role', 'group');
    this._kontainer.setAttribute('aria-label', 'Editor teks kaya');

    this._toolbar = document.createElement('div');
    this._toolbar.className = 'wanuky-rte__toolbar';
    this._toolbar.setAttribute('role', 'toolbar');
    this._toolbar.setAttribute('aria-label', 'Alat format teks');

    for (const item of this._resolveToolbar()) {
      if (item === '|') {
        const sep = document.createElement('span');
        sep.className = 'wanuky-rte__pemisah';
        sep.setAttribute('aria-hidden', 'true');
        this._toolbar.appendChild(sep);
        continue;
      }
      this._toolbar.appendChild(this._buatItemToolbar(item));
    }

    this._area = document.createElement('div');
    this._area.className       = 'wanuky-rte__area';
    this._area.contentEditable = 'true';
    this._area.setAttribute('role', 'textbox');
    this._area.setAttribute('aria-multiline', 'true');
    this._area.setAttribute('spellcheck', 'true');
    this._area.dataset.placeholder = this._opsi.placeholder;

    this._counter = null;
    if (this._opsi.maxLength > 0) {
      this._counter = document.createElement('div');
      this._counter.className = 'wanuky-rte__counter';
      this._counter.setAttribute('aria-live', 'polite');
      this._counter.setAttribute('aria-atomic', 'true');
      this._perbaruiCounter(0, 0);
    }

    this._kontainer.appendChild(this._toolbar);
    this._kontainer.appendChild(this._area);
    if (this._counter) this._kontainer.appendChild(this._counter);

    // Bangun semua modal
    this._bangunModalTautan();
    this._bangunModalGambar();
    this._bangunModalTabel();
  }

  /**
   * Membuat satu elemen item toolbar: bisa tombol biasa atau wrapper dropdown.
   * @param {string} namaTool
   * @returns {HTMLElement}
   */
  _buatItemToolbar(namaTool) {
    const def = DEFINISI_TOOL[namaTool];

    if (def.tipe === 'dropdown-warna') {
      return this._buatDropdownWarna(namaTool, def);
    }

    if (def.tipe === 'dropdown-ukuran') {
      return this._buatDropdownUkuran(namaTool, def);
    }

    const tombol = document.createElement('button');
    tombol.type      = 'button';
    tombol.className = 'wanuky-rte__tombol';
    tombol.textContent = def.ikon;
    tombol.setAttribute('aria-label', def.label);
    tombol.setAttribute('title', def.label);
    tombol.dataset.tool = namaTool;
    if (def.tag) tombol.dataset.tag = def.tag;
    return tombol;
  }

  /**
   * Membuat dropdown color picker untuk foreColor / hiliteColor.
   * @param {string} namaTool
   * @param {object} def
   * @returns {HTMLElement}
   */
  _buatDropdownWarna(namaTool, def) {
    const wrapper = document.createElement('div');
    wrapper.className = 'wanuky-rte__dropdown';
    wrapper.dataset.dropdown = namaTool;

    const tombol = document.createElement('button');
    tombol.type      = 'button';
    tombol.className = 'wanuky-rte__tombol wanuky-rte__tombol--dropdown';
    tombol.setAttribute('aria-label', def.label);
    tombol.setAttribute('title', def.label);
    tombol.setAttribute('aria-haspopup', 'true');
    tombol.setAttribute('aria-expanded', 'false');
    tombol.dataset.tool = namaTool;

    // Ikon + indikator warna aktif
    const ikonEl = document.createElement('span');
    ikonEl.className   = 'wanuky-rte__tombol__ikon';
    ikonEl.textContent = def.ikon;

    const warnaEl = document.createElement('span');
    warnaEl.className = 'wanuky-rte__tombol__warna-aktif';
    warnaEl.style.background = '#000000';
    warnaEl.dataset.warnaIndicator = namaTool;

    const panah = document.createElement('span');
    panah.className   = 'wanuky-rte__tombol__panah';
    panah.textContent = '▾';
    panah.setAttribute('aria-hidden', 'true');

    tombol.appendChild(ikonEl);
    tombol.appendChild(warnaEl);
    tombol.appendChild(panah);

    const panel = document.createElement('div');
    panel.className = 'wanuky-rte__dropdown__panel wanuky-rte__dropdown__panel--warna';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', def.label);
    panel.hidden = true;

    for (const warna of PALET_WARNA) {
      const swatch = document.createElement('button');
      swatch.type      = 'button';
      swatch.className = 'wanuky-rte__swatch';
      swatch.style.background = warna;
      swatch.setAttribute('aria-label', warna);
      swatch.setAttribute('title', warna);
      swatch.dataset.warna = warna;
      swatch.dataset.tool  = namaTool;
      panel.appendChild(swatch);
    }

    wrapper.appendChild(tombol);
    wrapper.appendChild(panel);
    return wrapper;
  }

  /**
   * Membuat dropdown ukuran font.
   * @param {string} namaTool
   * @param {object} def
   * @returns {HTMLElement}
   */
  _buatDropdownUkuran(namaTool, def) {
    const wrapper = document.createElement('div');
    wrapper.className = 'wanuky-rte__dropdown';
    wrapper.dataset.dropdown = namaTool;

    const tombol = document.createElement('button');
    tombol.type      = 'button';
    tombol.className = 'wanuky-rte__tombol wanuky-rte__tombol--dropdown';
    tombol.setAttribute('aria-label', def.label);
    tombol.setAttribute('title', def.label);
    tombol.setAttribute('aria-haspopup', 'true');
    tombol.setAttribute('aria-expanded', 'false');
    tombol.dataset.tool = namaTool;

    const teksEl = document.createElement('span');
    teksEl.className   = 'wanuky-rte__tombol__ikon';
    teksEl.textContent = def.ikon;

    const panah = document.createElement('span');
    panah.className   = 'wanuky-rte__tombol__panah';
    panah.textContent = '▾';
    panah.setAttribute('aria-hidden', 'true');

    tombol.appendChild(teksEl);
    tombol.appendChild(panah);

    const panel = document.createElement('div');
    panel.className = 'wanuky-rte__dropdown__panel wanuky-rte__dropdown__panel--ukuran';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', def.label);
    panel.hidden = true;

    for (const { nilai, label } of PILIHAN_UKURAN_FONT) {
      const opsi = document.createElement('button');
      opsi.type      = 'button';
      opsi.className = 'wanuky-rte__dropdown__opsi';
      opsi.textContent = label;
      opsi.dataset.tool   = namaTool;
      opsi.dataset.nilai  = nilai;
      panel.appendChild(opsi);
    }

    wrapper.appendChild(tombol);
    wrapper.appendChild(panel);
    return wrapper;
  }

  // ─────────────────────────────────────────────
  // Modal dialogs
  // ─────────────────────────────────────────────

  _bangunModalTautan() {
    this._modalTautan = this._buatModal('Tambah tautan', [
      { id: 'link-url',  tipe: 'url',  label: 'URL',          placeholder: 'https://contoh.com' },
      { id: 'link-teks', tipe: 'text', label: 'Teks tautan',  placeholder: 'Opsional' },
    ]);

    this._inputLinkUrl  = this._modalTautan.querySelector('#wanuky-rte-link-url');
    this._inputLinkTeks = this._modalTautan.querySelector('#wanuky-rte-link-teks');

    this._modalTautan.querySelector('.wanuky-rte__modal__terapkan')
      .addEventListener('click', () => this._terapkanTautan());
    this._modalTautan.querySelector('.wanuky-rte__modal__batal')
      .addEventListener('click', () => this._sembunyikanModal(this._modalTautan));
    this._modalTautan.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._sembunyikanModal(this._modalTautan);
      if (e.key === 'Enter' && e.target === this._inputLinkUrl) {
        e.preventDefault(); this._terapkanTautan();
      }
    });
    this._pasangFokusJebakan(this._modalTautan);
  }

  _bangunModalGambar() {
    this._modalGambar = this._buatModal('Sisipkan gambar', [
      { id: 'img-url',  tipe: 'url',  label: 'URL gambar',  placeholder: 'https://contoh.com/gambar.jpg' },
      { id: 'img-alt',  tipe: 'text', label: 'Teks alt',    placeholder: 'Deskripsi gambar' },
    ]);

    // Tambahkan tombol upload file di bawah field URL
    const fieldUpload = document.createElement('div');
    fieldUpload.className = 'wanuky-rte__modal__field';

    const labelUpload = document.createElement('label');
    labelUpload.textContent = 'Atau upload file';
    labelUpload.setAttribute('for', 'wanuky-rte-img-file');

    this._inputGambarFile = document.createElement('input');
    this._inputGambarFile.type   = 'file';
    this._inputGambarFile.id     = 'wanuky-rte-img-file';
    this._inputGambarFile.accept = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml';
    this._inputGambarFile.className = 'wanuky-rte__modal__input';

    fieldUpload.appendChild(labelUpload);
    fieldUpload.appendChild(this._inputGambarFile);

    // Sisipkan setelah field URL
    const aksi = this._modalGambar.querySelector('.wanuky-rte__modal__aksi');
    this._modalGambar.insertBefore(fieldUpload, aksi);

    this._inputGambarUrl = this._modalGambar.querySelector('#wanuky-rte-img-url');
    this._inputGambarAlt = this._modalGambar.querySelector('#wanuky-rte-img-alt');

    this._modalGambar.querySelector('.wanuky-rte__modal__terapkan')
      .addEventListener('click', () => this._terapkanGambar());
    this._modalGambar.querySelector('.wanuky-rte__modal__batal')
      .addEventListener('click', () => this._sembunyikanModal(this._modalGambar));
    this._modalGambar.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._sembunyikanModal(this._modalGambar);
    });
    this._pasangFokusJebakan(this._modalGambar);
  }

  _bangunModalTabel() {
    this._modalTabel = this._buatModal('Sisipkan tabel', [
      { id: 'tabel-baris', tipe: 'number', label: 'Jumlah baris',  placeholder: '3' },
      { id: 'tabel-kolom', tipe: 'number', label: 'Jumlah kolom',  placeholder: '3' },
    ]);

    this._inputTabelBaris = this._modalTabel.querySelector('#wanuky-rte-tabel-baris');
    this._inputTabelKolom = this._modalTabel.querySelector('#wanuky-rte-tabel-kolom');
    this._inputTabelBaris.value = '3';
    this._inputTabelKolom.value = '3';
    this._inputTabelBaris.min = '1';
    this._inputTabelBaris.max = '20';
    this._inputTabelKolom.min = '1';
    this._inputTabelKolom.max = '20';

    this._modalTabel.querySelector('.wanuky-rte__modal__terapkan')
      .addEventListener('click', () => this._terapkanTabel());
    this._modalTabel.querySelector('.wanuky-rte__modal__batal')
      .addEventListener('click', () => this._sembunyikanModal(this._modalTabel));
    this._modalTabel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._sembunyikanModal(this._modalTabel);
      if (e.key === 'Enter') { e.preventDefault(); this._terapkanTabel(); }
    });
    this._pasangFokusJebakan(this._modalTabel);
  }

  _buatModal(judul, fields) {
    const modal = document.createElement('div');
    modal.className = 'wanuky-rte__modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', judul);
    modal.hidden = true;

    const judulEl = document.createElement('p');
    judulEl.className   = 'wanuky-rte__modal__judul';
    judulEl.textContent = judul;
    modal.appendChild(judulEl);

    for (const f of fields) {
      const wrap = document.createElement('div');
      wrap.className = 'wanuky-rte__modal__field';

      const label = document.createElement('label');
      label.textContent = f.label;
      label.setAttribute('for', `wanuky-rte-${f.id}`);

      const input = document.createElement('input');
      input.type = f.tipe;
      input.id   = `wanuky-rte-${f.id}`;
      input.className   = 'wanuky-rte__modal__input';
      input.placeholder = f.placeholder ?? '';

      wrap.appendChild(label);
      wrap.appendChild(input);
      modal.appendChild(wrap);
    }

    const aksi = document.createElement('div');
    aksi.className = 'wanuky-rte__modal__aksi';

    const btnTerapkan = document.createElement('button');
    btnTerapkan.type      = 'button';
    btnTerapkan.className = 'wanuky-rte__modal__tombol wanuky-rte__modal__terapkan';
    btnTerapkan.textContent = 'Terapkan';

    const btnBatal = document.createElement('button');
    btnBatal.type      = 'button';
    btnBatal.className = 'wanuky-rte__modal__tombol wanuky-rte__modal__batal';
    btnBatal.textContent = 'Batal';

    aksi.appendChild(btnTerapkan);
    aksi.appendChild(btnBatal);
    modal.appendChild(aksi);

    this._kontainer.appendChild(modal);
    return modal;
  }

  _pasangFokusJebakan(modal) {
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const els = Array.from(modal.querySelectorAll('input, button:not([disabled])'));
      const idx = els.indexOf(document.activeElement);
      e.preventDefault();
      els[(idx + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
    });
  }

  // ─────────────────────────────────────────────
  // Event listeners
  // ─────────────────────────────────────────────

  _pasangEventListener() {
    // ── Toolbar: klik tombol dan swatch warna ──────────────────
    this._toolbar.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Jaga fokus tetap di area editor
      if (this._opsi.readonly) return;

      // Swatch warna
      const swatch = e.target.closest('.wanuky-rte__swatch');
      if (swatch) {
        const warna  = swatch.dataset.warna;
        const namaTool = swatch.dataset.tool;
        this._eksekusiTool(namaTool, warna);
        this._tutupSemuaDropdown();
        this._perbarui();
        return;
      }

      // Opsi ukuran font
      const opsiUkuran = e.target.closest('.wanuky-rte__dropdown__opsi');
      if (opsiUkuran) {
        this._eksekusiTool(opsiUkuran.dataset.tool, opsiUkuran.dataset.nilai);
        this._tutupSemuaDropdown();
        this._perbarui();
        return;
      }

      // Tombol dropdown — toggle panel
      const tombolDropdown = e.target.closest('.wanuky-rte__tombol--dropdown');
      if (tombolDropdown) {
        const wrapper = tombolDropdown.closest('.wanuky-rte__dropdown');
        this._toggleDropdown(wrapper);
        return;
      }

      // Tombol biasa
      const tombol = e.target.closest('.wanuky-rte__tombol');
      if (tombol?.dataset.tool) {
        this._tutupSemuaDropdown();
        this._eksekusiTool(tombol.dataset.tool);
        this._perbarui();
      }
    });

    // ── Input area ────────────────────────────────────────────
    this._area.addEventListener('input', () => {
      if (this._opsi.maxLength > 0) {
        const { teks } = this.getNilai();
        if (teks.length > this._opsi.maxLength) {
          document.execCommand('undo');
          return;
        }
      }
      this._perbarui();
    });

    // ── Paste cleanup ─────────────────────────────────────────
    this._area.addEventListener('paste', (e) => {
      if (!this._opsi.pasteCleanup) return;
      const htmlRaw = e.clipboardData?.getData('text/html');
      if (!htmlRaw) return;

      e.preventDefault();
      const htmlBersih = sanitasiHtml(bersihkanHtmlPaste(htmlRaw));
      document.execCommand('insertHTML', false, htmlBersih);
      this._perbarui();
    });

    // ── Drag & drop gambar langsung ke area editor ────────────
    this._area.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });

    this._area.addEventListener('drop', async (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      e.preventDefault();
      await this._sisipkanGambarDariFile(file);
    });

    // ── Keyboard shortcuts ────────────────────────────────────
    this._area.addEventListener('keydown', (e) => {
      if (this._opsi.readonly) { e.preventDefault(); return; }

      // Ctrl/Cmd shortcuts
      if (e.ctrlKey || e.metaKey) {
        const map = {
          b: 'bold',
          i: 'italic',
          u: 'underline',
          z: e.shiftKey ? 'redo' : 'undo',
          y: 'redo',
        };
        const tool = map[e.key.toLowerCase()];
        if (tool) { e.preventDefault(); this._eksekusiTool(tool); this._perbarui(); }
        return;
      }

      // Markdown shortcuts — aktif saat Space atau Enter
      if ((e.key === ' ' || e.key === 'Enter') && this._opsi.markdownShortcut) {
        if (this._cekMarkdownShortcut(e.key)) e.preventDefault();
      }

      // Tutup dropdown saat mengetik
      if (this._dropdownAktif) this._tutupSemuaDropdown();
    });

    // ── Update status tombol saat seleksi berubah ─────────────
    const onSeleksiUbah = () => {
      this._perbaruiStatusTombol();
      this.emit('seleksi-ubah', { teks: this.getSelectedText() });
    };
    this._area.addEventListener('keyup',   onSeleksiUbah);
    this._area.addEventListener('mouseup', onSeleksiUbah);

    // ── Fokus / Blur ──────────────────────────────────────────
    this._area.addEventListener('focus', () => this.emit('fokus'));
    this._area.addEventListener('blur',  () => this.emit('blur'));

    // ── Klik luar dropdown — tutup ────────────────────────────
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.wanuky-rte__dropdown')) {
        this._tutupSemuaDropdown();
      }
    });
  }

  // ─────────────────────────────────────────────
  // Dropdown management
  // ─────────────────────────────────────────────

  _toggleDropdown(wrapper) {
    const panel = wrapper.querySelector('.wanuky-rte__dropdown__panel');
    const tombol = wrapper.querySelector('.wanuky-rte__tombol--dropdown');
    const sedangTerbuka = !panel.hidden;

    this._tutupSemuaDropdown();

    if (!sedangTerbuka) {
      panel.hidden = false;
      tombol.setAttribute('aria-expanded', 'true');
      this._dropdownAktif = wrapper;
    }
  }

  _tutupSemuaDropdown() {
    for (const panel of this._kontainer.querySelectorAll('.wanuky-rte__dropdown__panel')) {
      panel.hidden = true;
    }
    for (const tombol of this._kontainer.querySelectorAll('.wanuky-rte__tombol--dropdown')) {
      tombol.setAttribute('aria-expanded', 'false');
    }
    this._dropdownAktif = null;
  }

  // ─────────────────────────────────────────────
  // Eksekusi tool & markdown
  // ─────────────────────────────────────────────

  _eksekusiTool(namaTool, nilaiOverride = null) {
    const def = DEFINISI_TOOL[namaTool];
    if (!def) return;

    switch (namaTool) {
      case 'undo':
        document.execCommand('undo');
        break;
      case 'redo':
        document.execCommand('redo');
        break;
      case 'blockquote':
        document.execCommand('formatBlock', false, 'blockquote');
        break;
      case 'link':
        this._simpanSeleksi();
        this._tampilkanModal(this._modalTautan, this._inputLinkUrl);
        break;
      case 'insertImage':
        this._simpanSeleksi();
        this._tampilkanModal(this._modalGambar, this._inputGambarUrl);
        break;
      case 'table':
        this._simpanSeleksi();
        this._tampilkanModal(this._modalTabel, this._inputTabelBaris);
        break;
      case 'foreColor':
      case 'hiliteColor':
        if (nilaiOverride) {
          document.execCommand(def.perintah, false, nilaiOverride);
          // Perbarui indikator warna aktif
          const indicator = this._toolbar.querySelector(`[data-warna-indicator="${namaTool}"]`);
          if (indicator) indicator.style.background = nilaiOverride;
        }
        break;
      case 'fontSize':
        if (nilaiOverride) {
          document.execCommand('fontSize', false, nilaiOverride);
        }
        break;
      default:
        document.execCommand(def.perintah, false, def.nilai ?? null);
    }
  }

  /**
   * Memeriksa apakah teks awal baris saat ini cocok dengan pola markdown.
   * Jika cocok: transformasi blok, hapus pemicu, kembalikan true.
   *
   * @param {string} kunciPemicu - ' ' atau 'Enter'
   * @returns {boolean}
   */
  _cekMarkdownShortcut(kunciPemicu) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return false;

    const range  = sel.getRangeAt(0);
    const node   = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;

    // Ambil teks dari awal baris hingga posisi kursor + karakter pemicu
    const teksNode = node.textContent ?? '';
    const posisi   = range.startOffset;
    const teksAwal = teksNode.slice(0, posisi) + kunciPemicu;

    for (const sc of MARKDOWN_SHORTCUTS) {
      if (sc.pola.test(teksAwal)) {
        // Hapus karakter pemicu dari node teks
        node.textContent = teksNode.slice(posisi);
        // Pindahkan kursor ke awal
        range.setStart(node, 0);
        range.setEnd(node, 0);
        sel.removeAllRanges();
        sel.addRange(range);
        // Eksekusi perintah
        document.execCommand('formatBlock', false, sc.nilai ?? 'p');
        // Hapus sisa teks pemicu di awal (# , ## , > dll)
        const blok = sel.getRangeAt(0).startContainer?.parentElement;
        if (blok && sc.pola.source.startsWith('^')) {
          blok.textContent = blok.textContent.replace(sc.pola, '');
        }
        return true;
      }
    }
    return false;
  }

  // ─────────────────────────────────────────────
  // Seleksi & modal
  // ─────────────────────────────────────────────

  _simpanSeleksi() {
    const sel = window.getSelection();
    this._seleksiTersimpan = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
  }

  _pulihkanSeleksi() {
    if (!this._seleksiTersimpan) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(this._seleksiTersimpan);
    this._seleksiTersimpan = null;
  }

  _tampilkanModal(modal, inputFokus) {
    for (const m of this._kontainer.querySelectorAll('.wanuky-rte__modal')) m.hidden = true;
    for (const input of modal.querySelectorAll('input[type="text"], input[type="url"], input[type="number"]')) {
      input.value = '';
    }
    modal.hidden = false;
    inputFokus?.focus();
  }

  _sembunyikanModal(modal) {
    modal.hidden = true;
    this._seleksiTersimpan = null;
    this._area.focus();
  }

  _terapkanTautan() {
    const url = this._inputLinkUrl?.value.trim();
    if (!url || /^\s*javascript:/i.test(url)) { this._inputLinkUrl?.focus(); return; }

    const teks = this._inputLinkTeks?.value.trim();
    this._sembunyikanModal(this._modalTautan);
    this._pulihkanSeleksi();

    const sel = window.getSelection();
    if (teks && (!sel.rangeCount || sel.getRangeAt(0).collapsed)) {
      const node  = document.createTextNode(teks);
      const range = document.createRange();
      sel.getRangeAt(0)?.insertNode(node);
      range.selectNode(node);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    document.execCommand('createLink', false, url);
    this._perbarui();
  }

  async _terapkanGambar() {
    const file = this._inputGambarFile?.files?.[0];
    const url  = this._inputGambarUrl?.value.trim();
    const alt  = this._inputGambarAlt?.value.trim() ?? '';

    if (!file && !url) { this._inputGambarUrl?.focus(); return; }
    if (url && /^\s*javascript:/i.test(url)) { this._inputGambarUrl?.focus(); return; }

    this._sembunyikanModal(this._modalGambar);
    this._pulihkanSeleksi();

    if (file) {
      await this._sisipkanGambarDariFile(file, alt);
    } else {
      document.execCommand('insertImage', false, url);
      const gambarBaru = this._area.querySelector(`img[src="${url}"]`);
      if (gambarBaru && alt) gambarBaru.setAttribute('alt', alt);
    }

    this._perbarui();
  }

  async _sisipkanGambarDariFile(file, alt = '') {
    try {
      const dataUrl = await bacaFileAsDataUrl(file);
      document.execCommand('insertImage', false, dataUrl);
      if (alt) {
        const gambarBaru = this._area.querySelector(`img[src="${dataUrl}"]`);
        if (gambarBaru) gambarBaru.setAttribute('alt', alt);
      }
    } catch (err) {
      console.error('[RichTextEditor] Gagal upload gambar:', err);
    }
  }

  _terapkanTabel() {
    const baris = Math.min(20, Math.max(1, Number(this._inputTabelBaris?.value) || 3));
    const kolom = Math.min(20, Math.max(1, Number(this._inputTabelKolom?.value) || 3));

    this._sembunyikanModal(this._modalTabel);
    this._pulihkanSeleksi();

    // Bangun HTML tabel dengan <thead> (satu baris header) + <tbody>
    let html = '<table><thead><tr>';
    for (let k = 0; k < kolom; k++) html += `<th>Kolom ${k + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let b = 0; b < baris - 1; b++) {
      html += '<tr>';
      for (let k = 0; k < kolom; k++) html += '<td>&nbsp;</td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';

    document.execCommand('insertHTML', false, html);
    this._perbarui();
  }

  // ─────────────────────────────────────────────
  // Update state & counter
  // ─────────────────────────────────────────────

  _perbarui() {
    this._perbaruiStatusTombol();
    this._jadwalkanEmit();
  }

  _perbaruiStatusTombol() {
    for (const tombol of this._toolbar.querySelectorAll('.wanuky-rte__tombol[data-tool]')) {
      const def = DEFINISI_TOOL[tombol.dataset.tool];
      if (!def?.tag) continue;
      try {
        const aktif = document.queryCommandState(def.perintah);
        tombol.classList.toggle('wanuky-rte__tombol--aktif', aktif);
        tombol.setAttribute('aria-pressed', String(aktif));
      } catch {
        // queryCommandState bisa throw untuk perintah tertentu — abaikan
      }
    }
  }

  _perbaruiCounter(jumlahKarakter, jumlahKata) {
    if (!this._counter) return;
    const maks = this._opsi.maxLength;
    this._counter.textContent = maks > 0
      ? `${jumlahKarakter} / ${maks} karakter · ${jumlahKata} kata`
      : `${jumlahKarakter} karakter · ${jumlahKata} kata`;
    this._counter.classList.toggle('wanuky-rte__counter--hampir-penuh', maks > 0 && jumlahKarakter >= maks * 0.9);
    this._counter.classList.toggle('wanuky-rte__counter--penuh',       maks > 0 && jumlahKarakter >= maks);
  }

  _jadwalkanEmit() {
    clearTimeout(this._timerDebounce);
    this._timerDebounce = setTimeout(() => {
      const nilaiSaat = this.getNilai();
      if (this._counter) this._perbaruiCounter(nilaiSaat.teks.length, nilaiSaat.jumlahKata);
      this.emit('ubah', nilaiSaat);
    }, this._opsi.debounceMs);
  }

  _aktifkanReadonly(aktif) {
    this._area.contentEditable = aktif ? 'false' : 'true';
    this._toolbar.setAttribute('aria-disabled', String(aktif));
    this._kontainer.classList.toggle('wanuky-rte--readonly', aktif);
  }

  // ─────────────────────────────────────────────
  // API Publik
  // ─────────────────────────────────────────────

  /**
   * Mengambil nilai editor saat ini.
   * @returns {{ html: string, teks: string, jumlahKata: number }}
   */
  getNilai() {
    const html      = sanitasiHtml(this._area.innerHTML);
    const teks      = htmlKePlainText(html);
    const jumlahKata = hitungKata(teks);
    return { html, teks, jumlahKata };
  }

  /**
   * Mengisi editor dengan konten HTML.
   * @param {string} html
   */
  setNilai(html) {
    this._area.innerHTML = sanitasiHtml(html);
    const { teks, jumlahKata } = this.getNilai();
    this._perbaruiCounter(teks.length, jumlahKata);
  }

  /**
   * Menyisipkan HTML di posisi kursor saat ini.
   * @param {string} html
   */
  insertHtml(html) {
    this._area.focus();
    document.execCommand('insertHTML', false, sanitasiHtml(html));
    this._perbarui();
  }

  /**
   * Mengambil teks yang sedang diseleksi di editor.
   * @returns {string}
   */
  getSelectedText() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return '';
    const range = sel.getRangeAt(0);
    // Pastikan seleksi ada di dalam area editor
    if (!this._area.contains(range.commonAncestorContainer)) return '';
    return range.toString();
  }

  /**
   * Scroll agar posisi kursor terlihat di layar.
   */
  scrollKeCursor() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rect = range.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      this._area.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  /** Mengosongkan semua konten editor. */
  kosongkan() {
    this._area.innerHTML = '';
    this._perbaruiCounter(0, 0);
    clearTimeout(this._timerDebounce);
    this.emit('ubah', { html: '', teks: '', jumlahKata: 0 });
  }

  /** Memfokuskan area editor. */
  fokus() { this._area.focus(); }

  /**
   * Mengaktifkan atau menonaktifkan mode readonly.
   * @param {boolean} aktif
   */
  setReadonly(aktif) {
    this._opsi.readonly = aktif;
    this._aktifkanReadonly(aktif);
  }

  /**
   * Menghancurkan editor: bersihkan DOM, timer, dan listener.
   */
  hancurkan() {
    clearTimeout(this._timerDebounce);
    this._listeners.clear();
    this._kontainer.innerHTML = '';
    this._kontainer.classList.remove('wanuky-rte', 'wanuky-rte--readonly');
  }
}
