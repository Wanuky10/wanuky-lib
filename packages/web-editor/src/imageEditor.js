/**
 * ImageEditor v1.2.0 — editor gambar berbasis Canvas API native.
 *
 * Baru di v1.2.0:
 *   - Image fit: zoom=1 selalu menampilkan gambar penuh (fit-to-canvas)
 *   - Canvas sizing: dimensi kanvas mengikuti aspect ratio gambar (max 800×480)
 *   - Pan clamping: gambar tidak bisa di-pan sepenuhnya keluar viewport
 *   - Crop auto-apply: simpan() otomatis menerapkan crop aktif sebelum ekspor
 *   - Opsi bentukCrop: 'rect' | 'circle' — panduan lingkaran untuk avatar profile
 *   - Crop circle: seleksi dikonstrain 1:1, overlay bulat, ekspor square
 *   - Crop rect: seleksi dikonstrain ke batas kanvas
 *   - Rotasi recalculate canvas agar dimensi selalu optimal
 *
 * Cara pakai:
 *   import { ImageEditor } from '@wanuky10/web-editor';
 *
 *   // Pilih fitur secara manual:
 *   const editor = new ImageEditor('#editor', {
 *     fitur: ['rotasiKiri', 'rotasiKanan', '|', 'crop', '|', 'reset'],
 *     bentukCrop: 'circle',
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

const FAKTOR_ZOOM_LANGKAH = 0.15;
const ZOOM_MIN             = 0.5;   // Tidak boleh lebih kecil dari 50% fit
const ZOOM_MAKS            = 5;
const MIN_UKURAN_CROP      = 10;
const UKURAN_HANDLE        = 9;     // Piksel — ukuran handle resize crop
const KANVAS_LEBAR_MAKS    = 800;   // Resolusi internal kanvas maks
const KANVAS_TINGGI_MAKS   = 480;

export class ImageEditor {
  /**
   * @param {string|HTMLElement} selektor
   * @param {object} [opsi]
   * @param {string[]}  [opsi.fitur]          - Array nama fitur + '|' untuk separator.
   * @param {string}    [opsi.fiturPreset]    - 'minimal' | 'standard' (default) | 'full'
   * @param {string}    [opsi.bentukCrop]     - 'rect' (default) | 'circle'
   *                                            'circle': tampilkan panduan lingkaran,
   *                                            simpan() auto-crop ke area lingkaran.
   * @param {Function}  [opsi.onSelesai]      - (blob: Blob) => void — dipanggil saat simpan
   * @param {string}    [opsi.formatOutput]   - 'image/jpeg' | 'image/png' | 'image/webp'
   * @param {number}    [opsi.kualitasOutput] - 0–1 untuk JPEG/WebP (default: 0.92)
   * @param {object}    [opsi.ukuranMaks]     - { lebar: number, tinggi: number } output maks
   */
  constructor(selektor, opsi = {}) {
    const kontainer =
      typeof selektor === 'string' ? document.querySelector(selektor) : selektor;

    if (!kontainer) throw new Error(`[ImageEditor] Elemen tidak ditemukan: "${selektor}"`);

    this._opsi = {
      fitur:          null,
      fiturPreset:    'standard',
      bentukCrop:     'rect',
      onSelesai:      null,
      formatOutput:   'image/jpeg',
      kualitasOutput: 0.92,
      ukuranMaks:     null,
      ...opsi,
    };

    this._kontainer  = kontainer;
    this._gambar     = null;
    this._rotasi     = 0;
    this._flipH      = false;
    this._flipV      = false;
    this._zoom       = 1;
    this._offsetX    = 0;
    this._offsetY    = 0;
    this._brightness = 0;
    this._contrast   = 0;

    this._modeCrop    = false;
    this._areaCrop    = null;
    this._handleAktif = null;

    this._sedangDrag     = false;
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
    const adaSlider  = fiturAktif.some((f) => DEFINISI_FITUR[f]?.slider);

    for (const item of fiturAktif) {
      if (item === '|') {
        const s = document.createElement('span');
        s.className = 'wanuky-img-editor__pemisah';
        s.setAttribute('aria-hidden', 'true');
        this._toolbar.appendChild(s);
        continue;
      }

      const def    = DEFINISI_FITUR[item];
      const tombol = document.createElement('button');
      tombol.type      = 'button';
      tombol.className = 'wanuky-img-editor__tombol';
      tombol.id        = `wanuky-ie-${item}`;
      tombol.textContent = def.ikon;
      tombol.setAttribute('aria-label', def.label);
      tombol.setAttribute('title', def.label);
      if (def.toggle || def.slider) tombol.setAttribute('aria-pressed', 'false');
      this._toolbar.appendChild(tombol);
    }

    this._kanvas = document.createElement('canvas');
    this._kanvas.className = 'wanuky-img-editor__kanvas';
    this._kanvas.setAttribute('role', 'img');
    this._kanvas.setAttribute('aria-label', 'Preview gambar');
    this._ctx = this._kanvas.getContext('2d', { willReadFrequently: true });

    this._zonaDrop = document.createElement('div');
    this._zonaDrop.className = 'wanuky-img-editor__zona-drop';
    this._zonaDrop.setAttribute('role', 'button');
    this._zonaDrop.setAttribute('tabindex', '0');
    this._zonaDrop.setAttribute('aria-label', 'Klik atau seret gambar ke sini');
    this._zonaDrop.innerHTML = '<span>Klik atau seret gambar ke sini</span>';

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

    this._toolbar.addEventListener('click', (e) => {
      const tombol = e.target.closest('.wanuky-img-editor__tombol');
      if (!tombol || !this._gambar) return;
      const id = tombol.id.replace('wanuky-ie-', '');
      this._tanganiAksi(id, tombol);
    });

    this._kanvas.addEventListener('pointerdown', (e) => this._mulaiDrag(e));
    this._kanvas.addEventListener('pointermove', (e) => this._gerakDrag(e));
    this._kanvas.addEventListener('pointerup',   (e) => this._akhiriDrag(e));
    this._kanvas.addEventListener('pointerleave', () => {
      if (this._sedangDrag) this._akhiriDrag();
    });

    this._kanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -FAKTOR_ZOOM_LANGKAH : FAKTOR_ZOOM_LANGKAH;
      this._ubahZoom(this._zoom + delta);
    }, { passive: false });
  }

  _tanganiAksi(id, tombol) {
    switch (id) {
      case 'rotasiKiri':  this._putar(-90); break;
      case 'rotasiKanan': this._putar(90);  break;
      case 'flipH': this._flipH = !this._flipH; this._render(); break;
      case 'flipV': this._flipV = !this._flipV; this._render(); break;
      case 'zoomMasuk':  this._ubahZoom(this._zoom + FAKTOR_ZOOM_LANGKAH); break;
      case 'zoomKeluar': this._ubahZoom(this._zoom - FAKTOR_ZOOM_LANGKAH); break;
      case 'zoomReset':
        this._zoom = 1; this._offsetX = 0; this._offsetY = 0;
        this._render(); break;
      case 'brightness':
      case 'contrast':
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
        this._render();
        break;
      case 'reset':  this._resetSemua(); break;
      case 'save':   this._simpanGambar(); break;
    }
  }

  // ─────────────────────────────────────────────
  // Transformasi
  // ─────────────────────────────────────────────

  _putar(derajat) {
    this._rotasi = ((this._rotasi + derajat) % 360 + 360) % 360;
    // Recalculate canvas agar dimensi optimal setelah rotasi 90°/270°
    this._sesuaikanUkuranKanvas();
    this._render();
  }

  _ubahZoom(nilai) {
    this._zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAKS, nilai));
    this._klampPan();
    this._render();
  }

  _resetSemua() {
    this._rotasi = 0; this._flipH = false; this._flipV = false;
    this._zoom = 1; this._offsetX = 0; this._offsetY = 0;
    this._brightness = 0; this._contrast = 0;
    this._areaCrop = null; this._modeCrop = false; this._handleAktif = null;

    if (this._sliderBrightness) {
      this._sliderBrightness.input.value = '0';
      this._sliderBrightness.elemen.querySelector('.wanuky-img-editor__slider-nilai').textContent = '0';
    }
    if (this._sliderContrast) {
      this._sliderContrast.input.value = '0';
      this._sliderContrast.elemen.querySelector('.wanuky-img-editor__slider-nilai').textContent = '0';
    }

    // Reset tombol crop ke state non-aktif
    const tombolCrop = this._toolbar.querySelector('#wanuky-ie-crop');
    if (tombolCrop) {
      tombolCrop.setAttribute('aria-pressed', 'false');
      tombolCrop.classList.remove('wanuky-img-editor__tombol--aktif');
    }
    this._kanvas.style.cursor = 'grab';

    this._render();
  }

  // ─────────────────────────────────────────────
  // Skala dasar (fit gambar ke kanvas)
  // ─────────────────────────────────────────────

  /**
   * Menghitung faktor skala agar gambar fit (contain) dalam kanvas pada zoom=1.
   * Memperhitungkan rotasi: gambar 90°/270° menukar dimensi lebar/tinggi.
   */
  _skalaDasarUntukFit() {
    if (!this._gambar) return 1;
    const diputar = this._rotasi % 180 !== 0;
    const lebarGambar  = diputar ? this._gambar.height : this._gambar.width;
    const tinggiGambar = diputar ? this._gambar.width  : this._gambar.height;
    return Math.min(
      this._kanvas.width  / lebarGambar,
      this._kanvas.height / tinggiGambar,
    );
  }

  // ─────────────────────────────────────────────
  // Pan clamping
  // ─────────────────────────────────────────────

  /**
   * Membatasi offset pan agar gambar tidak keluar sepenuhnya dari viewport.
   * Minimal 25% dimensi kanvas harus tetap tertutup gambar.
   */
  _klampPan() {
    if (!this._gambar) return;
    const skalaDasar = this._skalaDasarUntukFit();
    const diputar = this._rotasi % 180 !== 0;
    const imgLebarKanvas  = (diputar ? this._gambar.height : this._gambar.width)  * skalaDasar * this._zoom;
    const imgTinggiKanvas = (diputar ? this._gambar.width  : this._gambar.height) * skalaDasar * this._zoom;
    const cW = this._kanvas.width;
    const cH = this._kanvas.height;

    // Batas offset: gambar boleh keluar tidak lebih dari (dimensi - 25%)
    const batasX = (imgLebarKanvas  + cW) / 2 - cW  * 0.25;
    const batasY = (imgTinggiKanvas + cH) / 2 - cH  * 0.25;

    this._offsetX = Math.max(-batasX, Math.min(batasX, this._offsetX));
    this._offsetY = Math.max(-batasY, Math.min(batasY, this._offsetY));
  }

  // ─────────────────────────────────────────────
  // Drag (crop + pan)
  // ─────────────────────────────────────────────

  _posisiKanvas(e) {
    const rect = this._kanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this._kanvas.width  / rect.width),
      y: (e.clientY - rect.top)  * (this._kanvas.height / rect.height),
    };
  }

  /** Clamp posisi pointer ke dalam batas kanvas */
  _klampPosisi(pos) {
    return {
      x: Math.max(0, Math.min(this._kanvas.width,  pos.x)),
      y: Math.max(0, Math.min(this._kanvas.height, pos.y)),
    };
  }

  _deteksiHandle(pos) {
    if (!this._areaCrop) return null;
    // Mode circle hanya pakai 4 handle sudut untuk mempertahankan 1:1
    const { x, y, lebar, tinggi } = this._normalisasiCrop();
    const adaCircle = this._opsi.bentukCrop === 'circle';
    const handles   = adaCircle
      ? this._hitungPosisiHandleCircle(x, y, lebar, tinggi)
      : this._hitungPosisiHandle(x, y, lebar, tinggi);

    for (const [nama, hx, hy] of handles) {
      if (Math.hypot(pos.x - hx, pos.y - hy) <= UKURAN_HANDLE * 1.5) return nama;
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

  // Circle mode hanya 4 handle sudut (1:1 crop)
  _hitungPosisiHandleCircle(x, y, lebar, tinggi) {
    return [
      ['nw', x,         y          ],
      ['ne', x + lebar, y          ],
      ['se', x + lebar, y + tinggi ],
      ['sw', x,         y + tinggi ],
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
    const pos = this._klampPosisi(this._posisiKanvas(e));

    if (this._modeCrop) {
      const handle = this._deteksiHandle(pos);
      if (handle) {
        this._handleAktif    = handle;
        this._titikMulaiDrag = pos;
      } else {
        this._handleAktif = null;
        this._areaCrop    = { x: pos.x, y: pos.y, lebar: 0, tinggi: 0 };
      }
    } else {
      this._titikMulaiDrag = { x: e.clientX - this._offsetX, y: e.clientY - this._offsetY };
    }
  }

  _gerakDrag(e) {
    if (!this._sedangDrag) return;
    const pos = this._klampPosisi(this._posisiKanvas(e));

    if (this._modeCrop) {
      if (this._handleAktif && this._areaCrop) {
        this._resizeCropViaHandle(this._handleAktif, pos);
      } else if (this._areaCrop) {
        let dx = pos.x - this._areaCrop.x;
        let dy = pos.y - this._areaCrop.y;

        // Mode circle: paksa rasio 1:1 agar seleksi selalu persegi
        if (this._opsi.bentukCrop === 'circle') {
          const sisi = Math.max(Math.abs(dx), Math.abs(dy));
          dx = dx >= 0 ? sisi : -sisi;
          dy = dy >= 0 ? sisi : -sisi;
        }

        this._areaCrop.lebar  = dx;
        this._areaCrop.tinggi = dy;
      }
      this._render();
    } else if (this._titikMulaiDrag) {
      this._offsetX = e.clientX - this._titikMulaiDrag.x;
      this._offsetY = e.clientY - this._titikMulaiDrag.y;
      this._klampPan();
      this._render();
    }
  }

  _akhiriDrag() {
    this._sedangDrag    = false;
    this._handleAktif   = null;
    this._titikMulaiDrag = null;

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

  _resizeCropViaHandle(handle, pos) {
    let { x, y, lebar, tinggi } = this._normalisasiCrop();
    const kanan = x + lebar;
    const bawah = y + tinggi;
    const cW    = this._kanvas.width;
    const cH    = this._kanvas.height;

    if (this._opsi.bentukCrop === 'circle') {
      // Untuk circle, resize dari sudut dengan paksa 1:1
      const dx = handle.includes('e') ? pos.x - x : kanan - pos.x;
      const dy = handle.includes('s') ? pos.y - y : bawah - pos.y;
      const sisi = Math.max(Math.min(dx, dy), MIN_UKURAN_CROP);

      if (handle === 'nw') { x = kanan - sisi; y = bawah - sisi; }
      if (handle === 'ne') { y = bawah - sisi; }
      if (handle === 'sw') { x = kanan - sisi; }
      // se: x, y tidak berubah

      lebar  = sisi;
      tinggi = sisi;
    } else {
      if (handle.includes('n')) { y      = Math.min(pos.y, bawah - MIN_UKURAN_CROP); tinggi = bawah - y; }
      if (handle.includes('s')) { tinggi = Math.max(pos.y - y, MIN_UKURAN_CROP); }
      if (handle.includes('w')) { x      = Math.min(pos.x, kanan - MIN_UKURAN_CROP); lebar  = kanan - x; }
      if (handle.includes('e')) { lebar  = Math.max(pos.x - x, MIN_UKURAN_CROP); }
    }

    // Klamp ke batas kanvas
    x      = Math.max(0, Math.min(x,      cW - lebar));
    y      = Math.max(0, Math.min(y,      cH - tinggi));
    lebar  = Math.min(lebar,  cW - x);
    tinggi = Math.min(tinggi, cH - y);

    this._areaCrop = { x, y, lebar, tinggi };
  }

  // ─────────────────────────────────────────────
  // Crop terapkan (publik — bake crop ke gambar baru)
  // ─────────────────────────────────────────────

  _terapkanCrop() {
    if (!this._areaCrop) return;
    const { x, y, lebar, tinggi } = this._normalisasiCrop();
    if (lebar < MIN_UKURAN_CROP || tinggi < MIN_UKURAN_CROP) return;

    const kanvasCrop = document.createElement('canvas');
    kanvasCrop.width  = Math.round(lebar);
    kanvasCrop.height = Math.round(tinggi);
    kanvasCrop.getContext('2d').drawImage(
      this._kanvas,
      Math.round(x), Math.round(y), Math.round(lebar), Math.round(tinggi),
      0, 0, Math.round(lebar), Math.round(tinggi),
    );

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
  // Filter brightness & contrast
  // ─────────────────────────────────────────────

  _terapkanFilter() {
    if (this._brightness === 0 && this._contrast === 0) return;

    const lebar   = this._kanvas.width;
    const tinggi  = this._kanvas.height;
    const imgData = this._ctx.getImageData(0, 0, lebar, tinggi);
    const data    = imgData.data;
    const b       = this._brightness;
    const c       = this._contrast;
    const fK      = c !== -255 ? (259 * (c + 255)) / (255 * (259 - c)) : 0;

    for (let i = 0; i < data.length; i += 4) {
      let r  = data[i]     + b;
      let g  = data[i + 1] + b;
      let bl = data[i + 2] + b;

      if (c !== 0) {
        r  = fK * (r  - 128) + 128;
        g  = fK * (g  - 128) + 128;
        bl = fK * (bl - 128) + 128;
      }

      data[i]     = Math.max(0, Math.min(255, r));
      data[i + 1] = Math.max(0, Math.min(255, g));
      data[i + 2] = Math.max(0, Math.min(255, bl));
    }

    this._ctx.putImageData(imgData, 0, 0);
  }

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────

  /**
   * Menghitung dimensi kanvas optimal berdasarkan aspect ratio gambar.
   * Canvas selalu fit dalam batas KANVAS_LEBAR_MAKS × KANVAS_TINGGI_MAKS.
   * Rotasi 90°/270° menukar dimensi lebar/tinggi gambar.
   */
  _sesuaikanUkuranKanvas() {
    if (!this._gambar) return;
    const img     = this._gambar;
    const diputar = this._rotasi % 180 !== 0;
    const lebarEf  = diputar ? img.height : img.width;
    const tinggiEf = diputar ? img.width  : img.height;

    // Skala agar fit dalam batas maks, tidak memperbesar gambar kecil
    const skala = Math.min(
      KANVAS_LEBAR_MAKS  / lebarEf,
      KANVAS_TINGGI_MAKS / tinggiEf,
      1,
    );

    this._kanvas.width  = Math.round(lebarEf  * skala);
    this._kanvas.height = Math.round(tinggiEf * skala);
  }

  _render() {
    if (!this._gambar || !this._ctx) return;

    const ctx    = this._ctx;
    const cW     = this._kanvas.width;
    const cH     = this._kanvas.height;
    const sd     = this._skalaDasarUntukFit();

    ctx.clearRect(0, 0, cW, cH);
    // Background kanvas — warna gelap netral
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, cW, cH);

    ctx.save();
    ctx.translate(cW / 2 + this._offsetX, cH / 2 + this._offsetY);
    ctx.rotate((this._rotasi * Math.PI) / 180);
    ctx.scale(
      (this._flipH ? -1 : 1) * sd * this._zoom,
      (this._flipV ? -1 : 1) * sd * this._zoom,
    );
    ctx.drawImage(this._gambar, -this._gambar.width / 2, -this._gambar.height / 2);
    ctx.restore();

    // Terapkan filter setelah render dasar
    this._terapkanFilter();

    // Overlay crop aktif
    if (this._modeCrop && this._areaCrop) {
      if (this._opsi.bentukCrop === 'circle') {
        this._renderOverlayCropCircle();
      } else {
        this._renderOverlayCropRect();
      }
    } else if (!this._modeCrop && this._opsi.bentukCrop === 'circle') {
      // Panduan lingkaran persisten — selalu tampil di circle mode
      this._renderPanduanCircle();
    }
  }

  // Overlay gelap + seleksi persegi dengan grid rule-of-thirds
  _renderOverlayCropRect() {
    const ctx  = this._ctx;
    const crop = this._normalisasiCrop();
    if (!crop) return;
    const { x, y, lebar, tinggi } = crop;
    const cW = this._kanvas.width;
    const cH = this._kanvas.height;

    // Overlay di luar area crop — even-odd fill rule untuk "lubang" di crop area
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, cW, cH);
    ctx.rect(x, y, lebar, tinggi);
    ctx.fill('evenodd');
    ctx.restore();

    // Border crop dashed
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, lebar, tinggi);
    ctx.setLineDash([]);

    // Grid rule-of-thirds
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 0.8;
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
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([]);
    for (const [, hx, hy] of this._hitungPosisiHandle(x, y, lebar, tinggi)) {
      ctx.beginPath();
      ctx.rect(hx - UKURAN_HANDLE / 2, hy - UKURAN_HANDLE / 2, UKURAN_HANDLE, UKURAN_HANDLE);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Overlay gelap + seleksi lingkaran (circle crop mode)
  _renderOverlayCropCircle() {
    const ctx  = this._ctx;
    const crop = this._normalisasiCrop();
    if (!crop) return;
    const sisi = Math.min(crop.lebar, crop.tinggi);
    const cx   = crop.x + sisi / 2;
    const cy   = crop.y + sisi / 2;
    const r    = sisi / 2;
    const cW   = this._kanvas.width;
    const cH   = this._kanvas.height;

    // Overlay gelap di luar lingkaran
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, cW, cH);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.restore();

    // Border lingkaran
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Garis panduan tengah (crosshair)
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // 4 handle sudut (1:1 saja)
    const sudut = [
      [crop.x,          crop.y          ],
      [crop.x + sisi,   crop.y          ],
      [crop.x + sisi,   crop.y + sisi   ],
      [crop.x,          crop.y + sisi   ],
    ];
    ctx.fillStyle   = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth   = 1;
    for (const [hx, hy] of sudut) {
      ctx.beginPath();
      ctx.rect(hx - UKURAN_HANDLE / 2, hy - UKURAN_HANDLE / 2, UKURAN_HANDLE, UKURAN_HANDLE);
      ctx.fill();
      ctx.stroke();
    }
  }

  /**
   * Panduan lingkaran persisten — tampil di circle mode saat belum ada seleksi aktif.
   * Membantu user memposisikan wajah ke dalam lingkaran.
   */
  _renderPanduanCircle() {
    const ctx = this._ctx;
    const cW  = this._kanvas.width;
    const cH  = this._kanvas.height;
    const r   = Math.min(cW, cH) / 2 - 6;  // 6px margin dari tepi
    const cx  = cW / 2;
    const cy  = cH / 2;

    // Overlay gelap di luar lingkaran
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, cW, cH);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.restore();

    // Border lingkaran — solid tipis berwarna emas (sesuai design system)
    ctx.strokeStyle = 'rgba(153,108,65,0.85)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // Crosshair panduan di pusat
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.2, cy); ctx.lineTo(cx + r * 0.2, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.2); ctx.lineTo(cx, cy + r * 0.2);
    ctx.stroke();
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

    const url    = URL.createObjectURL(file);
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
   *
   * Prioritas ekspor:
   * 1. Jika ada area crop aktif → crop area tersebut (circle: lingkaran → square)
   * 2. Jika bentukCrop=circle tanpa crop → crop square dari tengah kanvas
   * 3. Tanpa crop → seluruh kanvas
   * 4. Jika ukuranMaks dikonfigurasi → scale-down output
   *
   * @returns {Promise<Blob>}
   */
  simpan() {
    return new Promise((resolve, reject) => {
      if (!this._gambar) {
        reject(new Error('[ImageEditor] Tidak ada gambar yang dimuat.'));
        return;
      }

      let kanvasEkspor = this._kanvas;

      // — Kasus 1: Ada seleksi crop aktif —
      const crop = this._normalisasiCrop();
      if (crop && crop.lebar >= MIN_UKURAN_CROP && crop.tinggi >= MIN_UKURAN_CROP) {
        const sisi = this._opsi.bentukCrop === 'circle'
          ? Math.min(crop.lebar, crop.tinggi)  // paksa square untuk circle
          : null;

        const srcX = Math.round(sisi != null ? crop.x + (crop.lebar - sisi) / 2 : crop.x);
        const srcY = Math.round(sisi != null ? crop.y + (crop.tinggi - sisi) / 2 : crop.y);
        const srcW = Math.round(sisi ?? crop.lebar);
        const srcH = Math.round(sisi ?? crop.tinggi);

        const kanvasCrop = document.createElement('canvas');
        kanvasCrop.width  = srcW;
        kanvasCrop.height = srcH;
        kanvasCrop.getContext('2d').drawImage(this._kanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
        kanvasEkspor = kanvasCrop;

      // — Kasus 2: Circle mode tanpa seleksi → auto-crop square dari tengah —
      } else if (this._opsi.bentukCrop === 'circle') {
        const sisi  = Math.min(this._kanvas.width, this._kanvas.height);
        const srcX  = Math.round((this._kanvas.width  - sisi) / 2);
        const srcY  = Math.round((this._kanvas.height - sisi) / 2);
        const kanvasCircle = document.createElement('canvas');
        kanvasCircle.width  = sisi;
        kanvasCircle.height = sisi;
        kanvasCircle.getContext('2d').drawImage(this._kanvas, srcX, srcY, sisi, sisi, 0, 0, sisi, sisi);
        kanvasEkspor = kanvasCircle;
      }

      // — Terapkan ukuranMaks jika dikonfigurasi —
      const { ukuranMaks } = this._opsi;
      if (ukuranMaks) {
        const skalaW   = ukuranMaks.lebar  ? Math.min(1, ukuranMaks.lebar  / kanvasEkspor.width)  : 1;
        const skalaH   = ukuranMaks.tinggi ? Math.min(1, ukuranMaks.tinggi / kanvasEkspor.height) : 1;
        const skala    = Math.min(skalaW, skalaH);
        const kanvasMaks = document.createElement('canvas');
        kanvasMaks.width  = Math.round(kanvasEkspor.width  * skala);
        kanvasMaks.height = Math.round(kanvasEkspor.height * skala);
        kanvasMaks.getContext('2d').drawImage(kanvasEkspor, 0, 0, kanvasMaks.width, kanvasMaks.height);
        kanvasEkspor = kanvasMaks;
      }

      kanvasEkspor.toBlob(
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

  /** Terapkan crop aktif ke gambar sumber (bake). */
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
