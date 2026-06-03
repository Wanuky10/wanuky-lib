/**
 * ImageEditor v1.1.0 — editor gambar berbasis Canvas API native.
 *
 * Baru di v1.1.0:
 *   - Fitur modular: pilih fitur secara eksplisit via `fitur` array
 *   - Preset fitur: 'minimal' | 'standard' | 'full'
 *   - Filter brightness dan contrast via Canvas ImageData
 *   - `ukuranMaks` untuk membatasi dimensi output
 *   - Crop handles di 8 titik untuk resize area potong
 *
 * Cara pakai:
 *   import { ImageEditor } from '@wanuky/web-editor';
 *
 *   // Pilih fitur secara manual:
 *   const editor = new ImageEditor('#editor', {
 *     fitur: ['rotasiKiri', 'rotasiKanan', '|', 'crop', '|', 'save'],
 *   });
 *
 *   // Atau gunakan preset:
 *   const editor = new ImageEditor('#editor', { fiturPreset: 'minimal' });
 */

// ─────────────────────────────────────────────────────────────
// Definisi semua fitur yang tersedia
// ─────────────────────────────────────────────────────────────
const DEFINISI_FITUR = {
  rotasiKiri:  { label: 'Putar kiri 90°',    ikon: '↺'          },
  rotasiKanan: { label: 'Putar kanan 90°',   ikon: '↻'          },
  flipH:       { label: 'Flip horizontal',   ikon: '⇄'          },
  flipV:       { label: 'Flip vertikal',     ikon: '⇅'          },
  zoomMasuk:   { label: 'Perbesar',          ikon: '+'          },
  zoomKeluar:  { label: 'Perkecil',          ikon: '−'          },
  zoomReset:   { label: 'Reset zoom',        ikon: '1:1'        },
  crop:        { label: 'Mode potong',       ikon: '✂', toggle: true },
  brightness:  { label: 'Kecerahan',         ikon: '☀', slider: true },
  contrast:    { label: 'Kontras',           ikon: '◑', slider: true },
  reset:       { label: 'Reset semua',       ikon: '⟳'          },
  save:        { label: 'Simpan gambar',     ikon: '💾'         },
};

const PRESET_FITUR = {
  minimal:  ['crop', '|', 'save'],
  standard: ['rotasiKiri', 'rotasiKanan', '|', 'flipH', '|', 'crop', '|', 'reset', 'save'],
  full:     [
    'rotasiKiri', 'rotasiKanan', '|',
    'flipH', 'flipV', '|',
    'zoomMasuk', 'zoomKeluar', 'zoomReset', '|',
    'brightness', 'contrast', '|',
    'crop', '|',
    'reset', 'save',
  ],
};

const FAKTOR_ZOOM_LANGKAH = 0.1;
const ZOOM_MIN             = 0.1;
const ZOOM_MAKS            = 5;
const MIN_UKURAN_CROP      = 10;

// Ukuran handle crop dalam piksel kanvas
const UKURAN_HANDLE        = 8;

