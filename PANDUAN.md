# Panduan wanuky-lib v1.1.0

Library internal untuk proyek website pribadi. Terdiri dari dua package:

- **`@wanuky/template-engine`** — SSR template engine untuk Node.js (server-side)
- **`@wanuky/web-editor`** — Rich text editor dan image editor untuk browser (client-side)

---

## Daftar Isi

1. [Instalasi](#instalasi)
2. [Template Engine](#template-engine)
   - [Setup](#setup-template-engine)
   - [Interpolasi](#interpolasi)
   - [Include Partial](#include-partial)
   - [Layout & Slot](#layout--slot)
   - [Loop `<each>`](#loop-each)
   - [Kondisional `<if>`](#kondisional-if)
   - [File Cache](#file-cache)
3. [WebEditor](#webeditor)
   - [RichTextEditor](#richtexteditor)
   - [ImageEditor](#imageeditor)
4. [Integrasi ke Proyek](#integrasi-ke-proyek)
5. [Catatan Penting](#catatan-penting)

---

## Instalasi

### Cara 1 — `file:` (development lokal, satu mesin)

```json
"dependencies": {
  "@wanuky/template-engine": "file:../../wanuky-lib/packages/template-engine",
  "@wanuky/web-editor":       "file:../../wanuky-lib/packages/web-editor"
}
```

### Cara 2 — git+ssh (disarankan, bekerja di semua mesin)

```bash
# Di wanuky-lib: buat tag versi sekali per release
git tag v1.1.0
git push origin v1.1.0
```

```json
"dependencies": {
  "@wanuky/template-engine": "git+ssh://git@github.com/wanuky/wanuky-lib.git#v1.1.0",
  "@wanuky/web-editor":       "git+ssh://git@github.com/wanuky/wanuky-lib.git#v1.1.0"
}
```

### Cara 3 — tarball (paling stabil, tidak butuh akses git saat deploy)

```bash
# Di wanuky-lib, jalankan sekali per release:
cd packages/template-engine && npm pack --pack-destination ../../dist/
cd packages/web-editor      && npm pack --pack-destination ../../dist/
# Commit folder dist/ ke repo
```

```json
"dependencies": {
  "@wanuky/template-engine": "file:../../wanuky-lib/dist/wanuky-template-engine-1.1.0.tgz",
  "@wanuky/web-editor":       "file:../../wanuky-lib/dist/wanuky-web-editor-1.1.0.tgz"
}
```

---

## Template Engine

### Setup Template Engine

```js
// backend/config/templateEngine.js
import { buatEngine } from '@wanuky/template-engine';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const engine = buatEngine({
  dirViews:   resolve(__dirname, '../../frontend/views'),
  dirLayouts: resolve(__dirname, '../../frontend/views/layouts'),
  cache: true,  // default true — matikan saat development hot-reload
});
```

Pakai di controller:

```js
// backend/controllers/beranda/berandaController.js
import { engine } from '../../config/templateEngine.js';

export async function tampilBeranda(req, res) {
  const html = engine.render('pages/beranda/index.html', {
    judul: 'Beranda',
    pengguna: req.pengguna,
  }, 'utama'); // 'utama' = layouts/utama.html

  res.send(html);
}
```

Struktur direktori views yang diharapkan:

```
frontend/views/
├── layouts/
│   └── utama.html          ← layout utama dengan <contents></contents>
├── pages/
│   └── beranda/
│       └── index.html      ← konten halaman
└── partials/
    ├── header.html
    └── footer.html
```

---

### Interpolasi

Menyisipkan nilai dari data ke HTML. Auto-escape XSS secara otomatis.

**Sintaks:** `<{ namaVariabel }>`

```html
<!-- data: { judul: 'Selamat Datang', pengguna: { nama: 'Wahid' } } -->

<h1><{ judul }></h1>
<!-- output: <h1>Selamat Datang</h1> -->

<!-- Dot-notation untuk objek bersarang -->
<p>Halo, <{ pengguna.nama }>!</p>
<!-- output: <p>Halo, Wahid!</p> -->

<!-- Nilai tidak ada → string kosong (tidak error) -->
<p><{ tidakAda }></p>
<!-- output: <p></p> -->

<!-- XSS otomatis di-escape -->
<!-- data: { input: '<script>alert(1)</script>' } -->
<div><{ input }></div>
<!-- output: <div>&lt;script&gt;alert(1)&lt;/script&gt;</div> -->
```

**Raw HTML (tanpa escaping)** — hanya untuk konten internal yang sudah terpercaya:

```html
<!-- Prefix ! = raw mode, TIDAK di-escape -->
<!-- data: { kontenHtml: '<strong>Penting</strong>' } -->
<div><{ !kontenHtml }></div>
<!-- output: <div><strong>Penting</strong></div> -->
```

> ⚠️ Jangan gunakan `<{ !... }>` untuk input yang berasal dari pengguna.

---

### Include Partial

Menyisipkan file HTML lain secara rekursif. Path dihitung relatif dari file yang sedang di-render.

**Sintaks:** `<include="path/ke/file.html">`

```html
<!-- frontend/views/pages/beranda/index.html -->

<include="../../partials/header.html">
<include="../../partials/navigasi.html">

<main>
  <h1><{ judul }></h1>
</main>

<include="../../partials/footer.html">
```

Partial juga bisa menerima data yang sama dari konteks:

```html
<!-- frontend/views/partials/header.html -->
<header>
  <h1><{ judul }></h1>
  <if pengguna.login>
    <span>Halo, <{ pengguna.nama }></span>
  </if>
</header>
```

> Include bersifat rekursif (partial boleh include partial lain).
> Proteksi circular include aktif — batas 20 level kedalaman.

---

### Layout & Slot

Layout adalah template wrapper (HTML shell) yang dipakai bersama oleh banyak halaman.

**Slot di layout:** `<contents></contents>`

```html
<!-- frontend/views/layouts/utama.html -->
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title><{ judul }> — Nama Situs</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body>
  <include="../../partials/navbar.html">

  <main class="container">
    <contents></contents>
  </main>

  <include="../../partials/footer.html">
  <script src="/js/app.js" type="module"></script>
</body>
</html>
```

Konten halaman disisipkan otomatis ke slot `<contents></contents>`.

```js
// Render dengan layout
engine.render('pages/akun/profil.html', data, 'utama');

// Render tanpa layout (hanya view mentah)
engine.render('pages/akun/profil.html', data);

// Render string langsung tanpa file (berguna untuk email/snippet)
engine.renderString('<p>Halo <{ nama }>!</p>', { nama: 'Wahid' });
```

---

### Loop `<each>`

Mengiterasi array. Dua sintaks yang tersedia.

**Sintaks dasar:**

```html
<each namaItem in namaKoleksi>
  ... konten per item ...
</each>
```

**Sintaks dengan alias indeks:**

```html
<each namaIndeks, namaItem in namaKoleksi>
  ...
</each>
```

**Contoh:**

```html
<!-- data: { produk: [{nama:'Kopi', harga:15000}, {nama:'Teh', harga:8000}] } -->

<ul>
  <each item in produk>
    <li><{ item.nama }> — Rp <{ item.harga }></li>
  </each>
</ul>
```

**Metadata loop** — selalu tersedia tanpa konfigurasi tambahan:

```html
<each item in daftar>
  <div class="<if loop.pertama>pertama</if><if loop.terakhir> terakhir</if>">
    <span><{ loop.indeks }></span>    <!-- 0, 1, 2, ... -->
    <span><{ loop.total }></span>     <!-- total item -->
    <{ item.nama }>
  </div>
</each>
```

| Properti | Tipe | Keterangan |
|---|---|---|
| `loop.indeks` | number | Indeks saat ini (mulai dari 0) |
| `loop.pertama` | boolean | `true` jika item pertama |
| `loop.terakhir` | boolean | `true` jika item terakhir |
| `loop.total` | number | Jumlah total item |

**Dengan alias indeks eksplisit:**

```html
<!-- data: { menu: ['Beranda', 'Tentang', 'Kontak'] } -->

<each i, item in menu>
  <a href="#<{ i }}"><{ item }></a>
</each>
<!-- output: <a href="#0">Beranda</a><a href="#1">Tentang</a>... -->
```

**Nested loop:**

```html
<!-- data: { tabel: [['A', 'B'], ['C', 'D']] } -->

<table>
  <each baris in tabel>
    <tr>
      <each sel in baris>
        <td><{ sel }></td>
      </each>
    </tr>
  </each>
</table>
```

---

### Kondisional `<if>`

Menampilkan konten secara kondisional. Mendukung `<elseif>` dan `<else>`.

**Sintaks:**

```html
<if ekspresi>
  ... konten jika benar ...
<elseif ekspresi2>
  ... konten jika ekspresi2 benar ...
<else>
  ... konten jika semua false ...
</if>
```

**Ekspresi yang didukung:**

```html
<!-- Truthy check -->
<if pengguna.aktif>Akun aktif</if>

<!-- Negasi -->
<if !pengguna.aktif>Akun nonaktif</if>

<!-- Perbandingan string -->
<if pengguna.peran == admin>Panel Admin</if>
<if status != pending>Selesai</if>

<!-- Perbandingan angka -->
<if stok >= 10>Tersedia</if>
<if stok <= 0>Habis</if>

<!-- Rantai elseif -->
<if nilai >= 90>A
<elseif nilai >= 80>B
<elseif nilai >= 70>C
<elseif nilai >= 60>D
<else>E
</if>
```

**Operator yang tersedia:**

| Operator | Contoh | Keterangan |
|---|---|---|
| (truthy) | `<if aktif>` | Cek nilai truthy/falsy |
| `!` | `<if !aktif>` | Negasi |
| `==` | `<if peran == admin>` | Sama (loose) |
| `!=` | `<if status != tutup>` | Tidak sama |
| `>=` | `<if nilai >= 80>` | Lebih dari atau sama |
| `<=` | `<if stok <= 5>` | Kurang dari atau sama |
| `<` | `<if jumlah < 10>` | Kurang dari |

> **Catatan:** Operator `>` (tanpa `=`) tidak bisa dipakai di kondisi template karena `>` adalah penutup tag. Gunakan `<` sebagai gantinya (tukar posisi operan).

**Nested if:**

```html
<if pengguna.login>
  <if pengguna.peran == admin>
    <a href="/admin">Panel Admin</a>
  <else>
    <a href="/profil">Profil Saya</a>
  </if>
<else>
  <a href="/masuk">Masuk</a>
</if>
```

---

### File Cache

Template engine menyimpan konten file di memori agar tidak dibaca ulang dari disk setiap request.

```js
// Cache aktif secara default (cache: true)
const engine = buatEngine({ dirViews, dirLayouts });

// Cek jumlah file yang di-cache
console.log(engine.ukuranCache); // → 5

// Kosongkan cache — diperlukan saat file template berubah
// (berguna untuk hot-reload di development)
engine.kosongkanCache();

// Matikan cache sepenuhnya (tidak direkomendasikan di production)
const engine = buatEngine({ dirViews, dirLayouts, cache: false });
```

Untuk development dengan hot-reload, panggil `kosongkanCache()` setelah file berubah:

```js
// Contoh dengan chokidar watcher
import chokidar from 'chokidar';

chokidar.watch('frontend/views').on('change', () => {
  engine.kosongkanCache();
  console.log('[template-engine] Cache dikosongkan.');
});
```

---

## WebEditor

`@wanuky/web-editor` adalah library **khusus browser** — tidak bisa diimport di Node.js/server. Import hanya di file JavaScript frontend.

```js
// frontend/public/js/fitur/artikel/editor.js
import { RichTextEditor, ImageEditor } from '@wanuky/web-editor';
```

---

### RichTextEditor

Editor teks kaya berbasis `contenteditable`. Output: HTML + plain text.

#### Inisialisasi

```js
const rte = new RichTextEditor('#kontainer-editor', {
  // Pilihan toolbar (pilih salah satu cara):

  // Cara 1: pilih tool secara manual (urutan = urutan tampil)
  toolbar: ['bold', 'italic', 'underline', '|', 'h2', 'h3', '|', 'ul', 'ol', '|', 'link'],

  // Cara 2: gunakan preset
  toolbarPreset: 'standard', // 'minimal' | 'standard' (default) | 'full'

  // Callbacks
  onUbah: ({ html, teks }) => {
    // Dipanggil setiap kali konten berubah (debounce 300ms)
    simpanDraft(html);
  },
  onFokus: () => console.log('Editor difokuskan'),
  onBlur:  () => console.log('Editor kehilangan fokus'),

  // Opsi lain
  placeholder: 'Tulis artikel di sini...',
  debounceMs:  300,          // delay callback onUbah (ms)
  nilaiAwal:   '<p>Draft</p>', // konten HTML awal
  readonly:    false,         // mode hanya baca
  maxLength:   5000,          // batas karakter (0 = tidak terbatas)
});
```

#### Semua Tool yang Tersedia

| Nama tool | Fungsi |
|---|---|
| `bold` | **Tebal** |
| `italic` | *Miring* |
| `underline` | Garis bawah |
| `strikethrough` | ~~Coret~~ |
| `h1` | Judul 1 |
| `h2` | Judul 2 |
| `h3` | Judul 3 |
| `p` | Paragraf normal |
| `ul` | Daftar bullet |
| `ol` | Daftar nomor |
| `blockquote` | Kutipan |
| `code` | Blok kode |
| `link` | Tambah tautan (modal inline) |
| `insertImage` | Sisipkan gambar via URL |
| `removeFormat` | Hapus semua format |
| `undo` | Urungkan |
| `redo` | Ulangi |
| `\|` | Separator/pemisah toolbar |

#### Preset Toolbar

```
minimal:  bold, italic | link
standard: bold, italic, underline | h2, h3 | ul, ol | link, removeFormat
full:     semua tool
```

#### API Publik

```js
// Ambil nilai saat ini
const { html, teks } = rte.getNilai();
// html  → '<p><strong>Teks</strong></p>'
// teks  → 'Teks'

// Isi editor dengan HTML
rte.setNilai('<p>Konten baru</p>');

// Kosongkan editor
rte.kosongkan();

// Fokuskan editor
rte.fokus();

// Toggle mode readonly
rte.setReadonly(true);
rte.setReadonly(false);

// Hancurkan editor (hapus dari DOM)
rte.hancurkan();
```

#### Keyboard Shortcuts

| Shortcut | Aksi |
|---|---|
| `Ctrl/Cmd + B` | Tebal |
| `Ctrl/Cmd + I` | Miring |
| `Ctrl/Cmd + U` | Garis bawah |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |

#### Contoh Penggunaan Lengkap

```js
import { RichTextEditor } from '@wanuky/web-editor';

const editor = new RichTextEditor('#editor-artikel', {
  toolbar: ['bold', 'italic', 'underline', 'strikethrough', '|',
            'h2', 'h3', '|', 'ul', 'ol', 'blockquote', '|',
            'link', 'insertImage', 'removeFormat'],
  maxLength: 10000,
  placeholder: 'Mulai menulis artikel...',
  onUbah: ({ html, teks }) => {
    // Auto-save setiap perubahan
    fetch('/api/v1/artikel/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, teks }),
    });
  },
});

// Saat form disubmit
document.querySelector('#form-artikel').addEventListener('submit', (e) => {
  e.preventDefault();
  const { html, teks } = editor.getNilai();
  // Kirim html dan teks ke server
});
```

---

### ImageEditor

Editor gambar berbasis Canvas API. Mendukung: crop, zoom, flip, rotate, brightness, contrast.

#### Inisialisasi

```js
import { ImageEditor } from '@wanuky/web-editor';

const imgEditor = new ImageEditor('#kontainer-image-editor', {
  // Pilihan fitur (pilih salah satu cara):

  // Cara 1: pilih fitur secara manual
  fitur: ['rotasiKiri', 'rotasiKanan', '|', 'flipH', '|', 'crop', '|', 'reset', 'save'],

  // Cara 2: gunakan preset
  fiturPreset: 'standard', // 'minimal' | 'standard' (default) | 'full'

  // Callback saat simpan
  onSelesai: (blob) => {
    uploadGambar(blob);
  },

  // Format output
  formatOutput:   'image/webp',  // 'image/jpeg' (default) | 'image/png' | 'image/webp'
  kualitasOutput: 0.9,           // 0–1 untuk JPEG/WebP (default: 0.92)

  // Batasi ukuran output (opsional)
  ukuranMaks: { lebar: 1920, tinggi: 1080 },
});
```

#### Semua Fitur yang Tersedia

| Nama fitur | Fungsi |
|---|---|
| `rotasiKiri` | Putar kiri 90° |
| `rotasiKanan` | Putar kanan 90° |
| `flipH` | Flip horizontal (cermin) |
| `flipV` | Flip vertikal |
| `zoomMasuk` | Perbesar (+10%) |
| `zoomKeluar` | Perkecil (-10%) |
| `zoomReset` | Reset zoom ke 1:1 |
| `brightness` | Slider kecerahan (-100 s/d +100) |
| `contrast` | Slider kontras (-100 s/d +100) |
| `crop` | Mode potong dengan 8 resize handle |
| `reset` | Reset semua perubahan |
| `save` | Simpan dan panggil `onSelesai` |
| `\|` | Separator toolbar |

#### Preset Fitur

```
minimal:  crop | save
standard: rotasiKiri, rotasiKanan | flipH | crop | reset, save
full:     semua fitur
```

#### Interaksi Canvas

| Aksi | Cara |
|---|---|
| **Pan** (geser gambar) | Drag di canvas (mode normal) |
| **Zoom** | Scroll mouse di canvas |
| **Crop** | Aktifkan mode crop → drag untuk seleksi area |
| **Resize crop** | Tarik 8 handle di sudut/tepi area crop |

#### API Publik

```js
// Muat gambar dari file input
const fileInput = document.querySelector('#input-gambar');
fileInput.addEventListener('change', (e) => {
  imgEditor.muatFile(e.target.files[0]);
});

// Simpan hasil edit sebagai Blob (async)
const blob = await imgEditor.simpan();

// Terapkan crop yang sudah diseleksi secara programatik
imgEditor.terapkanCrop();

// Ambil hasil sebagai data URL string
const dataUrl = imgEditor.getDataUrl();

// Hancurkan editor
imgEditor.hancurkan();
```

#### Contoh Upload Gambar Profil

```js
import { ImageEditor } from '@wanuky/web-editor';

const editor = new ImageEditor('#editor-foto-profil', {
  fitur: ['rotasiKiri', 'rotasiKanan', '|', 'flipH', '|', 'crop', '|', 'reset', 'save'],
  formatOutput:   'image/webp',
  kualitasOutput: 0.85,
  ukuranMaks: { lebar: 800, tinggi: 800 },
  onSelesai: async (blob) => {
    const formData = new FormData();
    formData.append('foto', blob, 'profil.webp');

    const res = await fetch('/api/v1/pengguna/foto-profil', {
      method: 'POST',
      body: formData,
    });

    if (res.ok) tampilkanToast('Foto profil berhasil diperbarui');
  },
});

// Buka file picker saat tombol diklik
document.querySelector('#btn-ganti-foto').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => editor.muatFile(e.target.files[0]);
  input.click();
});
```

---

## Integrasi ke Proyek

### Struktur yang Direkomendasikan

```
proyek/
├── backend/
│   ├── config/
│   │   └── templateEngine.js     ← inisialisasi engine sekali
│   └── controllers/
│       └── [fitur]/
│           └── [fitur]Controller.js
└── frontend/
    ├── views/
    │   ├── layouts/
    │   │   └── utama.html         ← layout dengan <contents></contents>
    │   ├── pages/
    │   │   └── [fitur]/
    │   │       └── index.html
    │   └── partials/
    │       └── [komponen].html
    └── public/
        └── js/
            └── [fitur]/
                └── editor.js      ← import RichTextEditor / ImageEditor
```

### Pola Controller

```js
// backend/controllers/artikel/artikelController.js
import { engine } from '../../config/templateEngine.js';
import { ambilArtikel } from '../../services/artikel/artikelService.js';

export async function tampilArtikel(req, res, next) {
  try {
    const artikel = await ambilArtikel(req.params.id);
    const html = engine.render('pages/artikel/detail.html', { artikel }, 'utama');
    res.send(html);
  } catch (err) {
    next(err);
  }
}
```

### Menyimpan Output Editor ke Database

```js
// backend/controllers/artikel/simpanArtikelController.js
// Saat form artikel disubmit, frontend mengirim { html, teks }

export async function simpanArtikel(req, res) {
  const { judul, html, teks } = req.body;

  // `html` → disimpan dan ditampilkan di halaman (sudah ter-sanitasi oleh RTE)
  // `teks` → dipakai untuk search index, preview, atau meta description
  await buatArtikel({ judul, kontenHtml: html, kontenTeks: teks });

  res.json({ status: 'success', message: 'Artikel berhasil disimpan.' });
}
```

---

## Catatan Penting

### Template Engine

**`>` tanpa `=` di kondisi:**
Karakter `>` di dalam `<if>` dianggap penutup tag. Untuk perbandingan "lebih dari", tukar posisi operan dan gunakan `<`:

```html
<!-- ✗ Tidak bisa: -->
<if jumlah > 10>Banyak</if>

<!-- ✓ Tukar menjadi: -->
<if 10 < jumlah>Banyak</if>
<!-- atau gunakan >= -->
<if jumlah >= 11>Banyak</if>
```

**Cache di development:**
Aktifkan pengosongan cache saat file berubah agar perubahan template langsung terlihat tanpa restart server.

**Include path:**
Path di `<include="...">` selalu relatif dari file yang sedang di-render, bukan dari `dirViews`.

### WebEditor

**Hanya berjalan di browser:**
Jangan import `@wanuky/web-editor` di file Node.js/server. Gunakan hanya di file JavaScript yang di-load browser.

**CSS:**
Kedua editor membutuhkan styling CSS. Tambahkan kelas berikut di `components.css`:
- `.wanuky-rte` — container RichTextEditor
- `.wanuky-rte__toolbar`, `.wanuky-rte__area`, `.wanuky-rte__modal` — bagian RTE
- `.wanuky-img-editor` — container ImageEditor
- `.wanuky-img-editor__toolbar`, `.wanuky-img-editor__kanvas` — bagian ImageEditor

**`document.execCommand` deprecated:**
RichTextEditor menggunakan `execCommand` yang statusnya deprecated di spec W3C tapi masih didukung semua browser modern. Untuk proyek jangka panjang, pertimbangkan migrasi ke Selection API di versi berikutnya.

---

*wanuky-lib v1.1.0 — dibuat untuk kebutuhan proyek pribadi.*
