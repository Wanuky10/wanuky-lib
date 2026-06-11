/**
 * ImageEditor v2.0.0
 *
 * Editor gambar berbasis Canvas API untuk browser.
 * Mendukung: rotasi, flip, zoom, crop (rect/circle), filter warna,
 * preset filter, rasio aspek crop, history/undo, event system,
 * pinch-to-zoom, dan rotasi bebas.
 *
 * @module @wanuky10/web-editor/imageEditor
 * @version 2.0.0
 * @license MIT
 *
 * @adr     Menggunakan CanvasRenderingContext2D.filter (CSS filter) untuk semua filter warna
 * @context Pixel manipulation (getImageData/putImageData) lambat di gambar besar; CSS filter
 *          di-GPU-accelerated dan mendukung lebih banyak efek (blur, hue-rotate, dsb.)
 * @decision ctx.filter diterapkan sebelum ctx.drawImage; semua efek digabung dalam satu string
 * @tradeoff Memerlukan browser modern (Chrome 47+, Firefox 49+, Safari 18+); pada browser lama
 *           filter warna tidak akan berpengaruh namun editor tetap berfungsi
 * @alternatives Pixel manipulation (ditolak: O(n) per pixel, tidak bisa blur/hue secara efisien),
 *               WebGL (ditolak: kompleksitas tinggi untuk scope ini)
 */

// ─────────────────────────────────────────────────────────────
// Konstanta
// ─────────────────────────────────────────────────────────────

/** Versi library. */
const VERSI = '2.0.0';

/** Nilai step zoom per satu aksi. */
const FAKTOR_ZOOM_LANGKAH = 0.15;

/** Batas zoom minimum dan maksimum. */
const ZOOM_MIN  = 1;
const ZOOM_MAKS = 5;

/** Ukuran maksimum kanvas default (dapat di-override via opsi). */
const KANVAS_LEBAR_MAKS   = 800;
const KANVAS_TINGGI_MAKS  = 480;

/** Batas jumlah riwayat (history). */
const BATAS_HISTORY = 20;

/** Lebar handle drag crop dalam piksel. */
const UKURAN_HANDLE = 10;

/**
 * Definisi setiap tool yang tersedia.
 * - slider     : tool ini membuka panel filter (toggle).
 * - toggle     : tool ini adalah tombol toggle on/off.
 * - khusus     : tool ini dirender secara kustom (bukan tombol biasa).
 * - tipe       : jenis rendering khusus.
 */
const DEFINISI_FITUR = {
  rotasiKiri:  { label: 'Putar kiri 90°',   ikon: '↺' },
  rotasiKanan: { label: 'Putar kanan 90°',  ikon: '↻' },
  flipH:       { label: 'Cermin horizontal',ikon: '⇔' },
  flipV:       { label: 'Cermin vertikal',  ikon: '⇕' },
  zoomMasuk:   { label: 'Perbesar',         ikon: '+' },
  zoomKeluar:  { label: 'Perkecil',         ikon: '−' },
  zoomReset:   { label: 'Reset zoom',       ikon: '⊡' },
  // Filter warna — semua membuka panel filter yang sama
  brightness:  { label: 'Kecerahan',        ikon: '☀', slider: true },
  contrast:    { label: 'Kontras',           ikon: '◑', slider: true },
  saturasi:    { label: 'Saturasi',          ikon: '🎨', slider: true },
  hue:         { label: 'Hue',               ikon: '⬡', slider: true },
  blur:        { label: 'Blur',              ikon: '◌', slider: true },
  grayscale:   { label: 'Abu-abu',           ikon: '▣', slider: true },
  sepia:       { label: 'Sepia',             ikon: '▤', slider: true },
  // Rotasi bebas
  rotasiSudut: { label: 'Rotasi bebas',     ikon: '⤵', khusus: true, tipe: 'panel-rotasi' },
  // Preset filter
  preset:      { label: 'Preset filter',    ikon: '★', khusus: true, tipe: 'dropdown-preset' },
  // Rasio aspek crop
  aspekRasio:  { label: 'Rasio crop',       ikon: '▭', khusus: true, tipe: 'dropdown-aspek' },
  // Crop
  crop:        { label: 'Mode crop',        ikon: '⊹', toggle: true },
  // Aksi
  undo:        { label: 'Urungkan (Ctrl+Z)',ikon: '↩' },
  reset:       { label: 'Reset semua',      ikon: '⟳' },
  simpan:      { label: 'Simpan',           ikon: '💾' },
};

/**
 * Preset daftar tool untuk tiga mode penggunaan.
 * '|' digunakan sebagai separator (divider).
 */
const PRESET_FITUR = {
  minimal:  ['crop', '|', 'simpan'],
  standard: [
    'rotasiKiri', 'rotasiKanan', '|',
    'flipH', '|',
    'brightness', 'contrast', '|',
    'crop', '|',
    'undo', 'reset', 'simpan',
  ],
  full: [
    'rotasiKiri', 'rotasiKanan', '|',
    'flipH', 'flipV', '|',
    'zoomMasuk', 'zoomKeluar', 'zoomReset', '|',
    'brightness', 'contrast', 'saturasi', 'hue', 'blur', 'grayscale', 'sepia', '|',
    'preset', '|',
    'rotasiSudut', '|',
    'crop', 'aspekRasio', '|',
    'undo', '|',
    'reset', 'simpan',
  ],
};

/**
 * Preset filter warna bawaan.
 * Nilai:
 *   brightness, contrast, saturasi: -100 s/d 100 (0 = netral)
 *   hue: -180 s/d 180 (derajat)
 *   blur: 0 s/d 10 (piksel)
 *   grayscale, sepia: 0 s/d 100 (persen)
 */
const PRESET_FILTER = {
  original: { brightness: 0,   contrast: 0,  saturasi: 0,   hue: 0,   blur: 0, grayscale: 0,  sepia: 0  },
  vivid:    { brightness: 10,  contrast: 20, saturasi: 50,  hue: 0,   blur: 0, grayscale: 0,  sepia: 0  },
  warm:     { brightness: 5,   contrast: 5,  saturasi: 20,  hue: 15,  blur: 0, grayscale: 0,  sepia: 0  },
  cool:     { brightness: 0,   contrast: 10, saturasi: 20,  hue: -15, blur: 0, grayscale: 0,  sepia: 0  },
  noir:     { brightness: -10, contrast: 30, saturasi: 0,   hue: 0,   blur: 0, grayscale: 100, sepia: 0 },
  vintage:  { brightness: 5,   contrast: 10, saturasi: -20, hue: 10,  blur: 0, grayscale: 0,  sepia: 40 },
};

/**
 * Pilihan rasio aspek untuk crop.
 * nilai: angka rasio w/h; null = bebas.
 */
const PILIHAN_ASPEK_RASIO = [
  { label: 'Bebas',   nilai: null },
  { label: '1:1',     nilai: 1 },
  { label: '4:3',     nilai: 4/3 },
  { label: '3:2',     nilai: 3/2 },
  { label: '16:9',    nilai: 16/9 },
  { label: '9:16',    nilai: 9/16 },
  { label: '2:3',     nilai: 2/3 },
  { label: '3:4',     nilai: 3/4 },
];

// ─────────────────────────────────────────────────────────────
// Class utama
// ─────────────────────────────────────────────────────────────