export class ImageEditor {
  /**
   * @param {string|HTMLElement} selektor
   * @param {object} [opsi]
   * @param {string[]}  [opsi.fitur]         - Array nama fitur + '|' untuk separator.
   *                                           Jika diisi, mengabaikan fiturPreset.
   *                                           Contoh: ['crop', 'rotasiKiri', '|', 'save']
   * @param {string}    [opsi.fiturPreset]   - 'minimal' | 'standard' (default) | 'full'
   * @param {Function}  [opsi.onSelesai]     - (blob: Blob) => void — dipanggil saat simpan
   * @param {string}    [opsi.formatOutput]  - 'image/jpeg' | 'image/png' | 'image/webp'
   * @param {number}    [opsi.kualitasOutput] - 0–1 untuk JPEG/WebP (default: 0.92)
   * @param {object}    [opsi.ukuranMaks]    - { lebar: number, tinggi: number } output maks
   */
  constructor(selektor, opsi = {}) {
    const kontainer =
      typeof selektor === 'string' ? document.querySelector(selektor) : selektor;

    if (!kontainer) throw new Error(`[ImageEditor] Elemen tidak ditemukan: "${selektor}"`);

    this._opsi = {
      fitur:          null,
      fiturPreset:    'standard',
      onSelesai:      null,
      formatOutput:   'image/jpeg',
      kualitasOutput: 0.92,
      ukuranMaks:     null,
      ...opsi,
    };

    this._kontainer = kontainer;
    this._gambar    = null;   // Gambar sumber saat ini (HTMLImageElement)
    this._rotasi    = 0;
    this._flipH     = false;
    this._flipV     = false;
    this._zoom      = 1;
    this._offsetX   = 0;
    this._offsetY   = 0;
    this._brightness = 0;     // -100 sampai 100
    this._contrast   = 0;     // -100 sampai 100

    this._modeCrop   = false;
    this._areaCrop   = null;  // { x, y, lebar, tinggi } koordinat kanvas
    this._handleAktif = null; // Handle crop yang sedang didrag

    this._sedangDrag    = false;
    this._titikMulaiDrag = null;

    this._bangunUI();
  }

  // ─────────────────────────────────────────────
  // Resolusi fitur
  // ─────────────────────────────────────────────

  _resolveFitur() {
    const daftar = this._opsi.fitur ?? PRESET_FITUR[this._opsi.fiturPreset] ?? PRESET_FITUR.standard;
    return daftar.filter((item) => item === '|' || item in DEFINISI_FITUR);
  }

  // ─────────────────────────────────────────────
  // Pembangunan UI
  // ─────────────────────────────────────────────

  _bangunUI() {
    this._kontainer.classList.add('wanuky-img-editor');

    this._toolbar = document.createElement('div');
    this._toolbar.className = 'wanuky-img-editor__toolbar';

    // Panel slider untuk brightness/contrast — disembunyikan kecuali dipilih
    this._panelSlider = document.createElement('div');
    this._panelSlider.className = 'wanuky-img-editor__panel-slider';
    this._panelSlider.hidden = true;

    this._sliderBrightness = this._buatSlider('Kecerahan', -100, 100, 0, (v) => {
      this._brightness = v;
      this._render();
    });
    this._sliderContrast = this._buatSlider('Kontras', -100, 100, 0, (v) => {
      this._contrast = v;
      this._render();
    });

    this._panelSlider.appendChild(this._sliderBrightness.elemen);
    this._panelSlider.appendChild(this._sliderContrast.elemen);

    const fiturAktif = this._resolveFitur();
    const adaSlider = fiturAktif.some((f) => DEFINISI_FITUR[f]?.slider);

    for (const item of fiturAktif) {
      if (item === '|') {
        const s = document.createElement('span');
        s.className = 'wanuky-img-editor__pemisah';
        s.setAttribute('aria-hidden', 'true');
        this._toolbar.appendChild(s);
        continue;
      }

      const def = DEFINISI_FITUR[item];

      if (def.slider) {
        // Tombol toggle panel slider
        const tombol = document.createElement('button');
        tombol.type = 'button';
        tombol.className = 'wanuky-img-editor__tombol';
        tombol.id = `wanuky-ie-${item}`;
        tombol.textContent = def.ikon;
        tombol.setAttribute('aria-label', def.label);
        tombol.setAttribute('title', def.label);
        tombol.setAttribute('aria-pressed', 'false');
        this._toolbar.appendChild(tombol);
        continue;
      }

      const tombol = document.createElement('button');
      tombol.type = 'button';
      tombol.className = 'wanuky-img-editor__tombol';
      tombol.id = `wanuky-ie-${item}`;
      tombol.textContent = def.ikon;
      tombol.setAttribute('aria-label', def.label);
      tombol.setAttribute('title', def.label);
      if (def.toggle) tombol.setAttribute('aria-pressed', 'false');
      this._toolbar.appendChild(tombol);
    }

    // Canvas
    this._kanvas = document.createElement('canvas');
    this._kanvas.className = 'wanuky-img-editor__kanvas';
    this._kanvas.setAttribute('role', 'img');
    this._kanvas.setAttribute('aria-label', 'Preview gambar');
    this._ctx = this._kanvas.getContext('2d', { willReadFrequently: true });

    // Zona drop
    this._zonaDrop = document.createElement('div');
    this._zonaDrop.className = 'wanuky-img-editor__zona-drop';
    this._zonaDrop.setAttribute('role', 'button');
    this._zonaDrop.setAttribute('tabindex', '0');
    this._zonaDrop.setAttribute('aria-label', 'Klik atau seret gambar ke sini');
    this._zonaDrop.innerHTML = '<span>Klik atau seret gambar ke sini</span>';

    // Input file tersembunyi
    this._inputFile = document.createElement('input');
    this._inputFile.type = 'file';
    this._inputFile.accept = 'image/*';
    this._inputFile.style.display = 'none';
    this._inputFile.setAttribute('aria-hidden', 'true');

    this._kontainer.appendChild(this._toolbar);
    if (adaSlider) this._kontainer.appendChild(this._panelSlider);
    this._kontainer.appendChild(this._zonaDrop);
    this._kontainer.appendChild(this._kanvas);
    this._kontainer.appendChild(this._inputFile);

    this._kanvas.style.display = 'none';
    this._pasangEventListener();
  }

