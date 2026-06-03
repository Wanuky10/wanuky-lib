/**
 * RichTextEditor v1.1.0 — editor teks kaya berbasis contenteditable native.
 *
 * Baru di v1.1.0:
 *   - Toolbar modular: pilih tool secara eksplisit via `toolbar` array
 *   - Preset toolbar: 'minimal' | 'standard' | 'full'
 *   - Mode readonly
 *   - maxLength dengan counter karakter live
 *   - Callback onFokus dan onBlur
 *   - Tool baru: undo, redo, h1, code, insertImage (via URL)
 *
 * Cara pakai:
 *   import { RichTextEditor } from '@wanuky/web-editor';
 *
 *   // Pilih tool secara manual (urutan = urutan tampil di toolbar):
 *   const rte = new RichTextEditor('#editor', {
 *     toolbar: ['bold', 'italic', '|', 'h2', 'h3', '|', 'link'],
 *   });
 *
 *   // Atau gunakan preset:
 *   const rte = new RichTextEditor('#editor', { toolbarPreset: 'minimal' });
 */

// ─────────────────────────────────────────────────────────────
// Definisi semua tool yang tersedia — sumber kebenaran tunggal.
// Developer memilih subset dari kunci ini via opsi `toolbar`.
// ─────────────────────────────────────────────────────────────
const DEFINISI_TOOL = {
  bold:          { perintah: 'bold',                  ikon: 'B',    label: 'Tebal',                tag: 'b'      },
  italic:        { perintah: 'italic',                ikon: 'I',    label: 'Miring',               tag: 'i'      },
  underline:     { perintah: 'underline',             ikon: 'U',    label: 'Garis bawah',          tag: 'u'      },
  strikethrough: { perintah: 'strikeThrough',         ikon: 'S',    label: 'Coret',                tag: 's'      },
  h1:            { perintah: 'formatBlock', nilai: 'h1', ikon: 'H1', label: 'Judul 1'                           },
  h2:            { perintah: 'formatBlock', nilai: 'h2', ikon: 'H2', label: 'Judul 2'                           },
  h3:            { perintah: 'formatBlock', nilai: 'h3', ikon: 'H3', label: 'Judul 3'                           },
  p:             { perintah: 'formatBlock', nilai: 'p',  ikon: 'P',  label: 'Paragraf'                          },
  ul:            { perintah: 'insertUnorderedList',   ikon: '≡',    label: 'Daftar bullet'                      },
  ol:            { perintah: 'insertOrderedList',     ikon: '1.',   label: 'Daftar nomor'                       },
  blockquote:    { perintah: 'blockquote',            ikon: '"',    label: 'Kutipan',   khusus: true            },
  code:          { perintah: 'formatBlock', nilai: 'pre', ikon: '</>', label: 'Blok kode'                       },
  link:          { perintah: 'createLink',            ikon: '🔗',   label: 'Tambah tautan', khusus: true        },
  insertImage:   { perintah: 'insertImage',           ikon: '🖼',   label: 'Sisipkan gambar (URL)', khusus: true },
  removeFormat:  { perintah: 'removeFormat',          ikon: '✕',    label: 'Hapus format'                       },
  undo:          { perintah: 'undo',                  ikon: '↩',    label: 'Urungkan',  khusus: true            },
  redo:          { perintah: 'redo',                  ikon: '↪',    label: 'Ulangi',    khusus: true            },
};

// Preset toolbar siap pakai — developer bisa override dengan `toolbar` array
const PRESET_TOOLBAR = {
  minimal:  ['bold', 'italic', '|', 'link'],
  standard: ['bold', 'italic', 'underline', '|', 'h2', 'h3', '|', 'ul', 'ol', '|', 'link', 'removeFormat'],
  full:     [
    'bold', 'italic', 'underline', 'strikethrough', '|',
    'h1', 'h2', 'h3', 'p', '|',
    'ul', 'ol', 'blockquote', 'code', '|',
    'link', 'insertImage', 'removeFormat', '|',
    'undo', 'redo',
  ],
};

// Whitelist tag dan atribut untuk sanitasi output
const TAG_DIIZINKAN = new Set([
  'b', 'strong', 'i', 'em', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a', 'img', 'span',
]);

const ATRIBUT_DIIZINKAN = {
  a:    ['href', 'title', 'target', 'rel'],
  img:  ['src', 'alt', 'width', 'height'],
  span: ['class'],
  code: ['class'],
  pre:  ['class'],
};