/**
 * Editor gambar berbasis Canvas.
 *
 * @example
 * const editor = new ImageEditor(containerEl, {
 *   fiturPreset: 'full',
 *   onSelesai: (blob) => upload(blob),
 * });
 * editor.on('ubah', ({ nilai }) => console.log('berubah'));
 * editor.muatFile(file);
 */
export class ImageEditor {
  /**
   * @param {HTMLElement} kontainer - Elemen pembungkus editor
   * @param {object}      [opsi={}]
   * @param {string[]}    [opsi.fitur]          - Daftar tool custom
   * @param {'minimal'|'standard'|'full'} [opsi.fiturPreset='full'] - Preset tool
   * @param {'rect'|'circle'} [opsi.bentukCrop='rect'] - Bentuk area crop
   * @param {function}    [opsi.onSelesai]      - Callback saat simpan (Blob) — legacy, gunakan on('selesai')
   * @param {'jpeg'|'png'|'webp'} [opsi.formatOutput='jpeg'] - Format output
   * @param {number}      [opsi.kualitasOutput=0.92] - Kualitas kompresi (0–1)
   * @param {{lebar:number,tinggi:number}} [opsi.ukuranMaks] - Ukuran output maksimum
   */
  constructor(kontainer, opsi = {}) {
    this._kontainer  = kontainer;
    this._opsi       = {
      fiturPreset:    'full',
      bentukCrop:     'rect',
      formatOutput:   'jpeg',
      kualitasOutput: 0.92,
      ...opsi,
    };

    // Status gambar
    this._gambar      = null;  // HTMLImageElement
    this._gambarSrc   = null;  // string data URL / URL asli

    // Status transformasi
    this._rotasi      = 0;     // kelipatan 90°
    this._sudutBebas  = 0;     // rotasi bebas dalam derajat
    this._flipH       = false;
    this._flipV       = false;
    this._zoom        = 1;
    this._offsetX     = 0;
    this._offsetY     = 0;

    // Status filter
    this._brightness  = 0;
    this._contrast    = 0;
    this._saturasi    = 0;
    this._hue         = 0;
    this._blur        = 0;
    this._grayscale   = 0;
    this._sepia       = 0;

    // Status crop
    this._modeCrop    = false;
    this._crop        = null;   // { x, y, w, h } dalam koordinat kanvas
    this._cropAktif   = false;  // sedang menggambar crop
    this._cropHandle  = null;   // handle yang sedang di-drag

    // Rasio aspek crop
    this._rasioAspek  = null;   // null = bebas

    // Drag
    this._dragging    = false;
    this._dragAwal    = null;   // { x, y }
    this._cropAwal    = null;   // snapshot crop saat drag dimulai

    // Pinch-to-zoom
    this._sentuhan    = [];     // array TouchPoint aktif
    this._pinchJarak  = 0;

    // History/undo
    this._history     = [];
    this._historyIdx  = -1;

    // Event system
    this._listeners   = new Map([
      ['muat',    new Set()],
      ['ubah',    new Set()],
      ['selesai', new Set()],
      ['error',   new Set()],
    ]);

    // Backward compat: callback legacy
    if (this._opsi.onSelesai) this.on('selesai', this._opsi.onSelesai);

    this._bangunUI();
    this._pasangEventListener();
  }

  // ─── Event system ──────────────────────────────────────────────