  _buatSlider(label, min, maks, nilaiAwal, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'wanuky-img-editor__slider-wrap';

    const labelEl = document.createElement('label');
    labelEl.textContent = label;

    const input = document.createElement('input');
    input.type  = 'range';
    input.min   = String(min);
    input.max   = String(maks);
    input.value = String(nilaiAwal);
    input.className = 'wanuky-img-editor__slider';
    input.setAttribute('aria-label', label);

    const nilai = document.createElement('span');
    nilai.className = 'wanuky-img-editor__slider-nilai';
    nilai.textContent = String(nilaiAwal);

    input.addEventListener('input', () => {
      const v = Number(input.value);
      nilai.textContent = String(v);
      onChange(v);
    });

    wrap.appendChild(labelEl);
    wrap.appendChild(input);
    wrap.appendChild(nilai);

    return { elemen: wrap, input };
  }

  _pasangEventListener() {
    // Zona drop
    this._zonaDrop.addEventListener('click', () => this._inputFile.click());
    this._zonaDrop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this._inputFile.click();
    });
    this._zonaDrop.addEventListener('dragover', (e) => {
      e.preventDefault();
      this._zonaDrop.classList.add('wanuky-img-editor__zona-drop--aktif');
    });
    this._zonaDrop.addEventListener('dragleave', () => {
      this._zonaDrop.classList.remove('wanuky-img-editor__zona-drop--aktif');
    });
    this._zonaDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      this._zonaDrop.classList.remove('wanuky-img-editor__zona-drop--aktif');
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith('image/')) this.muatFile(file);
    });

    this._inputFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.muatFile(file);
    });

    // Toolbar
    this._toolbar.addEventListener('click', (e) => {
      const tombol = e.target.closest('.wanuky-img-editor__tombol');
      if (!tombol || !this._gambar) return;
      const id = tombol.id.replace('wanuky-ie-', '');
      this._tanganiAksi(id, tombol);
    });

    // Canvas pointer events
    this._kanvas.addEventListener('pointerdown', (e) => this._mulaiDrag(e));
    this._kanvas.addEventListener('pointermove', (e) => this._gerakDrag(e));
    this._kanvas.addEventListener('pointerup',   (e) => this._akhiriDrag(e));
    this._kanvas.addEventListener('pointerleave', () => {
      if (this._sedangDrag) this._akhiriDrag();
    });

    // Zoom via scroll
    this._kanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -FAKTOR_ZOOM_LANGKAH : FAKTOR_ZOOM_LANGKAH;
      this._ubahZoom(this._zoom + delta);
    }, { passive: false });
  }

  _tanganiAksi(id, tombol) {
    switch (id) {
      case 'rotasiKiri':  this._putar(-90); break;
      case 'rotasiKanan': this._putar(90); break;
      case 'flipH': this._flipH = !this._flipH; this._render(); break;
      case 'flipV': this._flipV = !this._flipV; this._render(); break;
      case 'zoomMasuk':  this._ubahZoom(this._zoom + FAKTOR_ZOOM_LANGKAH); break;
      case 'zoomKeluar': this._ubahZoom(this._zoom - FAKTOR_ZOOM_LANGKAH); break;
      case 'zoomReset':
        this._zoom = 1; this._offsetX = 0; this._offsetY = 0;
        this._render(); break;
      case 'brightness':
      case 'contrast':
        // Toggle panel slider
        this._panelSlider.hidden = !this._panelSlider.hidden;
        tombol.setAttribute('aria-pressed', String(!this._panelSlider.hidden));
        break;
      case 'crop':
        this._modeCrop = !this._modeCrop;
        this._areaCrop = null;
        this._handleAktif = null;
        tombol.setAttribute('aria-pressed', String(this._modeCrop));
        tombol.classList.toggle('wanuky-img-editor__tombol--aktif', this._modeCrop);
        this._kanvas.style.cursor = this._modeCrop ? 'crosshair' : 'grab';
        this._render(); break;
      case 'reset':  this._resetSemua(); break;
      case 'save':   this._simpanGambar(); break;
    }
  }

  // ─────────────────────────────────────────────
  // Transformasi
  // ─────────────────────────────────────────────

  _putar(derajat) {
    this._rotasi = ((this._rotasi + derajat) % 360 + 360) % 360;
    this._render();
  }

  _ubahZoom(nilai) {
    this._zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAKS, nilai));
    this._render();
  }

  _resetSemua() {
    this._rotasi = 0; this._flipH = false; this._flipV = false;
    this._zoom = 1; this._offsetX = 0; this._offsetY = 0;
    this._brightness = 0; this._contrast = 0;
    this._areaCrop = null; this._modeCrop = false; this._handleAktif = null;

    // Reset slider UI
    if (this._sliderBrightness) {
      this._sliderBrightness.input.value = '0';
      this._sliderBrightness.elemen.querySelector('.wanuky-img-editor__slider-nilai').textContent = '0';
    }
    if (this._sliderContrast) {
      this._sliderContrast.input.value = '0';
      this._sliderContrast.elemen.querySelector('.wanuky-img-editor__slider-nilai').textContent = '0';
    }

    this._render();
  }

  // ─────────────────────────────────────────────
  // Drag (crop + pan)
  // ─────────────────────────────────────────────

  _posisiKanvas(e) {
    const rect = this._kanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this._kanvas.width / rect.width),
      y: (e.clientY - rect.top)  * (this._kanvas.height / rect.height),
    };
  }

  /**
   * Mendeteksi handle crop mana yang paling dekat dengan posisi pointer.
   * Handle diidentifikasi sebagai string arah: 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'.
   * Mengembalikan null jika tidak ada handle yang cukup dekat.
   */
  _deteksiHandle(pos) {
    if (!this._areaCrop) return null;
    const { x, y, lebar, tinggi } = this._normalisasiCrop();
    const handles = this._hitungPosisiHandle(x, y, lebar, tinggi);
    for (const [nama, hx, hy] of handles) {
      const jarak = Math.hypot(pos.x - hx, pos.y - hy);
      if (jarak <= UKURAN_HANDLE * 1.5) return nama;
    }
    return null;
  }

  _hitungPosisiHandle(x, y, lebar, tinggi) {
    return [
      ['nw', x,             y              ],
      ['n',  x + lebar / 2, y              ],
      ['ne', x + lebar,     y              ],
      ['e',  x + lebar,     y + tinggi / 2 ],
      ['se', x + lebar,     y + tinggi     ],
      ['s',  x + lebar / 2, y + tinggi     ],
      ['sw', x,             y + tinggi     ],
      ['w',  x,             y + tinggi / 2 ],
    ];
  }

  _normalisasiCrop() {
    if (!this._areaCrop) return null;
    const { x, y, lebar, tinggi } = this._areaCrop;
    return {
      x:      lebar  >= 0 ? x : x + lebar,
      y:      tinggi >= 0 ? y : y + tinggi,
      lebar:  Math.abs(lebar),
      tinggi: Math.abs(tinggi),
    };
  }

  _mulaiDrag(e) {
    this._sedangDrag = true;
    this._kanvas.setPointerCapture(e.pointerId);
    const pos = this._posisiKanvas(e);

    if (this._modeCrop) {
      // Cek apakah klik mengenai handle
      const handle = this._deteksiHandle(pos);
      if (handle) {
        this._handleAktif = handle;
        this._titikMulaiDrag = pos;
      } else {
        // Mulai seleksi crop baru
        this._handleAktif = null;
        this._areaCrop = { x: pos.x, y: pos.y, lebar: 0, tinggi: 0 };
      }
    } else {
      this._titikMulaiDrag = { x: e.clientX - this._offsetX, y: e.clientY - this._offsetY };
    }
  }

  _gerakDrag(e) {
    if (!this._sedangDrag) return;
    const pos = this._posisiKanvas(e);

    if (this._modeCrop) {
      if (this._handleAktif && this._areaCrop) {
        // Resize area crop via handle
        this._resizeCropViaHandle(this._handleAktif, pos);
      } else if (this._areaCrop) {
        // Gambar seleksi baru
        this._areaCrop.lebar  = pos.x - this._areaCrop.x;
        this._areaCrop.tinggi = pos.y - this._areaCrop.y;
      }
      this._render();
    } else if (this._titikMulaiDrag) {
      this._offsetX = e.clientX - this._titikMulaiDrag.x;
      this._offsetY = e.clientY - this._titikMulaiDrag.y;
      this._render();
    }
  }

  _akhiriDrag() {
    this._sedangDrag = false;
    this._handleAktif = null;
    this._titikMulaiDrag = null;

    // Normalisasi agar lebar/tinggi selalu positif
    if (this._areaCrop) {
      const { x, y, lebar, tinggi } = this._areaCrop;
      this._areaCrop = {
        x:      lebar  >= 0 ? x : x + lebar,
        y:      tinggi >= 0 ? y : y + tinggi,
        lebar:  Math.abs(lebar),
        tinggi: Math.abs(tinggi),
      };
    }
  }

  /**
   * Mengubah ukuran area crop saat handle di-drag.
   * Setiap handle mengontrol sisi/sudut yang berbeda.
   */
  _resizeCropViaHandle(handle, pos) {
    let { x, y, lebar, tinggi } = this._normalisasiCrop();
    const kanan  = x + lebar;
    const bawah  = y + tinggi;

    if (handle.includes('n')) { y      = Math.min(pos.y, bawah - MIN_UKURAN_CROP);  tinggi = bawah - y; }
    if (handle.includes('s')) { tinggi = Math.max(pos.y - y, MIN_UKURAN_CROP); }
    if (handle.includes('w')) { x      = Math.min(pos.x, kanan - MIN_UKURAN_CROP);  lebar  = kanan - x; }
    if (handle.includes('e')) { lebar  = Math.max(pos.x - x, MIN_UKURAN_CROP); }

    this._areaCrop = { x, y, lebar, tinggi };
  }

  // ─────────────────────────────────────────────
  // Crop terapkan
  // ─────────────────────────────────────────────

  _terapkanCrop() {
    if (!this._areaCrop) return;
    const { x, y, lebar, tinggi } = this._normalisasiCrop();
    if (lebar < MIN_UKURAN_CROP || tinggi < MIN_UKURAN_CROP) return;

    const kanvasCrop = document.createElement('canvas');
    kanvasCrop.width  = lebar;
    kanvasCrop.height = tinggi;
    kanvasCrop.getContext('2d').drawImage(this._kanvas, x, y, lebar, tinggi, 0, 0, lebar, tinggi);

    const gambarBaru = new Image();
    gambarBaru.onload = () => {
      this._gambar = gambarBaru;
      this._resetSemua();
      this._sesuaikanUkuranKanvas();
      this._render();
    };
    gambarBaru.src = kanvasCrop.toDataURL();
  }

  // ─────────────────────────────────────────────
  // Filter brightness & contrast via ImageData
  // ─────────────────────────────────────────────

  /**
   * Menerapkan brightness dan contrast ke ImageData yang ada di kanvas.
   * Dipanggil setelah render dasar selesai.
   *
   * Algoritma:
   *   brightness: menambah/kurangi nilai R,G,B langsung
   *   contrast:   f = (259 * (c + 255)) / (255 * (259 - c)); pixel = f * (pixel - 128) + 128
   */
  _terapkanFilter() {
    if (this._brightness === 0 && this._contrast === 0) return;

    const lebar  = this._kanvas.width;
    const tinggi = this._kanvas.height;
    const imgData = this._ctx.getImageData(0, 0, lebar, tinggi);
    const data    = imgData.data;

    const b = this._brightness;
    // Faktor kontras berdasarkan formula standar — hindari pembagian nol
    const c = this._contrast;
    const fKontras = c !== -255
      ? (259 * (c + 255)) / (255 * (259 - c))
      : 0;

    for (let i = 0; i < data.length; i += 4) {
      // Brightness
      let r = data[i]     + b;
      let g = data[i + 1] + b;
      let bl = data[i + 2] + b;

      // Contrast
      if (c !== 0) {
        r  = fKontras * (r  - 128) + 128;
        g  = fKontras * (g  - 128) + 128;
        bl = fKontras * (bl - 128) + 128;
      }

      // Clamp ke 0–255
      data[i]     = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, bl));
      // Alpha tidak diubah
    }

    this._ctx.putImageData(imgData, 0, 0);
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  _sesuaikanUkuranKanvas() {
    if (!this._gambar) return;
    this._kanvas.width  = this._kontainer.clientWidth  || 600;
    this._kanvas.height = this._kontainer.clientHeight || 400;
  }

  _render() {
    if (!this._gambar || !this._ctx) return;

    const ctx    = this._ctx;
    const lebar  = this._kanvas.width;
    const tinggi = this._kanvas.height;

    ctx.clearRect(0, 0, lebar, tinggi);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, lebar, tinggi);

    ctx.save();
    ctx.translate(lebar / 2 + this._offsetX, tinggi / 2 + this._offsetY);
    ctx.rotate((this._rotasi * Math.PI) / 180);
    ctx.scale(
      this._flipH ? -this._zoom : this._zoom,
      this._flipV ? -this._zoom : this._zoom,
    );
    ctx.drawImage(this._gambar, -this._gambar.width / 2, -this._gambar.height / 2);
    ctx.restore();

    // Filter setelah render dasar selesai
    this._terapkanFilter();

    // Overlay crop
    if (this._modeCrop && this._areaCrop) {
      this._renderOverlayCrop();
    }
  }

  _renderOverlayCrop() {
    const ctx = this._ctx;
    const crop = this._normalisasiCrop();
    if (!crop) return;
    const { x, y, lebar, tinggi } = crop;

    // Overlay gelap di luar area crop
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, this._kanvas.width, this._kanvas.height);
    ctx.clearRect(x, y, lebar, tinggi);

    // Border crop
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, lebar, tinggi);
    ctx.setLineDash([]);

    // Grid rule-of-thirds
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + (lebar * i) / 3, y);
      ctx.lineTo(x + (lebar * i) / 3, y + tinggi);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y + (tinggi * i) / 3);
      ctx.lineTo(x + lebar, y + (tinggi * i) / 3);
      ctx.stroke();
    }

    // 8 handle resize
    ctx.fillStyle   = '#fff';
    ctx.strokeStyle = '#333';
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    for (const [, hx, hy] of this._hitungPosisiHandle(x, y, lebar, tinggi)) {
      ctx.beginPath();
      ctx.rect(hx - UKURAN_HANDLE / 2, hy - UKURAN_HANDLE / 2, UKURAN_HANDLE, UKURAN_HANDLE);
      ctx.fill();
      ctx.stroke();
    }
  }

  // ─────────────────────────────────────────────
  // API Publik
  // ─────────────────────────────────────────────

  /**
   * Memuat file gambar ke editor.
   * @param {File} file
   */
  muatFile(file) {
    if (!file.type.startsWith('image/')) {
      throw new Error(`[ImageEditor] Tipe file tidak didukung: ${file.type}`);
    }

    const url = URL.createObjectURL(file);
    const gambar = new Image();

    gambar.onload = () => {
      URL.revokeObjectURL(url);
      this._gambar = gambar;
      this._resetSemua();
      this._sesuaikanUkuranKanvas();
      this._render();
      this._zonaDrop.style.display = 'none';
      this._kanvas.style.display   = 'block';
    };

    gambar.onerror = () => {
      URL.revokeObjectURL(url);
      throw new Error('[ImageEditor] Gagal memuat gambar dari file.');
    };

    gambar.src = url;
  }

  /**
   * Menyimpan hasil edit sebagai Blob.
   * Jika `ukuranMaks` dikonfigurasi, output akan di-resize terlebih dahulu.
   * @returns {Promise<Blob>}
   */
  simpan() {
    return new Promise((resolve, reject) => {
      if (!this._gambar) {
        reject(new Error('[ImageEditor] Tidak ada gambar yang dimuat.'));
        return;
      }

      // Terapkan ukuranMaks jika dikonfigurasi
      const { ukuranMaks } = this._opsi;
      if (ukuranMaks) {
        const kanvasOutput = document.createElement('canvas');
        const skalaLebar   = ukuranMaks.lebar  ? Math.min(1, ukuranMaks.lebar  / this._kanvas.width)  : 1;
        const skalaTinggi  = ukuranMaks.tinggi ? Math.min(1, ukuranMaks.tinggi / this._kanvas.height) : 1;
        const skala        = Math.min(skalaLebar, skalaTinggi);
        kanvasOutput.width  = Math.round(this._kanvas.width  * skala);
        kanvasOutput.height = Math.round(this._kanvas.height * skala);
        kanvasOutput.getContext('2d').drawImage(
          this._kanvas, 0, 0, kanvasOutput.width, kanvasOutput.height,
        );
        kanvasOutput.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('[ImageEditor] Gagal mengekspor gambar.')); return; }
            this._opsi.onSelesai?.(blob);
            resolve(blob);
          },
          this._opsi.formatOutput,
          this._opsi.kualitasOutput,
        );
        return;
      }

      this._kanvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('[ImageEditor] Gagal mengekspor gambar.')); return; }
          this._opsi.onSelesai?.(blob);
          resolve(blob);
        },
        this._opsi.formatOutput,
        this._opsi.kualitasOutput,
      );
    });
  }

  _simpanGambar() {
    this.simpan().catch((err) => console.error(err.message));
  }

  /**
   * Terapkan potongan jika ada area crop aktif.
   * Dipanggil manual atau bisa dihubungkan ke tombol "Terapkan" terpisah.
   */
  terapkanCrop() {
    this._terapkanCrop();
  }

  /** Mengambil gambar hasil edit sebagai data URL. */
  getDataUrl() {
    return this._gambar ? this._kanvas.toDataURL(this._opsi.formatOutput, this._opsi.kualitasOutput) : null;
  }

  /** Menghancurkan editor dan membersihkan DOM. */
  hancurkan() {
    this._kontainer.innerHTML = '';
    this._kontainer.classList.remove('wanuky-img-editor');
    this._gambar = null;
  }
}