// ─────────────────────────────────────────────────────────────
// Utilitas
// ─────────────────────────────────────────────────────────────

function sanitasiHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  function bersihkanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return;

    const namaTag = node.tagName?.toLowerCase();
    if (!namaTag) return;

    if (!TAG_DIIZINKAN.has(namaTag)) {
      const fragment = document.createDocumentFragment();
      while (node.firstChild) fragment.appendChild(node.firstChild);
      node.parentNode?.replaceChild(fragment, node);
      return;
    }

    const atributDiizinkan = ATRIBUT_DIIZINKAN[namaTag] ?? [];
    for (const atribut of Array.from(node.attributes ?? [])) {
      if (!atributDiizinkan.includes(atribut.name)) {
        node.removeAttribute(atribut.name);
      }
    }

    if (namaTag === 'a') {
      const href = node.getAttribute('href') ?? '';
      if (/^\s*javascript:/i.test(href)) node.removeAttribute('href');
      if (node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }

    if (namaTag === 'img') {
      const src = node.getAttribute('src') ?? '';
      if (/^\s*javascript:/i.test(src)) node.removeAttribute('src');
    }

    for (const anak of Array.from(node.childNodes)) bersihkanNode(anak);
  }

  for (const anak of Array.from(div.childNodes)) bersihkanNode(anak);
  return div.innerHTML;
}

function htmlKePlainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  const TAG_BLOK = new Set(['p','div','h1','h2','h3','h4','h5','h6','li','blockquote','pre']);

  function ambilTeks(node, buf) {
    for (const anak of node.childNodes) {
      if (anak.nodeType === Node.TEXT_NODE) {
        buf.push(anak.textContent);
      } else if (anak.nodeType === Node.ELEMENT_NODE) {
        const tag = anak.tagName.toLowerCase();
        if (TAG_BLOK.has(tag)) { buf.push('\n'); ambilTeks(anak, buf); buf.push('\n'); }
        else if (tag === 'br') buf.push('\n');
        else ambilTeks(anak, buf);
      }
    }
  }

  const buf = [];
  ambilTeks(div, buf);
  return buf.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// ─────────────────────────────────────────────────────────────
// Kelas utama
// ─────────────────────────────────────────────────────────────

export class RichTextEditor {
  /**
   * @param {string|HTMLElement} selektor
   * @param {object} [opsi]
   * @param {string[]}  [opsi.toolbar]       - Array nama tool + '|' untuk separator.
   *                                           Jika diisi, mengabaikan toolbarPreset.
   *                                           Contoh: ['bold', 'italic', '|', 'link']
   * @param {string}    [opsi.toolbarPreset]  - 'minimal' | 'standard' (default) | 'full'
   * @param {Function}  [opsi.onUbah]         - ({ html, teks }) => void — dipanggil saat konten berubah
   * @param {Function}  [opsi.onFokus]        - () => void
   * @param {Function}  [opsi.onBlur]         - () => void
   * @param {string}    [opsi.placeholder]    - Teks placeholder (default: 'Mulai mengetik...')
   * @param {number}    [opsi.debounceMs]     - Debounce onUbah (default: 300)
   * @param {string}    [opsi.nilaiAwal]      - HTML awal
   * @param {boolean}   [opsi.readonly]       - Mode hanya baca (default: false)
   * @param {number}    [opsi.maxLength]      - Batas karakter plain text (0 = tidak terbatas)
   */
  constructor(selektor, opsi = {}) {
    const kontainer =
      typeof selektor === 'string' ? document.querySelector(selektor) : selektor;

    if (!kontainer) throw new Error(`[RichTextEditor] Elemen tidak ditemukan: "${selektor}"`);

    this._opsi = {
      toolbar:       null,
      toolbarPreset: 'standard',
      onUbah:        null,
      onFokus:       null,
      onBlur:        null,
      placeholder:   'Mulai mengetik...',
      debounceMs:    300,
      nilaiAwal:     '',
      readonly:      false,
      maxLength:     0,
      ...opsi,
    };

    this._kontainer        = kontainer;
    this._timerDebounce    = null;
    this._seleksiTersimpan = null;

    this._bangunUI();
    this._pasangEventListener();

    if (this._opsi.readonly) this._aktifkanReadonly(true);
    if (this._opsi.nilaiAwal) this.setNilai(this._opsi.nilaiAwal);
  }

  // ─────────────────────────────────────────────
  // Resolusi toolbar
  // ─────────────────────────────────────────────