  /**
   * Daftarkan listener untuk sebuah event.
   * @param {'muat'|'ubah'|'selesai'|'error'} event
   * @param {function} fn
   * @returns {this}
   */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return this;
  }

  /**
   * Hapus listener.
   * @param {string} event
   * @param {function} fn
   * @returns {this}
   */
  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
    return this;
  }

  /**
   * Emit event ke semua listener terdaftar.
   * @param {string} event
   * @param {unknown} data
   */
  emit(event, data) {
    for (const fn of (this._listeners.get(event) ?? [])) {
      try { fn(data); } catch { /* listener tidak boleh crash editor */ }
    }
  }

  // ─── History ───────────────────────────────────────────────────

  /**
   * Simpan state saat ini ke history stack.
   * Dipanggil setelah setiap aksi diskrit (rotate, flip, terapkanCrop, preset).
   * Slider hanya menyimpan pada event pointerup.
   */
  _simpanHistory() {
    // Potong branch ke depan jika ada
    this._history = this._history.slice(0, this._historyIdx + 1);

    const state = {
      rotasi:     this._rotasi,
      sudutBebas: this._sudutBebas,
      flipH:      this._flipH,
      flipV:      this._flipV,
      zoom:       this._zoom,
      offsetX:    this._offsetX,
      offsetY:    this._offsetY,
      brightness: this._brightness,
      contrast:   this._contrast,
      saturasi:   this._saturasi,
      hue:        this._hue,
      blur:       this._blur,
      grayscale:  this._grayscale,
      sepia:      this._sepia,
      crop:       this._crop ? { ...this._crop } : null,
      // Hanya simpan gambarSrc jika baru saja terapkanCrop (ditandai _historyGambar)
      gambarSrc:  this._historyGambar ?? null,
    };
    this._historyGambar = null;

    this._history.push(state);
    if (this._history.length > BATAS_HISTORY) this._history.shift();
    this._historyIdx = this._history.length - 1;
    this._updateTombolUndo();
  }

  /**
   * Kembali ke state sebelumnya (undo).
   */
  undo() {
    if (this._historyIdx <= 0) return;
    this._historyIdx--;
    const state = this._history[this._historyIdx];
    this._terapkanState(state);
    this._updateTombolUndo();
  }

  /** Terapkan objek state ke editor. */
  _terapkanState(state) {
    this._rotasi     = state.rotasi;
    this._sudutBebas = state.sudutBebas;
    this._flipH      = state.flipH;
    this._flipV      = state.flipV;
    this._zoom       = state.zoom;
    this._offsetX    = state.offsetX;
    this._offsetY    = state.offsetY;
    this._brightness = state.brightness;
    this._contrast   = state.contrast;
    this._saturasi   = state.saturasi;
    this._hue        = state.hue;
    this._blur       = state.blur;
    this._grayscale  = state.grayscale;
    this._sepia      = state.sepia;
    this._crop       = state.crop ? { ...state.crop } : null;

    if (state.gambarSrc && state.gambarSrc !== this._gambarSrc) {
      this.muatUrl(state.gambarSrc);
      return;
    }

    this._sinkronSlider();
    this._render();
    this.emit('ubah', this._ambilNilaiFilter());
  }

  /** Update status tombol undo (disabled jika tidak ada history). */
  _updateTombolUndo() {
    const btn = this._kontainer.querySelector('[data-ie-aksi="undo"]');
    if (btn) btn.disabled = this._historyIdx <= 0;
  }

  // ─── Resolusi fitur ───────────────────────────────────────────

  /** Hitung daftar fitur yang akan ditampilkan. */
  _resolveFitur() {
    if (this._opsi.fitur) return this._opsi.fitur;
    return PRESET_FITUR[this._opsi.fiturPreset] ?? PRESET_FITUR.full;
  }

  // ─── Bangun UI ────────────────────────────────────────────────

  _bangunUI() {
    this._kontainer.classList.add('wanuky-ie');

    // ── Toolbar ─────────────────────────────────────────────────
    this._toolbar = document.createElement('div');
    this._toolbar.className = 'wanuky-ie__toolbar';
    this._toolbar.setAttribute('role', 'toolbar');
    this._toolbar.setAttribute('aria-label', 'Alat editor gambar');

    const fitur = this._resolveFitur();
    // Track filter-slider tools yang ada di toolbar (untuk panel)
    this._filterToolsAktif = new Set();

    for (const item of fitur) {
      if (item === '|') {
        const sep = document.createElement('span');
        sep.className = 'wanuky-ie__sep';
        sep.setAttribute('aria-hidden', 'true');
        this._toolbar.appendChild(sep);
        continue;
      }

      const def = DEFINISI_FITUR[item];
      if (!def) continue;

      if (def.slider) this._filterToolsAktif.add(item);

      if (def.khusus) {
        const wrapper = this._buatToolKhusus(item, def);
        if (wrapper) this._toolbar.appendChild(wrapper);
        continue;
      }

      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'wanuky-ie__btn';
      btn.setAttribute('data-ie-aksi', item);
      btn.setAttribute('title', def.label);
      btn.setAttribute('aria-label', def.label);
      if (def.toggle) btn.setAttribute('aria-pressed', 'false');
      if (item === 'undo') btn.disabled = true;

      const ikon = document.createElement('span');
      ikon.setAttribute('aria-hidden', 'true');
      ikon.textContent = def.ikon;
      btn.appendChild(ikon);

      this._toolbar.appendChild(btn);
    }

    // ── Panel filter (slider) ────────────────────────────────────
    this._panelFilter = document.createElement('div');
    this._panelFilter.className = 'wanuky-ie__panel wanuky-ie__panel--filter';
    this._panelFilter.hidden = true;
    this._panelFilter.setAttribute('aria-label', 'Panel filter');
    this._bangunSliderFilter();

    // ── Panel rotasi bebas ───────────────────────────────────────
    this._panelRotasi = document.createElement('div');
    this._panelRotasi.className = 'wanuky-ie__panel wanuky-ie__panel--rotasi';
    this._panelRotasi.hidden = true;
    this._bangunSliderRotasi();

    // ── Canvas ──────────────────────────────────────────────────
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'wanuky-ie__canvas';
    this._canvas.setAttribute('role', 'img');
    this._canvas.setAttribute('aria-label', 'Area preview gambar');
    this._ctx = this._canvas.getContext('2d');

    // ── Area drop ──────────────────────────────────────────────
    this._areaDrop = document.createElement('div');
    this._areaDrop.className = 'wanuky-ie__drop';
    this._areaDrop.setAttribute('role', 'button');
    this._areaDrop.setAttribute('tabindex', '0');
    this._areaDrop.setAttribute('aria-label', 'Klik atau seret gambar ke sini');
    this._areaDrop.innerHTML =
      '<span class="wanuky-ie__drop-ikon">🖼</span>' +
      '<span class="wanuky-ie__drop-teks">Seret gambar ke sini atau klik untuk memilih</span>';

    this._inputFile = document.createElement('input');
    this._inputFile.type   = 'file';
    this._inputFile.accept = 'image/*';
    this._inputFile.style.display = 'none';
    this._inputFile.setAttribute('aria-hidden', 'true');

    this._kontainer.appendChild(this._toolbar);
    this._kontainer.appendChild(this._panelFilter);
    this._kontainer.appendChild(this._panelRotasi);
    this._kontainer.appendChild(this._canvas);
    this._kontainer.appendChild(this._areaDrop);
    this._kontainer.appendChild(this._inputFile);
  }

  /** Bangun semua slider filter di dalam panel. */
  _bangunSliderFilter() {
    const KONFIGURASI_SLIDER = [
      { id: 'brightness', label: 'Kecerahan', min: -100, max: 100, prop: '_brightness' },
      { id: 'contrast',   label: 'Kontras',   min: -100, max: 100, prop: '_contrast' },
      { id: 'saturasi',   label: 'Saturasi',  min: -100, max: 100, prop: '_saturasi' },
      { id: 'hue',        label: 'Hue',       min: -180, max: 180, prop: '_hue' },
      { id: 'blur',       label: 'Blur',      min: 0,    max: 10,  prop: '_blur' },
      { id: 'grayscale',  label: 'Abu-abu',   min: 0,    max: 100, prop: '_grayscale' },
      { id: 'sepia',      label: 'Sepia',     min: 0,    max: 100, prop: '_sepia' },
    ];

    for (const cfg of KONFIGURASI_SLIDER) {
      // Tampilkan hanya slider yang tool-nya ada di toolbar
      if (!this._filterToolsAktif.has(cfg.id)) continue;

      const baris = document.createElement('div');
      baris.className = 'wanuky-ie__slider-baris';

      const labelEl = document.createElement('label');
      const sliderId = `wanuky-ie-slider-${cfg.id}`;
      labelEl.setAttribute('for', sliderId);
      labelEl.className = 'wanuky-ie__slider-label';
      labelEl.textContent = cfg.label;

      const nilaiEl = document.createElement('span');
      nilaiEl.className = 'wanuky-ie__slider-nilai';
      nilaiEl.textContent = '0';
      nilaiEl.setAttribute('data-ie-nilai', cfg.id);

      const slider = document.createElement('input');
      slider.type       = 'range';
      slider.id         = sliderId;
      slider.className  = 'wanuky-ie__slider';
      slider.min        = cfg.min;
      slider.max        = cfg.max;
      slider.value      = 0;
      slider.step       = 1;
      slider.setAttribute('data-ie-slider', cfg.id);

      slider.addEventListener('input', () => {
        const val = Number(slider.value);
        this[cfg.prop] = val;
        nilaiEl.textContent = val;
        this._render();
        this.emit('ubah', this._ambilNilaiFilter());
      });

      // Simpan ke history hanya saat drag selesai
      slider.addEventListener('change', () => this._simpanHistory());

      baris.appendChild(labelEl);
      baris.appendChild(nilaiEl);
      baris.appendChild(slider);
      this._panelFilter.appendChild(baris);
    }

    // Tombol reset filter
    const btnReset = document.createElement('button');
    btnReset.type      = 'button';
    btnReset.className = 'wanuky-ie__btn wanuky-ie__btn--reset-filter';
    btnReset.textContent = 'Reset filter';
    btnReset.addEventListener('click', () => {
      this._resetFilter();
      this._simpanHistory();
    });
    this._panelFilter.appendChild(btnReset);
  }

  /** Bangun slider rotasi bebas. */
  _bangunSliderRotasi() {
    const baris = document.createElement('div');
    baris.className = 'wanuky-ie__slider-baris';

    const labelEl = document.createElement('label');
    labelEl.setAttribute('for', 'wanuky-ie-slider-rotasi');
    labelEl.className = 'wanuky-ie__slider-label';
    labelEl.textContent = 'Sudut rotasi';

    const nilaiEl = document.createElement('span');
    nilaiEl.className = 'wanuky-ie__slider-nilai';
    nilaiEl.textContent = '0°';
    nilaiEl.setAttribute('data-ie-nilai', 'rotasiSudut');

    const slider = document.createElement('input');
    slider.type      = 'range';
    slider.id        = 'wanuky-ie-slider-rotasi';
    slider.className = 'wanuky-ie__slider';
    slider.min       = -180;
    slider.max       = 180;
    slider.value     = 0;
    slider.step      = 1;
    slider.setAttribute('data-ie-slider', 'rotasiSudut');

    slider.addEventListener('input', () => {
      this._sudutBebas = Number(slider.value);
      nilaiEl.textContent = `${this._sudutBebas}°`;
      this._render();
      this.emit('ubah', this._ambilNilaiFilter());
    });

    slider.addEventListener('change', () => this._simpanHistory());

    baris.appendChild(labelEl);
    baris.appendChild(nilaiEl);
    baris.appendChild(slider);
    this._panelRotasi.appendChild(baris);
  }

  /** Buat elemen tool kustom (dropdown, panel). */
  _buatToolKhusus(item, def) {
    const wrapper = document.createElement('div');
    wrapper.className = `wanuky-ie__tool-khusus wanuky-ie__tool-khusus--${item}`;

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = 'wanuky-ie__btn';
    btn.setAttribute('data-ie-aksi', item);
    btn.setAttribute('title', def.label);
    btn.setAttribute('aria-label', def.label);
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    const ikon = document.createElement('span');
    ikon.setAttribute('aria-hidden', 'true');
    ikon.textContent = def.ikon;
    btn.appendChild(ikon);

    if (def.tipe === 'dropdown-preset') {
      const menu = this._buatMenuPreset();
      wrapper.appendChild(btn);
      wrapper.appendChild(menu);
      btn.addEventListener('click', () => this._toggleDropdown(btn, menu));
    } else if (def.tipe === 'dropdown-aspek') {
      const menu = this._buatMenuAspek();
      wrapper.appendChild(btn);
      wrapper.appendChild(menu);
      btn.addEventListener('click', () => this._toggleDropdown(btn, menu));
    } else if (def.tipe === 'panel-rotasi') {
      wrapper.appendChild(btn);
      btn.addEventListener('click', () => {
        const aktif = !this._panelRotasi.hidden;
        this._panelRotasi.hidden = aktif;
        btn.setAttribute('aria-expanded', String(!aktif));
        btn.setAttribute('aria-pressed', String(!aktif));
        btn.classList.toggle('wanuky-ie__btn--aktif', !aktif);
      });
    }

    return wrapper;
  }

  /** Buat menu dropdown preset filter. */
  _buatMenuPreset() {
    const menu = document.createElement('div');
    menu.className = 'wanuky-ie__dropdown';
    menu.hidden    = true;
    menu.setAttribute('role', 'menu');

    for (const [id, _vals] of Object.entries(PRESET_FILTER)) {
      const item = document.createElement('button');
      item.type      = 'button';
      item.className = 'wanuky-ie__dropdown-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-ie-preset', id);
      // Huruf kapital pertama
      item.textContent = id.charAt(0).toUpperCase() + id.slice(1);
      item.addEventListener('click', () => {
        this._terapkanPresetFilter(id);
        menu.hidden = true;
        const btn = menu.previousElementSibling;
        if (btn) btn.setAttribute('aria-expanded', 'false');
      });
      menu.appendChild(item);
    }

    return menu;
  }

  /** Buat menu dropdown rasio aspek crop. */
  _buatMenuAspek() {
    const menu = document.createElement('div');
    menu.className = 'wanuky-ie__dropdown';
    menu.hidden    = true;
    menu.setAttribute('role', 'menu');

    for (const pilihan of PILIHAN_ASPEK_RASIO) {
      const item = document.createElement('button');
      item.type      = 'button';
      item.className = 'wanuky-ie__dropdown-item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-ie-aspek', String(pilihan.nilai));
      item.textContent = pilihan.label;
      item.addEventListener('click', () => {
        this._rasioAspek = pilihan.nilai;
        // Update label tombol
        const btn = menu.previousElementSibling;
        if (btn) {
          btn.querySelector('span').textContent =
            pilihan.nilai ? `${pilihan.label}` : '▭';
          btn.setAttribute('aria-expanded', 'false');
        }
        menu.hidden = true;
        // Reset crop saat rasio berubah
        this._crop = null;
        this._render();
      });
      menu.appendChild(item);
    }

    return menu;
  }

  /** Toggle dropdown: tutup semua lain, buka/tutup target. */
  _toggleDropdown(btn, menu) {
    const aktif = !menu.hidden;
    // Tutup semua dropdown lain
    this._kontainer.querySelectorAll('.wanuky-ie__dropdown').forEach((m) => {
      m.hidden = true;
    });
    this._kontainer.querySelectorAll('[aria-expanded="true"]').forEach((b) => {
      b.setAttribute('aria-expanded', 'false');
    });
    menu.hidden = aktif;
    btn.setAttribute('aria-expanded', String(!aktif));
  }

  // ─── Event listeners ──────────────────────────────────────────

  _pasangEventListener() {
    // Toolbar clicks (delegasi)
    this._toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ie-aksi]');
      if (!btn) return;
      const aksi = btn.getAttribute('data-ie-aksi');
      this._tanganiAksi(aksi, btn);
    });

    // Canvas: drag untuk crop/pan
    this._canvas.addEventListener('pointerdown', (e) => this._mulaiDrag(e));
    this._canvas.addEventListener('pointermove', (e) => this._gerakDrag(e));
    this._canvas.addEventListener('pointerup',   (e) => this._akhiriDrag(e));
    this._canvas.addEventListener('pointercancel',(e)=> this._akhiriDrag(e));

    // Canvas: scroll untuk zoom
    this._canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? FAKTOR_ZOOM_LANGKAH : -FAKTOR_ZOOM_LANGKAH;
      this._ubahZoom(this._zoom + delta);
    }, { passive: false });

    // Pinch-to-zoom (touch)
    this._canvas.addEventListener('touchstart',  (e) => this._mulaiPinch(e), { passive: true });
    this._canvas.addEventListener('touchmove',   (e) => this._gerakPinch(e), { passive: false });
    this._canvas.addEventListener('touchend',    (e) => this._akhiriPinch(e), { passive: true });

    // Keyboard
    this._canvas.setAttribute('tabindex', '0');
    this._canvas.addEventListener('keydown', (e) => this._tanganiKeyboard(e));

    // Drop area: klik buka file picker
    this._areaDrop.addEventListener('click', () => this._inputFile.click());
    this._areaDrop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._inputFile.click();
      }
    });

    // File input
    this._inputFile.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.muatFile(file);
      e.target.value = '';
    });

    // Drag & drop ke canvas
    this._kontainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      this._kontainer.classList.add('wanuky-ie--drag-over');
    });
    this._kontainer.addEventListener('dragleave', () => {
      this._kontainer.classList.remove('wanuky-ie--drag-over');
    });
    this._kontainer.addEventListener('drop', (e) => {
      e.preventDefault();
      this._kontainer.classList.remove('wanuky-ie--drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file?.type.startsWith('image/')) this.muatFile(file);
    });

    // Tutup dropdown saat klik di luar
    document.addEventListener('click', (e) => {
      if (!this._kontainer.contains(e.target)) {
        this._kontainer.querySelectorAll('.wanuky-ie__dropdown').forEach((m) => {
          m.hidden = true;
        });
      }
    });

    // Keyboard global: Ctrl+Z untuk undo
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z' && this._kontainer.contains(document.activeElement)) {
        e.preventDefault();
        this.undo();
      }
    });
  }

  // ─── Pinch-to-zoom ────────────────────────────────────────────

  _mulaiPinch(e) {
    if (e.touches.length === 2) {
      this._sentuhan = Array.from(e.touches);
      this._pinchJarak = this._hitungJarakSentuh(e.touches);
    }
  }

  _gerakPinch(e) {
    if (e.touches.length !== 2) return;
    const jarak = this._hitungJarakSentuh(e.touches);
    const delta = (jarak - this._pinchJarak) / this._pinchJarak;
    this._pinchJarak = jarak;
    this._ubahZoom(this._zoom * (1 + delta * 0.5));
    e.preventDefault();
  }

  _akhiriPinch(e) {
    if (e.touches.length < 2) this._sentuhan = [];
  }

  _hitungJarakSentuh(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ─── Keyboard ─────────────────────────────────────────────────

  _tanganiKeyboard(e) {
    if (!this._gambar) return;
    const PAN_LANGKAH = 10;
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); this._offsetX -= PAN_LANGKAH; this._klampPan(); this._render(); break;
      case 'ArrowRight': e.preventDefault(); this._offsetX += PAN_LANGKAH; this._klampPan(); this._render(); break;
      case 'ArrowUp':    e.preventDefault(); this._offsetY -= PAN_LANGKAH; this._klampPan(); this._render(); break;
      case 'ArrowDown':  e.preventDefault(); this._offsetY += PAN_LANGKAH; this._klampPan(); this._render(); break;
      case '+':
      case '=':          this._ubahZoom(this._zoom + FAKTOR_ZOOM_LANGKAH); break;
      case '-':          this._ubahZoom(this._zoom - FAKTOR_ZOOM_LANGKAH); break;
      case '0':          this._ubahZoom(1); break;
    }
  }

  // ─── Aksi toolbar ─────────────────────────────────────────────

  _tanganiAksi(aksi, tombol) {
    if (!this._gambar && !['crop', 'undo', 'reset', 'simpan'].includes(aksi)) return;

    switch (aksi) {
      case 'rotasiKiri':
        this._putar(-90);
        break;
      case 'rotasiKanan':
        this._putar(90);
        break;
      case 'flipH':
        this._flipH = !this._flipH;
        this._simpanHistory();
        this._render();
        this.emit('ubah', this._ambilNilaiFilter());
        break;
      case 'flipV':
        this._flipV = !this._flipV;
        this._simpanHistory();
        this._render();
        this.emit('ubah', this._ambilNilaiFilter());
        break;
      case 'zoomMasuk':
        this._ubahZoom(this._zoom + FAKTOR_ZOOM_LANGKAH);
        break;
      case 'zoomKeluar':
        this._ubahZoom(this._zoom - FAKTOR_ZOOM_LANGKAH);
        break;
      case 'zoomReset':
        this._ubahZoom(1);
        break;
      case 'brightness':
      case 'contrast':
      case 'saturasi':
      case 'hue':
      case 'blur':
      case 'grayscale':
      case 'sepia':
        this._togglePanelFilter(tombol);
        break;
      case 'rotasiSudut':
        // Ditangani oleh listener kustom di _buatToolKhusus
        break;
      case 'preset':
        // Ditangani oleh listener dropdown
        break;
      case 'aspekRasio':
        // Ditangani oleh listener dropdown
        break;
      case 'crop':
        this._modeCrop = !this._modeCrop;
        this._crop     = null;
        tombol.setAttribute('aria-pressed', String(this._modeCrop));
        tombol.classList.toggle('wanuky-ie__btn--aktif', this._modeCrop);
        this._canvas.style.cursor = this._modeCrop ? 'crosshair' : 'default';
        this._render();
        break;
      case 'undo':
        this.undo();
        break;
      case 'reset':
        this._resetSemua();
        break;
      case 'simpan':
        this._simpanGambar();
        break;
    }
  }

  // ─── Toggle panel filter ──────────────────────────────────────

  _togglePanelFilter(tombol) {
    const aktif = !this._panelFilter.hidden;
    this._panelFilter.hidden = aktif;
    // Update semua tombol slider
    this._kontainer.querySelectorAll('[data-ie-aksi]').forEach((btn) => {
      const aksi = btn.getAttribute('data-ie-aksi');
      const def  = DEFINISI_FITUR[aksi];
      if (def?.slider) {
        btn.classList.toggle('wanuky-ie__btn--aktif', !aktif);
        btn.setAttribute('aria-pressed', String(!aktif));
      }
    });
  }

  // ─── CSS Filter ───────────────────────────────────────────────

  /**
   * Bangun string CSS filter dari state saat ini.
   * Dipanggil setiap render.
   * [CONFIRMED] CanvasRenderingContext2D.filter tersedia di browser modern.
   */
  _buildCSSFilter() {
    const parts = [];
    if (this._brightness !== 0) parts.push(`brightness(${100 + this._brightness}%)`);
    if (this._contrast   !== 0) parts.push(`contrast(${100 + this._contrast}%)`);
    if (this._saturasi   !== 0) parts.push(`saturate(${100 + this._saturasi}%)`);
    if (this._hue        !== 0) parts.push(`hue-rotate(${this._hue}deg)`);
    if (this._grayscale  > 0)   parts.push(`grayscale(${this._grayscale}%)`);
    if (this._sepia      > 0)   parts.push(`sepia(${this._sepia}%)`);
    if (this._blur       > 0)   parts.push(`blur(${this._blur}px)`);
    return parts.length > 0 ? parts.join(' ') : 'none';
  }

  /** Terapkan preset filter ke state dan re-render. */
  _terapkanPresetFilter(nama) {
    const preset = PRESET_FILTER[nama];
    if (!preset) return;
    this._brightness = preset.brightness;
    this._contrast   = preset.contrast;
    this._saturasi   = preset.saturasi;
    this._hue        = preset.hue;
    this._blur       = preset.blur;
    this._grayscale  = preset.grayscale;
    this._sepia      = preset.sepia;
    this._sinkronSlider();
    this._simpanHistory();
    this._render();
    this.emit('ubah', this._ambilNilaiFilter());
  }

  /** Reset semua nilai filter ke netral. */
  _resetFilter() {
    this._brightness = 0;
    this._contrast   = 0;
    this._saturasi   = 0;
    this._hue        = 0;
    this._blur       = 0;
    this._grayscale  = 0;
    this._sepia      = 0;
    this._sinkronSlider();
    this._render();
    this.emit('ubah', this._ambilNilaiFilter());
  }

  /** Sinkronkan posisi slider dengan nilai state saat ini. */
  _sinkronSlider() {
    const MAP = {
      brightness: this._brightness,
      contrast:   this._contrast,
      saturasi:   this._saturasi,
      hue:        this._hue,
      blur:       this._blur,
      grayscale:  this._grayscale,
      sepia:      this._sepia,
      rotasiSudut: this._sudutBebas,
    };
    for (const [id, val] of Object.entries(MAP)) {
      const slider = this._panelFilter.querySelector(`[data-ie-slider="${id}"]`)
        ?? this._panelRotasi.querySelector(`[data-ie-slider="${id}"]`);
      const nilaiEl = this._kontainer.querySelector(`[data-ie-nilai="${id}"]`);
      if (slider) slider.value = val;
      if (nilaiEl) nilaiEl.textContent = id === 'rotasiSudut' ? `${val}°` : val;
    }
  }

  /** Ambil objek nilai filter saat ini. */
  _ambilNilaiFilter() {
    return {
      brightness: this._brightness,
      contrast:   this._contrast,
      saturasi:   this._saturasi,
      hue:        this._hue,
      blur:       this._blur,
      grayscale:  this._grayscale,
      sepia:      this._sepia,
      rotasi:     this._rotasi,
      sudutBebas: this._sudutBebas,
      flipH:      this._flipH,
      flipV:      this._flipV,
      zoom:       this._zoom,
    };
  }

  // ─── Transformasi ─────────────────────────────────────────────

  /** Rotasi gambar dalam kelipatan 90°. */
  _putar(derajat) {
    this._rotasi = (this._rotasi + derajat + 360) % 360;
    this._crop   = null;
    this._sesuaikanUkuranKanvas();
    this._klampPan();
    this._simpanHistory();
    this._render();
    this.emit('ubah', this._ambilNilaiFilter());
  }

  /** Ubah level zoom dan klamp offsetnya. */
  _ubahZoom(nilaiBaru) {
    this._zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAKS, nilaiBaru));
    this._klampPan();
    this._render();
  }

  /** Reset semua transformasi dan filter ke kondisi awal. */
  _resetSemua() {
    this._rotasi     = 0;
    this._sudutBebas = 0;
    this._flipH      = false;
    this._flipV      = false;
    this._zoom       = 1;
    this._offsetX    = 0;
    this._offsetY    = 0;
    this._resetFilter();
    this._modeCrop   = false;
    this._crop       = null;
    const btnCrop = this._kontainer.querySelector('[data-ie-aksi="crop"]');
    if (btnCrop) {
      btnCrop.setAttribute('aria-pressed', 'false');
      btnCrop.classList.remove('wanuky-ie__btn--aktif');
      this._canvas.style.cursor = 'default';
    }
    const sliderRotasi = this._panelRotasi.querySelector('[data-ie-slider="rotasiSudut"]');
    if (sliderRotasi) sliderRotasi.value = 0;
    const nilaiRotasi = this._kontainer.querySelector('[data-ie-nilai="rotasiSudut"]');
    if (nilaiRotasi) nilaiRotasi.textContent = '0°';
    this._sesuaikanUkuranKanvas();
    this._render();
    this.emit('ubah', this._ambilNilaiFilter());
  }

  // ─── Geometri & Pan ──────────────────────────────────────────

  /** Hitung skala agar gambar fit di kanvas (di-center). */
  _skalaDasarUntukFit() {
    if (!this._gambar) return 1;
    const sudutRad = ((this._rotasi + this._sudutBebas) * Math.PI) / 180;
    const cosA     = Math.abs(Math.cos(sudutRad));
    const sinA     = Math.abs(Math.sin(sudutRad));
    const rotW     = this._gambar.naturalWidth  * cosA + this._gambar.naturalHeight * sinA;
    const rotH     = this._gambar.naturalWidth  * sinA + this._gambar.naturalHeight * cosA;
    return Math.min(
      this._canvas.width  / rotW,
      this._canvas.height / rotH,
    );
  }

  /**
   * Klamp offsetX/Y agar gambar tidak meninggalkan area hitam
   * yang terlihat di tepi kanvas.
   */
  _klampPan() {
    if (!this._gambar) return;
    const skala  = this._skalaDasarUntukFit() * this._zoom;
    const sudutRad = ((this._rotasi + this._sudutBebas) * Math.PI) / 180;
    const cosA   = Math.abs(Math.cos(sudutRad));
    const sinA   = Math.abs(Math.sin(sudutRad));
    const tampW  = (this._gambar.naturalWidth  * cosA + this._gambar.naturalHeight * sinA) * skala;
    const tampH  = (this._gambar.naturalWidth  * sinA + this._gambar.naturalHeight * cosA) * skala;
    const maks   = {
      x: Math.max(0, (tampW - this._canvas.width)  / 2),
      y: Math.max(0, (tampH - this._canvas.height) / 2),
    };
    this._offsetX = Math.max(-maks.x, Math.min(maks.x, this._offsetX));
    this._offsetY = Math.max(-maks.y, Math.min(maks.y, this._offsetY));
  }

  /** Konversi koordinat event ke koordinat kanvas. */
  _posisiKanvas(e) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  // ─── Drag (crop + pan) ────────────────────────────────────────

  _mulaiDrag(e) {
    if (!this._gambar) return;
    this._canvas.setPointerCapture(e.pointerId);
    const pos = this._posisiKanvas(e);
    this._dragging = true;

    if (this._modeCrop) {
      const handle = this._deteksiHandle(pos);
      if (handle) {
        // Resize crop yang sudah ada via handle
        this._cropHandle = handle;
        this._cropAwal   = { ...this._crop };
      } else if (
        this._crop &&
        pos.x >= this._crop.x && pos.x <= this._crop.x + this._crop.w &&
        pos.y >= this._crop.y && pos.y <= this._crop.y + this._crop.h
      ) {
        // Pindah crop yang sudah ada
        this._cropHandle = 'move';
        this._cropAwal   = { ...this._crop };
        this._dragAwal   = pos;
      } else {
        // Mulai crop baru
        this._cropHandle = null;
        this._cropAktif  = true;
        this._dragAwal   = pos;
        this._crop       = { x: pos.x, y: pos.y, w: 0, h: 0 };
      }
    } else {
      // Mode pan
      this._dragAwal = pos;
    }
  }

  _gerakDrag(e) {
    if (!this._dragging || !this._gambar) return;
    const pos = this._posisiKanvas(e);

    if (this._modeCrop) {
      if (this._cropAktif) {
        // Gambar area crop baru
        let dx = pos.x - this._dragAwal.x;
        let dy = pos.y - this._dragAwal.y;

        // Terapkan rasio aspek jika aktif
        if (this._rasioAspek) {
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          if (absDx / this._rasioAspek >= absDy) {
            dy = (absDx / this._rasioAspek) * Math.sign(dy || 1);
          } else {
            dx = absDy * this._rasioAspek * Math.sign(dx || 1);
          }
        }

        this._crop = {
          x: this._dragAwal.x,
          y: this._dragAwal.y,
          w: dx,
          h: dy,
        };
      } else if (this._cropHandle === 'move') {
        const dx = pos.x - this._dragAwal.x;
        const dy = pos.y - this._dragAwal.y;
        this._crop = {
          x: this._cropAwal.x + dx,
          y: this._cropAwal.y + dy,
          w: this._cropAwal.w,
          h: this._cropAwal.h,
        };
        this._dragAwal = pos;
        this._cropAwal = { ...this._crop };
      } else if (this._cropHandle) {
        this._resizeCropViaHandle(this._cropHandle, pos);
      }
      this._render();
    } else {
      // Pan
      this._offsetX += pos.x - this._dragAwal.x;
      this._offsetY += pos.y - this._dragAwal.y;
      this._klampPan();
      this._dragAwal = pos;
      this._render();
    }

    // Cursor saat di atas handle
    if (this._modeCrop && !this._dragging) {
      const handle = this._deteksiHandle(pos);
      this._canvas.style.cursor = handle ? 'nwse-resize' : 'crosshair';
    }
  }

  _akhiriDrag(e) {
    if (!this._dragging) return;
    this._dragging  = false;
    this._cropAktif = false;
    this._cropHandle= null;
    this._dragAwal  = null;

    if (this._modeCrop && this._crop) {
      this._normalisasiCrop();
      this._render();
    }
  }

  /** Deteksi apakah posisi ada di atas salah satu handle crop. */
  _deteksiHandle(pos) {
    if (!this._crop) return null;
    const { x, y, w, h } = this._normalisasiCropSementara();
    const handles = this._opsi.bentukCrop === 'circle'
      ? this._hitungPosisiHandleCircle(x, y, w, h)
      : this._hitungPosisiHandle(x, y, w, h);

    for (const [id, hx, hy] of handles) {
      const dx = pos.x - hx;
      const dy = pos.y - hy;
      if (Math.sqrt(dx * dx + dy * dy) <= UKURAN_HANDLE) return id;
    }
    return null;
  }

  _hitungPosisiHandle(x, y, w, h) {
    return [
      ['tl', x,       y      ],
      ['tm', x + w/2, y      ],
      ['tr', x + w,   y      ],
      ['ml', x,       y + h/2],
      ['mr', x + w,   y + h/2],
      ['bl', x,       y + h  ],
      ['bm', x + w/2, y + h  ],
      ['br', x + w,   y + h  ],
    ];
  }

  _hitungPosisiHandleCircle(x, y, w, h) {
    const cx = x + w/2, cy = y + h/2;
    const rx = w/2,     ry = h/2;
    return [
      ['t',  cx,      cy - ry],
      ['r',  cx + rx, cy     ],
      ['b',  cx,      cy + ry],
      ['l',  cx - rx, cy     ],
    ];
  }

  /** Normalisasi sementara (nilai bisa negatif → ubah ke positif). */
  _normalisasiCropSementara() {
    if (!this._crop) return { x: 0, y: 0, w: 0, h: 0 };
    const { x, y, w, h } = this._crop;
    return {
      x: w < 0 ? x + w : x,
      y: h < 0 ? y + h : y,
      w: Math.abs(w),
      h: Math.abs(h),
    };
  }

  /** Normalisasi crop (tulis ulang dengan nilai positif, klamp ke kanvas). */
  _normalisasiCrop() {
    if (!this._crop) return;
    const { x, y, w, h } = this._normalisasiCropSementara();
    this._crop = {
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.min(w, this._canvas.width  - Math.max(0, x)),
      h: Math.min(h, this._canvas.height - Math.max(0, y)),
    };
  }

  /** Resize crop via handle drag. */
  _resizeCropViaHandle(handle, pos) {
    const c = { ...this._cropAwal };
    const batasKanan  = c.x + c.w;
    const batasBawah  = c.y + c.h;

    switch (handle) {
      case 'tl': this._crop = { x: pos.x, y: pos.y, w: batasKanan - pos.x, h: batasBawah - pos.y }; break;
      case 'tm': this._crop = { x: c.x, y: pos.y, w: c.w, h: batasBawah - pos.y }; break;
      case 'tr': this._crop = { x: c.x, y: pos.y, w: pos.x - c.x, h: batasBawah - pos.y }; break;
      case 'ml': this._crop = { x: pos.x, y: c.y, w: batasKanan - pos.x, h: c.h }; break;
      case 'mr': this._crop = { x: c.x, y: c.y, w: pos.x - c.x, h: c.h }; break;
      case 'bl': this._crop = { x: pos.x, y: c.y, w: batasKanan - pos.x, h: pos.y - c.y }; break;
      case 'bm': this._crop = { x: c.x, y: c.y, w: c.w, h: pos.y - c.y }; break;
      case 'br': this._crop = { x: c.x, y: c.y, w: pos.x - c.x, h: pos.y - c.y }; break;
      // Handle lingkaran
      case 't':  this._crop = { x: c.x, y: pos.y, w: c.w, h: batasBawah - pos.y }; break;
      case 'r':  this._crop = { x: c.x, y: c.y, w: pos.x - c.x, h: c.h }; break;
      case 'b':  this._crop = { x: c.x, y: c.y, w: c.w, h: pos.y - c.y }; break;
      case 'l':  this._crop = { x: pos.x, y: c.y, w: batasKanan - pos.x, h: c.h }; break;
    }

    // Terapkan rasio aspek pada handle resize (hanya corner)
    if (this._rasioAspek && ['tl', 'tr', 'bl', 'br'].includes(handle)) {
      const absW = Math.abs(this._crop.w);
      const absH = Math.abs(this._crop.h);
      // Dominan lebar → sesuaikan tinggi
      if (absW / this._rasioAspek >= absH) {
        this._crop.h = (absW / this._rasioAspek) * Math.sign(this._crop.h || 1);
      } else {
        this._crop.w = absH * this._rasioAspek * Math.sign(this._crop.w || 1);
      }
    }
  }

  // ─── Sesuaikan ukuran kanvas ──────────────────────────────────

  _sesuaikanUkuranKanvas() {
    if (!this._gambar) return;
    const sudutRad = ((this._rotasi + this._sudutBebas) * Math.PI) / 180;
    const cosA     = Math.abs(Math.cos(sudutRad));
    const sinA     = Math.abs(Math.sin(sudutRad));

    const iW = this._gambar.naturalWidth;
    const iH = this._gambar.naturalHeight;

    // Tentukan ukuran kanvas (dibatasi oleh opsi ukuranMaks atau konstanta)
    const maks = this._opsi.ukuranMaks ?? {
      lebar:  KANVAS_LEBAR_MAKS,
      tinggi: KANVAS_TINGGI_MAKS,
    };

    const rotW = iW * cosA + iH * sinA;
    const rotH = iW * sinA + iH * cosA;
    const skala = Math.min(maks.lebar / rotW, maks.tinggi / rotH, 1);

    this._canvas.width  = Math.round(rotW * skala);
    this._canvas.height = Math.round(rotH * skala);
  }

  // ─── Render ───────────────────────────────────────────────────

  _render() {
    const ctx = this._ctx;
    const W   = this._canvas.width;
    const H   = this._canvas.height;

    ctx.clearRect(0, 0, W, H);

    if (!this._gambar) return;

    const skalaFit = this._skalaDasarUntukFit();
    const skala    = skalaFit * this._zoom;
    const sudutRad = ((this._rotasi + this._sudutBebas) * Math.PI) / 180;
    const iW       = this._gambar.naturalWidth;
    const iH       = this._gambar.naturalHeight;

    ctx.save();

    // Terapkan CSS filter SEBELUM drawImage
    ctx.filter = this._buildCSSFilter();

    // Transformasi: pusat kanvas + offset pan
    ctx.translate(W / 2 + this._offsetX, H / 2 + this._offsetY);
    ctx.rotate(sudutRad);
    ctx.scale(
      this._flipH ? -skala : skala,
      this._flipV ? -skala : skala,
    );

    ctx.drawImage(this._gambar, -iW / 2, -iH / 2, iW, iH);

    ctx.restore();

    // Reset filter sebelum menggambar overlay (handle, grid)
    ctx.filter = 'none';

    // Overlay crop
    if (this._modeCrop) {
      if (this._opsi.bentukCrop === 'circle') {
        this._renderOverlayCropCircle();
      } else {
        this._renderOverlayCropRect();
      }
    }
  }

  _renderOverlayCropRect() {
    const ctx = this._ctx;
    const W   = this._canvas.width;
    const H   = this._canvas.height;

    if (!this._crop) return;
    const { x, y, w, h } = this._normalisasiCropSementara();
    if (w < 2 || h < 2) return;

    // Redupkan area di luar crop
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.clearRect(x, y, w, h);
    ctx.restore();

    // Border crop
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Grid rule-of-thirds
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + w/3, y); ctx.lineTo(x + w/3, y + h);
    ctx.moveTo(x + w*2/3, y); ctx.lineTo(x + w*2/3, y + h);
    ctx.moveTo(x, y + h/3); ctx.lineTo(x + w, y + h/3);
    ctx.moveTo(x, y + h*2/3); ctx.lineTo(x + w, y + h*2/3);
    ctx.stroke();
    ctx.restore();

    // Handle
    const handles = this._hitungPosisiHandle(x, y, w, h);
    ctx.save();
    for (const [_, hx, hy] of handles) {
      ctx.beginPath();
      ctx.arc(hx, hy, UKURAN_HANDLE / 2, 0, Math.PI * 2);
      ctx.fillStyle   = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth   = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  _renderOverlayCropCircle() {
    const ctx = this._ctx;
    const W   = this._canvas.width;
    const H   = this._canvas.height;

    if (!this._crop) return;
    const { x, y, w, h } = this._normalisasiCropSementara();
    if (w < 2 || h < 2) return;

    const cx = x + w/2, cy = y + h/2;
    const rx = w/2,     ry = h/2;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Border ellipse
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Panduan cross-hair
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy); ctx.lineTo(cx + rx, cy);
    ctx.moveTo(cx, cy - ry); ctx.lineTo(cx, cy + ry);
    ctx.stroke();
    ctx.restore();

    // Handle
    const handles = this._hitungPosisiHandleCircle(x, y, w, h);
    ctx.save();
    for (const [_, hx, hy] of handles) {
      ctx.beginPath();
      ctx.arc(hx, hy, UKURAN_HANDLE / 2, 0, Math.PI * 2);
      ctx.fillStyle   = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#333';
      ctx.lineWidth   = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── Public API ───────────────────────────────────────────────

  /**
   * Muat gambar dari objek File.
   * @param {File} file
   */
  muatFile(file) {
    if (!file?.type.startsWith('image/')) {
      this.emit('error', new Error('File bukan gambar yang valid'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const src = e.target.result;
      this._muatDariSrc(src);
    };
    reader.onerror = () => this.emit('error', new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  }

  /**
   * Muat gambar dari URL (data URL, object URL, atau URL biasa).
   * @param {string} url
   * @returns {Promise<void>}
   */
  muatUrl(url) {
    return this._muatDariSrc(url);
  }

  /** Internal: muat gambar dari string src. */
  _muatDariSrc(src) {
    return new Promise((resolve, reject) => {
      const img    = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => {
        this._gambar    = img;
        this._gambarSrc = src;
        this._resetSemua();
        this._sesuaikanUkuranKanvas();
        this._history    = [];
        this._historyIdx = -1;
        this._simpanHistory();
        this._areaDrop.hidden  = true;
        this._canvas.hidden    = false;
        this._render();
        this.emit('muat', { lebar: img.naturalWidth, tinggi: img.naturalHeight });
        resolve();
      };
      img.onerror = () => {
        const err = new Error(`Gagal memuat gambar dari src`);
        this.emit('error', err);
        reject(err);
      };
      img.src = src;
    });
  }

  /**
   * Terapkan crop yang sedang aktif ke gambar.
   * Menghasilkan gambar baru dari area crop yang dipilih.
   */
  terapkanCrop() {
    if (!this._gambar || !this._crop) return;
    this._normalisasiCrop();
    const { x, y, w, h } = this._crop;
    if (w < 1 || h < 1) return;

    const offscreen = document.createElement('canvas');
    const offCtx    = offscreen.getContext('2d');

    if (this._opsi.bentukCrop === 'circle') {
      const sisi = Math.min(w, h);
      offscreen.width  = sisi;
      offscreen.height = sisi;
      offCtx.beginPath();
      offCtx.ellipse(sisi/2, sisi/2, sisi/2, sisi/2, 0, 0, Math.PI * 2);
      offCtx.clip();
      const ox = x + (w - sisi) / 2;
      const oy = y + (h - sisi) / 2;
      offCtx.drawImage(this._canvas, ox, oy, sisi, sisi, 0, 0, sisi, sisi);
    } else {
      offscreen.width  = w;
      offscreen.height = h;
      offCtx.drawImage(this._canvas, x, y, w, h, 0, 0, w, h);
    }

    offscreen.toBlob((blob) => {
      if (!blob) return;
      const newSrc = URL.createObjectURL(blob);
      // Marconi sebelum muat: gambarSrc untuk history
      this._historyGambar = newSrc;
      this._simpanHistory();
      this._muatDariSrc(newSrc).then(() => {
        this._modeCrop = false;
        this._crop     = null;
        const btnCrop  = this._kontainer.querySelector('[data-ie-aksi="crop"]');
        if (btnCrop) {
          btnCrop.setAttribute('aria-pressed', 'false');
          btnCrop.classList.remove('wanuky-ie__btn--aktif');
          this._canvas.style.cursor = 'default';
        }
        this._render();
        this.emit('ubah', this._ambilNilaiFilter());
      });
    }, 'image/png');
  }

  /**
   * Simpan gambar ke Blob dan emit event 'selesai'.
   * @returns {Promise<Blob>}
   */
  _simpanGambar() {
    return new Promise((resolve, reject) => {
      if (!this._gambar) {
        reject(new Error('Belum ada gambar yang dimuat'));
        return;
      }

      let kanvasFinal = this._canvas;

      // Jika ada ukuranMaks output, resize
      if (this._opsi.ukuranMaks) {
        const { lebar: mL, tinggi: mT } = this._opsi.ukuranMaks;
        const skala = Math.min(mL / this._canvas.width, mT / this._canvas.height, 1);
        if (skala < 1) {
          const tmp    = document.createElement('canvas');
          tmp.width    = Math.round(this._canvas.width  * skala);
          tmp.height   = Math.round(this._canvas.height * skala);
          const tmpCtx = tmp.getContext('2d');
          tmpCtx.drawImage(this._canvas, 0, 0, tmp.width, tmp.height);
          kanvasFinal = tmp;
        }
      }

      const mime = `image/${this._opsi.formatOutput}`;
      kanvasFinal.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('Gagal menghasilkan blob')); return; }
          this.emit('selesai', blob);
          resolve(blob);
        },
        mime,
        this._opsi.kualitasOutput,
      );
    });
  }

  /**
   * Alias publik untuk simpan.
   * @returns {Promise<Blob>}
   */
  simpan() {
    return this._simpanGambar();
  }

  /**
   * Ambil data URL dari kanvas saat ini (termasuk semua filter aktif).
   * @param {'jpeg'|'png'|'webp'} [format='png']
   * @param {number} [kualitas=0.92]
   * @returns {string}
   */
  getDataUrl(format = 'png', kualitas = 0.92) {
    return this._canvas.toDataURL(`image/${format}`, kualitas);
  }

  /**
   * Dapatkan informasi editor saat ini.
   * @returns {{ lebar: number, tinggi: number, rotasi: number, sudutBebas: number, zoom: number, filter: object }}
   */
  dapatkanInfo() {
    return {
      lebar:      this._gambar?.naturalWidth  ?? 0,
      tinggi:     this._gambar?.naturalHeight ?? 0,
      rotasi:     this._rotasi,
      sudutBebas: this._sudutBebas,
      flipH:      this._flipH,
      flipV:      this._flipV,
      zoom:       this._zoom,
      filter: {
        brightness: this._brightness,
        contrast:   this._contrast,
        saturasi:   this._saturasi,
        hue:        this._hue,
        blur:       this._blur,
        grayscale:  this._grayscale,
        sepia:      this._sepia,
      },
      versi: VERSI,
    };
  }

  /**
   * Hancurkan editor: hapus semua listener dan elemen dari DOM.
   */
  hancurkan() {
    // Listener di canvas/kontainer akan di-GC bersama elemen
    this._kontainer.innerHTML = '';
    this._gambar = null;
    this._listeners.forEach((set) => set.clear());
  }
}