  /**
   * Mengembalikan array item toolbar yang aktif.
   * `toolbar` eksplisit menang atas `toolbarPreset`.
   * Item yang tidak dikenal diabaikan dengan aman.
   *
   * @returns {Array<string>}
   */
  _resolveToolbar() {
    const daftar = this._opsi.toolbar ?? PRESET_TOOLBAR[this._opsi.toolbarPreset] ?? PRESET_TOOLBAR.standard;
    // Filter: hanya izinkan '|' atau kunci yang terdaftar di DEFINISI_TOOL
    return daftar.filter((item) => item === '|' || item in DEFINISI_TOOL);
  }

  // ─────────────────────────────────────────────
  // Pembangunan UI
  // ─────────────────────────────────────────────

  _bangunUI() {
    this._kontainer.classList.add('wanuky-rte');
    this._kontainer.setAttribute('role', 'group');
    this._kontainer.setAttribute('aria-label', 'Editor teks kaya');

    // Toolbar
    this._toolbar = document.createElement('div');
    this._toolbar.className = 'wanuky-rte__toolbar';
    this._toolbar.setAttribute('role', 'toolbar');
    this._toolbar.setAttribute('aria-label', 'Alat format teks');

    for (const item of this._resolveToolbar()) {
      if (item === '|') {
        const pemisah = document.createElement('span');
        pemisah.className = 'wanuky-rte__pemisah';
        pemisah.setAttribute('aria-hidden', 'true');
        this._toolbar.appendChild(pemisah);
        continue;
      }

      const def = DEFINISI_TOOL[item];
      const tombol = document.createElement('button');
      tombol.type = 'button';
      tombol.className = 'wanuky-rte__tombol';
      tombol.textContent = def.ikon;
      tombol.setAttribute('aria-label', def.label);
      tombol.setAttribute('title', def.label);
      tombol.dataset.tool = item;
      if (def.tag) tombol.dataset.tag = def.tag;
      this._toolbar.appendChild(tombol);
    }

    // Area edit
    this._area = document.createElement('div');
    this._area.className = 'wanuky-rte__area';
    this._area.contentEditable = 'true';
    this._area.setAttribute('role', 'textbox');
    this._area.setAttribute('aria-multiline', 'true');
    this._area.setAttribute('spellcheck', 'true');
    this._area.dataset.placeholder = this._opsi.placeholder;

    // Counter karakter (hanya tampil jika maxLength > 0)
    this._counter = null;
    if (this._opsi.maxLength > 0) {
      this._counter = document.createElement('div');
      this._counter.className = 'wanuky-rte__counter';
      this._counter.setAttribute('aria-live', 'polite');
      this._counter.setAttribute('aria-atomic', 'true');
      this._perbaruiCounter(0);
    }

    this._kontainer.appendChild(this._toolbar);
    this._kontainer.appendChild(this._area);
    if (this._counter) this._kontainer.appendChild(this._counter);

    this._bangunModalTautan();
    this._bangunModalGambar();
  }

  _bangunModalTautan() {
    this._modalTautan = this._buatModal('Tambah tautan', [
      { id: 'input-url',   tipe: 'url',  label: 'URL',         placeholder: 'https://contoh.com' },
      { id: 'input-teks',  tipe: 'text', label: 'Teks tautan', placeholder: 'Opsional' },
    ]);

    this._inputUrl  = this._modalTautan.querySelector('#wanuky-rte-input-url');
    this._inputTeks = this._modalTautan.querySelector('#wanuky-rte-input-teks');

    this._modalTautan.querySelector('.wanuky-rte__modal__terapkan')
      .addEventListener('click', () => this._terapkanTautan());
    this._modalTautan.querySelector('.wanuky-rte__modal__batal')
      .addEventListener('click', () => this._sembunyikanModal(this._modalTautan));

    this._modalTautan.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._sembunyikanModal(this._modalTautan);
      if (e.key === 'Enter' && e.target === this._inputUrl) {
        e.preventDefault();
        this._terapkanTautan();
      }
    });

    this._pasangFokusJebakan(this._modalTautan);
  }

  _bangunModalGambar() {
    this._modalGambar = this._buatModal('Sisipkan gambar', [
      { id: 'input-src', tipe: 'url',  label: 'URL gambar', placeholder: 'https://contoh.com/gambar.jpg' },
      { id: 'input-alt', tipe: 'text', label: 'Teks alt',   placeholder: 'Deskripsi gambar' },
    ]);

    this._inputSrc = this._modalGambar.querySelector('#wanuky-rte-input-src');
    this._inputAlt = this._modalGambar.querySelector('#wanuky-rte-input-alt');

    this._modalGambar.querySelector('.wanuky-rte__modal__terapkan')
      .addEventListener('click', () => this._terapkanGambar());
    this._modalGambar.querySelector('.wanuky-rte__modal__batal')
      .addEventListener('click', () => this._sembunyikanModal(this._modalGambar));

    this._modalGambar.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._sembunyikanModal(this._modalGambar);
    });

    this._pasangFokusJebakan(this._modalGambar);
  }

  /**
   * Membuat elemen modal generik dengan field input dinamis.
   *
   * @param {string} judul
   * @param {Array<{id, tipe, label, placeholder}>} fields
   * @returns {HTMLElement}
   */
  _buatModal(judul, fields) {
    const modal = document.createElement('div');
    modal.className = 'wanuky-rte__modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', judul);
    modal.hidden = true;

    const judulEl = document.createElement('p');
    judulEl.className = 'wanuky-rte__modal__judul';
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
      input.id = `wanuky-rte-${f.id}`;
      input.className = 'wanuky-rte__modal__input';
      input.placeholder = f.placeholder ?? '';

      wrap.appendChild(label);
      wrap.appendChild(input);
      modal.appendChild(wrap);
    }

    const aksi = document.createElement('div');
    aksi.className = 'wanuky-rte__modal__aksi';

    const tombolTerapkan = document.createElement('button');
    tombolTerapkan.type = 'button';
    tombolTerapkan.className = 'wanuky-rte__modal__tombol wanuky-rte__modal__terapkan';
    tombolTerapkan.textContent = 'Terapkan';

    const tombolBatal = document.createElement('button');
    tombolBatal.type = 'button';
    tombolBatal.className = 'wanuky-rte__modal__tombol wanuky-rte__modal__batal';
    tombolBatal.textContent = 'Batal';

    aksi.appendChild(tombolTerapkan);
    aksi.appendChild(tombolBatal);
    modal.appendChild(aksi);

    this._kontainer.appendChild(modal);
    return modal;
  }

  _pasangFokusJebakan(modal) {
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const elemen = Array.from(modal.querySelectorAll('input, button'));
      const indeks = elemen.indexOf(document.activeElement);
      const langkah = e.shiftKey ? -1 : 1;
      e.preventDefault();
      elemen[(indeks + langkah + elemen.length) % elemen.length].focus();
    });
  }

  // ─────────────────────────────────────────────
  // Event listeners
  // ─────────────────────────────────────────────

  _pasangEventListener() {
    // Klik toolbar — preventDefault agar area tidak kehilangan fokus
    this._toolbar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (this._opsi.readonly) return;
      const tombol = e.target.closest('.wanuky-rte__tombol');
      if (!tombol) return;
      this._eksekusiTool(tombol.dataset.tool);
      this._perbaruiStatusTombol();
    });

    // Input — update counter dan jadwalkan callback
    this._area.addEventListener('input', () => {
      if (this._opsi.maxLength > 0) {
        const { teks } = this.getNilai();
        if (teks.length > this._opsi.maxLength) {
          // Potong konten berlebih — undo terakhir lebih baik dari membiarkan overflow
          document.execCommand('undo');
          return;
        }
        this._perbaruiCounter(teks.length);
      }
      this._jadwalkanKallback();
      this._perbaruiStatusTombol();
    });

    // Keyboard shortcuts
    this._area.addEventListener('keydown', (e) => {
      if (this._opsi.readonly) { e.preventDefault(); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      const map = { b: 'bold', i: 'italic', u: 'underline', z: e.shiftKey ? 'redo' : 'undo' };
      const tool = map[e.key.toLowerCase()];
      if (tool) { e.preventDefault(); this._eksekusiTool(tool); }
    });

    // Update status tombol saat seleksi berubah
    this._area.addEventListener('keyup',   () => this._perbaruiStatusTombol());
    this._area.addEventListener('mouseup', () => this._perbaruiStatusTombol());

    // onFokus / onBlur
    this._area.addEventListener('focus', () => this._opsi.onFokus?.());
    this._area.addEventListener('blur',  () => this._opsi.onBlur?.());
  }

  // ─────────────────────────────────────────────
  // Eksekusi tool
  // ─────────────────────────────────────────────

  _eksekusiTool(namaTool) {
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
        this._tampilkanModal(this._modalTautan, this._inputUrl);
        break;
      case 'insertImage':
        this._simpanSeleksi();
        this._tampilkanModal(this._modalGambar, this._inputSrc);
        break;
      default:
        // Perintah standar execCommand
        document.execCommand(def.perintah, false, def.nilai ?? null);
    }
  }

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
    // Sembunyikan semua modal lain dulu
    for (const m of this._kontainer.querySelectorAll('.wanuky-rte__modal')) {
      m.hidden = true;
    }
    // Reset field input
    for (const input of modal.querySelectorAll('input')) input.value = '';
    modal.hidden = false;
    inputFokus?.focus();
  }

  _sembunyikanModal(modal) {
    modal.hidden = true;
    this._seleksiTersimpan = null;
    this._area.focus();
  }

  _terapkanTautan() {
    const url = this._inputUrl?.value.trim();
    if (!url || /^\s*javascript:/i.test(url)) {
      this._inputUrl?.focus();
      return;
    }

    const teks = this._inputTeks?.value.trim();
    this._sembunyikanModal(this._modalTautan);
    this._pulihkanSeleksi();

    // Jika ada teks kustom dan tidak ada seleksi aktif, buat seleksi baru
    const sel = window.getSelection();
    if (teks && (!sel.rangeCount || sel.getRangeAt(0).collapsed)) {
      // Sisipkan teks tautan baru sebagai node teks, lalu seleksi untuk createLink
      const node = document.createTextNode(teks);
      const range = document.createRange();
      sel.getRangeAt(0)?.insertNode(node);
      range.selectNode(node);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    document.execCommand('createLink', false, url);
    this._jadwalkanKallback();
  }

  _terapkanGambar() {
    const src = this._inputSrc?.value.trim();
    if (!src || /^\s*javascript:/i.test(src)) {
      this._inputSrc?.focus();
      return;
    }

    const alt = this._inputAlt?.value.trim() ?? '';
    this._sembunyikanModal(this._modalGambar);
    this._pulihkanSeleksi();
    document.execCommand('insertImage', false, src);

    // Tambahkan alt text pada gambar yang baru disisipkan
    const gambarBaru = this._area.querySelector('img:not([alt])') ??
                       this._area.querySelector(`img[src="${src}"]`);
    if (gambarBaru && alt) gambarBaru.setAttribute('alt', alt);

    this._jadwalkanKallback();
  }

  _perbaruiStatusTombol() {
    for (const tombol of this._toolbar.querySelectorAll('.wanuky-rte__tombol')) {
      const def = DEFINISI_TOOL[tombol.dataset.tool];
      if (!def?.tag) continue;
      const aktif = document.queryCommandState(def.perintah);
      tombol.classList.toggle('wanuky-rte__tombol--aktif', aktif);
      tombol.setAttribute('aria-pressed', String(aktif));
    }
  }

  _perbaruiCounter(jumlah) {
    if (!this._counter) return;
    const maks = this._opsi.maxLength;
    this._counter.textContent = `${jumlah} / ${maks}`;
    this._counter.classList.toggle('wanuky-rte__counter--hampir-penuh', jumlah >= maks * 0.9);
    this._counter.classList.toggle('wanuky-rte__counter--penuh', jumlah >= maks);
  }

  _jadwalkanKallback() {
    if (!this._opsi.onUbah) return;
    clearTimeout(this._timerDebounce);
    this._timerDebounce = setTimeout(() => {
      this._opsi.onUbah(this.getNilai());
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
   * @returns {{ html: string, teks: string }}
   */
  getNilai() {
    const html = sanitasiHtml(this._area.innerHTML);
    return { html, teks: htmlKePlainText(html) };
  }

  /**
   * Mengisi editor dengan konten HTML.
   * @param {string} html
   */
  setNilai(html) {
    this._area.innerHTML = sanitasiHtml(html);
    if (this._counter) {
      const { teks } = this.getNilai();
      this._perbaruiCounter(teks.length);
    }
  }

  /** Mengosongkan semua konten editor. */
  kosongkan() {
    this._area.innerHTML = '';
    this._perbaruiCounter(0);
    this._jadwalkanKallback();
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

  /** Menghancurkan editor dan membersihkan DOM. */
  hancurkan() {
    clearTimeout(this._timerDebounce);
    this._kontainer.innerHTML = '';
    this._kontainer.classList.remove('wanuky-rte', 'wanuky-rte--readonly');
  }
}
