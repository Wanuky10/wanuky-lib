# Panduan wanuky-lib v2.1.0

Library internal untuk proyek website pribadi. Terdiri dari dua package:

- **`@wanuky10/template-engine`** — SSR template engine untuk Node.js (server-side)
- **`@wanuky10/web-editor`** — RichTextEditor dan ImageEditor untuk browser (client-side)

---

## Daftar Isi

1. [Instalasi](#instalasi)
2. [Template Engine v2.1.0](#template-engine)
   - [Setup](#setup-template-engine)
   - [Interpolasi](#interpolasi)
   - [Filter](#filter)
   - [Include Partial](#include-partial)
   - [Layout & Slot](#layout--slot)
   - [Named Slots](#named-slots)
   - [Loop `<each>`](#loop-each)
   - [Kondisional `<if>` / `<unless>`](#kondisional-if--unless)
   - [`<switch>`](#switch)
   - [`<with>`](#with)
   - [`<set>`](#set)
   - [Macro `<macro>` / `<call>`](#macro--call)
   - [Blok `<raw>`](#blok-raw)
   - [Cache & LRU](#cache--lru)
   - [`renderAsync`](#renderasync)
   - [`TemplateError`](#templateerror)
3. [WebEditor v2.1.0](#webeditor)
   - [RichTextEditor](#richtexteditor)
   - [ImageEditor](#imageeditor)
   - [EditorError](#editorerror)
   - [sanitasi](#sanitasi)
   - [bacaOrientasiExif / orientasiKeTransform](#exif-reader)
   - [FormatManager](#formatmanager)
4. [Integrasi ke Proyek](#integrasi-ke-proyek)
5. [Catatan Penting](#catatan-penting)

---

## Instalasi

Pastikan `.npmrc` di root proyek sudah dikonfigurasi:

```toml
@wanuky10:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Set token GitHub Personal Access Token sebelum `npm install`:

```powershell
# PowerShell
$env:NODE_AUTH_TOKEN = "ghp_..."
```

Tambahkan ke `package.json` proyek:

```json
"dependencies": {
  "@wanuky10/template-engine": "2.1.0",
  "@wanuky10/web-editor": "2.1.0"
}
```

Kemudian jalankan:

```bash
npm install
```

---

## Template Engine

Package `@wanuky10/template-engine` adalah SSR template engine kustom berbasis Node.js ES Modules. Berjalan di server — tidak perlu build tool, tidak ada external dependency.

### Setup Template Engine

```js
// backend/config/templateEngine.js
import { buatEngine } from '@wanuky10/template-engine';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const engine = buatEngine({
  dirViews:        resolve(__dirname, '../../frontend/views'),
  dirLayouts:      resolve(__dirname, '../../frontend/views/layouts'),
  cache:           true,   // default true — false untuk development
  cacheMaxSize:    200,    // jumlah maksimal file di LRU cache (default 200)
  debug:           false,  // true = log nama view yang di-render ke stderr
  maxIncludeDepth: 20,     // batas kedalaman include rekursif (default 20)
});
```

Gunakan di controller:

```js
// backend/controllers/beranda/berandaController.js
import { engine } from '../../config/templateEngine.js';

export async function tampilBeranda(req, res) {
  const html = await engine.render('pages/beranda/index.html', {
    judul:     'Beranda',
    pengguna:  req.pengguna,
    produk:    [],
  }, 'utama'); // 'utama' → layouts/utama.html

  res.send(html);
}
```

Opsi `buatEngine`:

| Opsi | Tipe | Default | Keterangan |
|---|---|---|---|
| `dirViews` | string | — | Path absolut direktori views (wajib) |
| `dirLayouts` | string | — | Path absolut direktori layouts (wajib) |
| `cache` | boolean | `true` | Cache file di memori |
| `cacheMaxSize` | number | `200` | Kapasitas LRU cache (jumlah file) |
| `debug` | boolean | `false` | Log nama view yang di-render ke stderr |
| `maxIncludeDepth` | number | `20` | Batas kedalaman include rekursif |

API engine yang tersedia:

```js
engine.render('path/view.html', data, 'namaLayout');    // render dengan layout
engine.render('path/view.html', data);                   // render tanpa layout
engine.renderString('<p><{ nama }></p>', { nama: 'X' }); // render string langsung
await engine.renderAsync('path/view.html', promiseData, 'layout'); // data boleh Promise
engine.kosongkanCache();                                 // kosongkan semua cache (LRU)
engine.hapusCache('path/view.html');                     // hapus satu view dari cache
engine.infoCache;                                        // { jumlah: N, max: 200 }
```

---

### Interpolasi

Sisipkan nilai dari data ke HTML. XSS auto-escape aktif secara default.

**Sintaks:** `<{ variabel }>`

```html
<!-- data: { judul: 'Selamat Datang', pengguna: { nama: 'Wahid' } } -->

<h1><{ judul }></h1>
<!-- output: <h1>Selamat Datang</h1> -->

<!-- Dot-notation untuk objek bersarang -->
<p>Halo, <{ pengguna.nama }>!</p>
<!-- output: <p>Halo, Wahid!</p> -->

<!-- Nilai tidak ditemukan → string kosong (tidak error) -->
<p><{ tidakAda }></p>
<!-- output: <p></p> -->

<!-- XSS auto-escape -->
<!-- data: { input: '<script>alert(1)</script>' } -->
<div><{ input }></div>
<!-- output: <div>&lt;script&gt;alert(1)&lt;/script&gt;</div> -->
```

**Raw HTML (tanpa escaping)** — hanya untuk konten terpercaya dari server:

```html
<!-- Prefix ! = raw mode -->
<!-- data: { isi: '<strong>Penting</strong>' } -->
<div><{ !isi }></div>
<!-- output: <div><strong>Penting</strong></div> -->
```

> ⚠️ Jangan gunakan `<{ !... }>` untuk input yang berasal dari pengguna.

---

### Filter

Filter mengubah nilai sebelum ditampilkan. Sintaks: `<{ nilai | filter }>` atau berantai `<{ nilai | filter1 | filter2 }>`.

**Contoh:**

```html
<!-- data: { judul: 'hello world', harga: 15000, tgl: '2024-01-15' } -->

<{ judul | uppercase }>          <!-- HELLO WORLD -->
<{ judul | capitalize }>         <!-- Hello world -->
<{ judul | titlecase }>          <!-- Hello World -->
<{ judul | truncate: 5 }>        <!-- hello… -->
<{ judul | truncate: 5, '...' }> <!-- hello... -->
<{ harga | currency }>           <!-- Rp 15.000 -->
<{ harga | currency: USD, en-US }> <!-- $15,000 -->
<{ 0.75 | percent }>             <!-- 75% -->
<{ tgl | dateFormat: dd/MM/yyyy }> <!-- 15/01/2024 -->
<{ tgl | timeAgo }>              <!-- X hari lalu -->

<!-- Berantai -->
<{ judul | uppercase | truncate: 8 }> <!-- HELLO WO… -->

<!-- Filter array -->
<!-- data: { tags: ['Vue', 'React', 'Node'] } -->
<{ tags | join: ' · ' }>   <!-- Vue · React · Node -->
<{ tags | length }>         <!-- 3 -->
<{ tags | first }>          <!-- Vue -->
<{ tags | last }>           <!-- Node -->
<{ tags | reverse | join }> <!-- Node, React, Vue -->
<{ tags | slice: 0, 2 | join }> <!-- Vue, React -->

<!-- Filter objek -->
<!-- data: { item: { a: 1, b: 2 } } -->
<{ item | keys | join }>    <!-- a, b -->
<{ item | values | join }>  <!-- 1, 2 -->
```

**Semua filter tersedia:**

| Filter | Contoh | Keterangan |
|---|---|---|
| `uppercase` | `<{ v \| uppercase }>` | Huruf besar semua |
| `lowercase` | `<{ v \| lowercase }>` | Huruf kecil semua |
| `capitalize` | `<{ v \| capitalize }>` | Kapital huruf pertama |
| `titlecase` | `<{ v \| titlecase }>` | Title Case setiap kata |
| `trim` | `<{ v \| trim }>` | Hapus spasi awal/akhir |
| `replace` | `<{ v \| replace: from, to }>` | Ganti substring |
| `truncate` | `<{ v \| truncate: 100, '…' }>` | Potong + suffix |
| `padStart` | `<{ v \| padStart: 5, 0 }>` | Pad dari kiri |
| `padEnd` | `<{ v \| padEnd: 5 }>` | Pad dari kanan |
| `slug` | `<{ v \| slug }>` | Ubah ke URL slug |
| `default` | `<{ v \| default: 'N/A' }>` | Nilai fallback jika null/empty |
| `bool` | `<{ v \| bool }>` | Konversi ke boolean |
| `number` | `<{ v \| number }>` | Format ribuan locale id-ID |
| `round` | `<{ v \| round: 2 }>` | Bulatkan N desimal |
| `floor` | `<{ v \| floor }>` | Bulatkan ke bawah |
| `ceil` | `<{ v \| ceil }>` | Bulatkan ke atas |
| `abs` | `<{ v \| abs }>` | Nilai absolut |
| `currency` | `<{ v \| currency: IDR, id-ID }>` | Format mata uang |
| `percent` | `<{ v \| percent: 1 }>` | Format persentase |
| `dateFormat` | `<{ v \| dateFormat: dd/MM/yyyy }>` | Format tanggal |
| `timeAgo` | `<{ v \| timeAgo }>` | Waktu relatif ("5 menit lalu") |
| `length` | `<{ v \| length }>` | Panjang array/string |
| `join` | `<{ v \| join: ', ' }>` | Gabungkan array |
| `first` | `<{ v \| first }>` | Elemen pertama |
| `last` | `<{ v \| last }>` | Elemen terakhir |
| `reverse` | `<{ v \| reverse }>` | Balik urutan |
| `unique` | `<{ v \| unique }>` | Hapus duplikat |
| `sort` | `<{ v \| sort: key }>` | Urutkan array |
| `slice` | `<{ v \| slice: 0, 5 }>` | Ambil subset |
| `json` | `<{ v \| json: 2 }>` | Serialize ke JSON |
| `keys` | `<{ v \| keys }>` | Daftar kunci objek |
| `values` | `<{ v \| values }>` | Daftar nilai objek |
| `entries` | `<{ v \| entries }>` | Array `{key, value}` dari objek |

**Raw + filter:**

```html
<!-- Prefix ! tetap bisa dikombinasi dengan filter -->
<{ !kontenHtml | truncate: 200 }>
```

---

### Include Partial

Sisipkan file HTML lain secara rekursif. Path relatif dari file yang sedang di-render.

**Sintaks:** `<include="path/ke/file.html">`

```html
<!-- frontend/views/pages/beranda/index.html -->

<include="../../partials/core/header.html">
<include="../../partials/core/navigasi.html">

<main>
  <h1><{ judul }></h1>
</main>

<include="../../partials/core/footer.html">
```

Partial menerima data konteks yang sama:

```html
<!-- frontend/views/partials/core/header.html -->
<header>
  <h1><{ judul }></h1>
  <if pengguna.login>
    <span>Halo, <{ pengguna.nama }></span>
  </if>
</header>
```

> Include bersifat rekursif — partial boleh include partial lain. Batas kedalaman: 20 level.

---

### Layout & Slot

Layout adalah wrapper HTML yang dipakai bersama banyak halaman.

**Slot konten utama:** `<contents></contents>`

```html
<!-- frontend/views/layouts/utama.html -->
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title><{ judul }> — Nama Situs</title>
  <link rel="stylesheet" href="/css/main.css">
  <script src="https://kit.fontawesome.com/cce81db6df.js" crossorigin="anonymous"></script>
</head>
<body>
  <include="../../partials/core/navbar.html">

  <main class="container">
    <contents></contents>
  </main>

  <include="../../partials/core/footer.html">
  <script src="/js/core/ui.js" type="module"></script>
</body>
</html>
```

```js
// Render dengan layout 'utama' → layouts/utama.html
engine.render('pages/produk/daftar.html', data, 'utama');

// Render tanpa layout
engine.render('pages/produk/daftar.html', data);

// Render string langsung (untuk email, snippet, dsb.)
engine.renderString('<p>Halo <{ nama }>!</p>', { nama: 'Wahid' });
```

---

### Named Slots

Untuk menyuntikkan konten ke beberapa area layout yang berbeda (bukan hanya satu `<contents>`), gunakan **named slots**.

**Di layout:** `<slot name="nama">konten default</slot>`

**Di view halaman:** `<fill name="nama">konten pengganti</fill>`

```html
<!-- frontend/views/layouts/utama.html -->
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title><{ judul }></title>
  <!-- Slot untuk memasukkan CSS tambahan per halaman -->
  <slot name="styles"></slot>
</head>
<body>
  <main>
    <contents></contents>
  </main>
  <!-- Slot untuk script per halaman, dengan konten default kosong -->
  <slot name="scripts"></slot>
</body>
</html>
```

```html
<!-- frontend/views/pages/dashboard/index.html -->

<!-- Fill untuk slot 'styles' di layout -->
<fill name="styles">
  <link rel="stylesheet" href="/css/dashboard/index.css">
</fill>

<!-- Fill untuk slot 'scripts' di layout -->
<fill name="scripts">
  <script src="/js/dashboard/index.js" type="module"></script>
</fill>

<!-- Konten utama halaman (masuk ke <contents></contents>) -->
<section class="dashboard">
  <h1><{ judul }></h1>
</section>
```

> Konten di dalam `<fill>` tidak ditampilkan di posisi aslinya di view — ia akan dipindahkan ke slot yang sesuai di layout.

---

### Loop `<each>`

Iterasi array. Tersedia metadata loop otomatis.

**Sintaks:**

```html
<each item in koleksi>...</each>
<each indeks, item in koleksi>...</each>
```

**Contoh:**

```html
<!-- data: { produk: [{nama:'Kopi',harga:15000},{nama:'Teh',harga:8000}] } -->

<ul>
  <each item in produk>
    <li>
      <span><{ loop.indeks | number }>. </span>
      <{ item.nama }> — <{ item.harga | currency }>
      <if loop.terakhir> ← terakhir</if>
    </li>
  </each>
</ul>
```

**Metadata loop:**

| Properti | Tipe | Keterangan |
|---|---|---|
| `loop.indeks` | number | Indeks saat ini (mulai 0) |
| `loop.pertama` | boolean | `true` jika item pertama |
| `loop.terakhir` | boolean | `true` jika item terakhir |
| `loop.total` | number | Jumlah total item |

**Nested loop:**

```html
<table>
  <each baris in tabel>
    <tr>
      <each i, sel in baris>
        <td class="<if loop.pertama>col-pertama</if>"><{ sel }></td>
      </each>
    </tr>
  </each>
</table>
```

**Iterasi objek dengan `entries`:**

```html
<!-- data: { konfigurasi: { tema: 'gelap', bahasa: 'id' } } -->

<each entry in konfigurasi | entries>
  <div><{ entry.key }>: <{ entry.value }></div>
</each>
```

---

### Kondisional `<if>` / `<unless>`

Tampilkan konten secara kondisional.

**`<if>` — tampilkan jika benar:**

```html
<if pengguna.aktif>Akun aktif</if>

<if nilai >= 80>
  <span class="lulus">Lulus</span>
<elseif nilai >= 60>
  <span class="remidi">Remidi</span>
<else>
  <span class="gagal">Gagal</span>
</if>
```

**`<unless>` — tampilkan jika SALAH (inverse dari `<if>`):**

```html
<!-- Tampilkan jika pengguna BELUM login -->
<unless pengguna.login>
  <a href="/masuk">Masuk</a>
</unless>

<!-- Setara dengan: -->
<if !pengguna.login>
  <a href="/masuk">Masuk</a>
</if>
```

**`<unless>` dengan `<else>`:**

`<unless>` mendukung cabang `<else>` untuk kondisi yang benar:

```html
<unless pengguna.login>
  <a href="/masuk">Masuk</a>
<else>
  <span>Halo, <{ pengguna.nama }></span>
</unless>

<!-- Setara dengan: -->
<if !pengguna.login>
  <a href="/masuk">Masuk</a>
<else>
  <span>Halo, <{ pengguna.nama }></span>
</if>
```

`<else>` yang bersarang di dalam `<if>` atau `<unless>` di dalam blok tidak akan dicuri oleh `<unless>` induk:

```html
<unless daftarKosong>
  <each item in daftar>
    <!-- <else> ini milik <if>, bukan milik <unless> -->
    <if item.aktif>Aktif<else>Nonaktif</if>
  </each>
<else>
  <p>Belum ada data.</p>
</unless>
```

**Operator kondisi yang tersedia:**

| Operator | Contoh | Keterangan |
|---|---|---|
| (truthy) | `<if aktif>` | Cek truthy/falsy |
| `!` | `<if !aktif>` | Negasi |
| `==` | `<if peran == admin>` | Sama (loose) |
| `!=` | `<if status != tutup>` | Tidak sama |
| `>=` | `<if nilai >= 80>` | Lebih dari atau sama |
| `<=` | `<if stok <= 5>` | Kurang dari atau sama |
| `<` | `<if 10 < jumlah>` | Kurang dari (tukar operan) |

> `>` tidak bisa dipakai langsung karena dianggap penutup tag. Gunakan `<` dengan posisi operan ditukar, atau `>=`.

---

### `<switch>`

Multi-case kondisional berdasarkan nilai satu variabel.

```html
<switch pengguna.peran>
  <when admin>
    <a href="/admin">Panel Admin</a>
  </when>
  <when editor>
    <a href="/konten">Kelola Konten</a>
  </when>
  <when moderator>
    <a href="/moderasi">Moderasi</a>
  </when>
  <default>
    <a href="/profil">Profil</a>
  </default>
</switch>
```

---

### `<with>`

Buat scope alias untuk path bersarang yang panjang. Di dalam blok `<with>`, referensi berjalan relatif dari objek target.

```html
<!-- data: { pengguna: { profil: { nama: 'Wahid', kota: 'Bandung', bio: '...' } } } -->

<!-- Tanpa with: verbose -->
<p><{ pengguna.profil.nama }></p>
<p><{ pengguna.profil.kota }></p>
<p><{ pengguna.profil.bio }></p>

<!-- Dengan with: bersih -->
<with pengguna.profil>
  <p><{ nama }></p>
  <p><{ kota }></p>
  <p><{ bio }></p>
</with>
```

---

### `<set>`

Buat variabel lokal di dalam template. Berlaku untuk scope blok saat ini dan child-nya.

```html
<!-- Set literal string -->
<set label = "Produk Unggulan">
<h2><{ label }></h2>

<!-- Set dari path data -->
<set totalHarga = keranjang.total>
<p>Total: <{ totalHarga | currency }></p>

<!-- Set di dalam each (scope per iterasi) -->
<each item in produk>
  <set kelas = "card">
  <if loop.pertama>
    <set kelas = "card card--unggulan">
  </if>
  <div class="<{ kelas }>"><{ item.nama }></div>
</each>
```

---

### Macro & `<call>`

Definisikan template yang dapat dipanggil ulang seperti komponen dengan parameter.

**Definisi:** `<macro namaFungsi(param1, param2)>...</macro>`

**Pemanggilan:** `<call namaFungsi(param1="nilai", param2=path.data)>`

```html
<!-- Definisi macro tombol -->
<macro tombol(label, href, tipe)>
  <a href="<{ href }>" class="btn btn--<{ tipe }>">
    <{ label }>
  </a>
</macro>

<!-- Pemanggilan dengan literal -->
<call tombol(label="Simpan", href="/simpan", tipe="primary")>
<call tombol(label="Batal",  href="/batal",  tipe="secondary")>

<!-- Pemanggilan dengan nilai dari data -->
<!-- data: { aksi: { url: '/hapus', teks: 'Hapus' } } -->
<call tombol(label=aksi.teks, href=aksi.url, tipe="danger")>
```

> Macro diekstrak sebelum rendering dan tidak muncul di output. Bisa didefinisikan di file partial dan di-include ke halaman yang membutuhkannya.

---

### Blok `<raw>`

Cegah pemrosesan template di dalam blok — berguna untuk menampilkan kode contoh atau template client-side (Vue, Alpine, dsb.) yang menggunakan sintaks serupa.

```html
<raw>
  <!-- Ini TIDAK akan diproses oleh template engine -->
  <{ variabel }>
  <if kondisi>...</if>
  <each item in daftar>...</each>
</raw>
```

---

### Cache & LRU

Cache menggunakan algoritma **LRU (Least Recently Used)** — file terlama yang tidak diakses otomatis dibuang saat cache penuh.

```js
// Cache aktif secara default (LRU 200 file)
const engine = buatEngine({ dirViews, dirLayouts });

// Development: matikan cache agar perubahan template langsung terlihat
const engine = buatEngine({
  dirViews,
  dirLayouts,
  cache:        false,
});

// Production dengan cache lebih besar
const engine = buatEngine({
  dirViews,
  dirLayouts,
  cache:        true,
  cacheMaxSize: 500,
});

// Hapus satu view dari cache (path relatif dari dirViews)
engine.hapusCache('pages/beranda/index.html');

// Kosongkan seluruh cache
engine.kosongkanCache();

// Cek status cache
const { jumlah, max } = engine.infoCache;
console.log(`${jumlah}/${max} file di-cache`);
```

> Di v2.0.0, `hotReload` (fs.watch) dihapus. Untuk development, gunakan `cache: false` atau panggil `engine.hapusCache(namaView)` / `engine.kosongkanCache()` secara manual di middleware watch yang dikelola di level aplikasi.

---

### `renderAsync`

`renderAsync` menerima `data` berupa `Promise` — cocok untuk controller async yang memuat data sebelum render:

```js
// Langsung pass Promise tanpa await
const html = await engine.renderAsync(
  'pages/produk/daftar.html',
  ambilSemuaProduk(), // Promise<Object>
  'utama'
);

// Setara dengan:
const data = await ambilSemuaProduk();
const html = engine.render('pages/produk/daftar.html', data, 'utama');
```

Jika `data` bukan Promise, `renderAsync` tetap berfungsi normal seperti `render`.

---

### `TemplateError`

`TemplateError` dilempar engine saat terjadi kesalahan seperti file tidak ditemukan, include melebihi batas kedalaman, atau layout tidak valid. Merupakan subclass dari `Error`.

```js
import { TemplateError } from '@wanuky10/template-engine';

try {
  const html = engine.render('pages/tidak-ada.html', {}, 'utama');
} catch (err) {
  if (err instanceof TemplateError) {
    console.error(err.toString());
    // TemplateError: File tidak ditemukan: /path/ke/views/pages/tidak-ada.html
    //   di: /path/ke/views/pages/tidak-ada.html
  }
}
```

Properti `TemplateError`:

| Properti | Tipe | Keterangan |
|---|---|---|
| `message` | string | Pesan error |
| `name` | string | Selalu `'TemplateError'` |
| `file` | string \| undefined | Path file yang menyebabkan error |
| `line` | number \| undefined | Nomor baris (jika tersedia) |
| `variabelTersedia` | string[] \| undefined | Kunci data yang tersedia saat error |
| `cause` | Error \| undefined | Error asli (error chain) |

---

## WebEditor

Package `@wanuky10/web-editor` adalah library **khusus browser** — tidak kompatibel dengan Node.js karena bergantung pada DOM API, Canvas API, File, Blob, dan FileReader.

```js
// frontend/public/js/fitur/artikel/editor.js
import { RichTextEditor, ImageEditor } from '@wanuky10/web-editor';

// Atau import terpisah (code splitting)
import { RichTextEditor } from '@wanuky10/web-editor/rich-text';
import { ImageEditor }    from '@wanuky10/web-editor/image';

// Export tambahan v2.1.0
import {
  EditorError,              // custom error class
  sanitasi,                 // HTML sanitizer
  bacaOrientasiExif,        // baca orientasi EXIF dari File/Blob
  orientasiKeTransform,     // konversi orientasi ke { rotate, flipH, flipV }
  FormatManager,            // Selection API layer (untuk editor custom)
} from '@wanuky10/web-editor';
```

---

### RichTextEditor

Editor teks kaya berbasis `contenteditable`. Output: HTML tersanitasi + plain text + jumlah kata.

#### Inisialisasi

```js
const rte = new RichTextEditor('#kontainer-editor', {
  // Daftar tool manual (urutan = urutan tampil di toolbar)
  toolbar: ['bold', 'italic', 'underline', '|', 'h2', 'h3', '|', 'ul', 'ol', '|', 'link'],

  // Atau gunakan preset
  toolbarPreset: 'standard', // 'minimal' | 'standard' (default) | 'full'

  // Konten awal
  nilaiAwal:   '<p>Draft</p>',
  placeholder: 'Tulis di sini...',
  readonly:    false,
  maxLength:   5000,     // 0 = tidak terbatas
  debounceMs:  300,      // delay event 'ubah' (ms)

  // Callback legacy (backward-compat, disarankan gunakan .on() sebagai gantinya)
  onUbah:  ({ html, teks, jumlahKata }) => {},
  onFokus: () => {},
  onBlur:  () => {},
});
```

#### Event System

```js
// Daftarkan event listener
rte.on('ubah',  ({ html, teks, jumlahKata }) => {
  console.log(`${jumlahKata} kata`);
  simpanDraft(html);
});
rte.on('fokus', () => console.log('difokuskan'));
rte.on('blur',  () => console.log('blur'));

// Hapus listener
rte.off('ubah', handler);
```

#### Semua Tool yang Tersedia

| Tool | Fungsi |
|---|---|
| `bold` | **Tebal** |
| `italic` | *Miring* |
| `underline` | Garis bawah |
| `strikethrough` | ~~Coret~~ |
| `superscript` | Superscript (x²) |
| `subscript` | Subscript (x₂) |
| `h1` | Judul 1 |
| `h2` | Judul 2 |
| `h3` | Judul 3 |
| `p` | Paragraf normal |
| `ul` | Daftar bullet |
| `ol` | Daftar nomor |
| `blockquote` | Kutipan |
| `code` | Blok kode |
| `alignLeft` | Rata kiri |
| `alignCenter` | Rata tengah |
| `alignRight` | Rata kanan |
| `alignJustify` | Rata penuh |
| `foreColor` | Warna teks (18 pilihan) |
| `hiliteColor` | Warna sorotan/highlight |
| `fontSize` | Ukuran font (7 pilihan: 10px–36px) |
| `link` | Tambah tautan (modal inline) |
| `insertImage` | Sisipkan gambar via URL atau upload file |
| `table` | Sisipkan tabel (pilih kolom × baris) |
| `hr` | Garis pemisah horizontal |
| `removeFormat` | Hapus semua format |
| `undo` | Urungkan |
| `redo` | Ulangi |
| `\|` | Separator toolbar |

#### Preset Toolbar

```
minimal:  bold, italic | link
standard: bold, italic, underline | h2, h3 | ul, ol | link, removeFormat
full:     semua tool di atas
```

#### API Publik

```js
// Ambil nilai saat ini
const { html, teks, jumlahKata } = rte.getNilai();

// Isi editor dengan HTML
rte.setNilai('<p>Konten baru</p>');

// Kosongkan editor
rte.kosongkan();

// Fokuskan editor
rte.fokus();

// Toggle mode readonly
rte.setReadonly(true);
rte.setReadonly(false);

// Sisipkan HTML di posisi kursor
rte.insertHtml('<strong>teks</strong>');

// Ambil teks yang sedang diseleksi
const teksSeleksi = rte.getSelectedText();

// Scroll ke posisi kursor
rte.scrollKeCursor();

// Hancurkan (hapus dari DOM, unbind listener)
rte.hancurkan();
```

#### Markdown Shortcuts

Ketik karakter berikut diikuti spasi untuk auto-format:

| Ketik | Hasil |
|---|---|
| `# ` | Heading 1 |
| `## ` | Heading 2 |
| `### ` | Heading 3 |
| `> ` | Blockquote |
| ` ``` ` | Blok kode |
| `- ` | Daftar bullet |
| `1. ` | Daftar nomor |

#### Keyboard Shortcuts

| Shortcut | Aksi |
|---|---|
| `Ctrl/Cmd + B` | Tebal |
| `Ctrl/Cmd + I` | Miring |
| `Ctrl/Cmd + U` | Garis bawah |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |

#### Contoh Penggunaan

```js
import { RichTextEditor } from '@wanuky10/web-editor';

const editor = new RichTextEditor('#editor-artikel', {
  toolbarPreset: 'full',
  maxLength:     10000,
  placeholder:   'Mulai menulis artikel...',
});

editor.on('ubah', ({ html, teks, jumlahKata }) => {
  document.querySelector('#info-kata').textContent = `${jumlahKata} kata`;
  // Auto-save
  fetch('/api/v1/artikel/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, teks }),
  });
});

// Saat form disubmit
document.querySelector('#form-artikel').addEventListener('submit', (e) => {
  e.preventDefault();
  const { html, teks, jumlahKata } = editor.getNilai();
  // Kirim ke server
});
```

---

### ImageEditor

Editor gambar berbasis Canvas API. Mendukung: crop, zoom, pan, flip, rotasi (90° dan bebas), filter warna via CSS filter, preset filter, rasio aspek crop, history/undo, pinch-to-zoom, dan drag & drop.

#### Inisialisasi

```js
import { ImageEditor } from '@wanuky10/web-editor';

const imgEditor = new ImageEditor('#kontainer-image-editor', {
  // Daftar fitur manual
  fitur: ['rotasiKiri', 'rotasiKanan', '|', 'flipH', '|', 'brightness', 'contrast', '|',
          'preset', '|', 'crop', '|', 'undo', 'reset', 'simpan'],

  // Atau gunakan preset
  fiturPreset: 'full', // 'minimal' | 'standard' (default) | 'full'

  // Bentuk area crop
  bentukCrop: 'rect', // 'rect' (default) | 'circle'

  // Format dan kualitas output
  formatOutput:   'jpeg',  // 'jpeg' (default) | 'png' | 'webp'
  kualitasOutput: 0.92,    // 0–1 (default: 0.92)

  // Batasi ukuran output (opsional)
  ukuranMaks: { lebar: 1920, tinggi: 1080 },

  // Callback legacy (disarankan gunakan .on() sebagai gantinya)
  onSelesai: (blob) => uploadGambar(blob),
});
```

#### Event System

```js
imgEditor.on('muat',    ({ lebar, tinggi }) => console.log(`${lebar}×${tinggi}`));
imgEditor.on('ubah',    (nilai) => console.log('perubahan', nilai));
imgEditor.on('selesai', (blob)  => uploadGambar(blob));
imgEditor.on('error',   (err)   => tampilkanError(err.message));

// Hapus listener
imgEditor.off('selesai', handler);
```

#### Semua Fitur yang Tersedia

| Fitur | Fungsi |
|---|---|
| `rotasiKiri` | Putar kiri 90° |
| `rotasiKanan` | Putar kanan 90° |
| `flipH` | Cermin horizontal |
| `flipV` | Cermin vertikal |
| `zoomMasuk` | Perbesar (+15%) |
| `zoomKeluar` | Perkecil (-15%) |
| `zoomReset` | Reset zoom ke 1× |
| `brightness` | Slider kecerahan (−100 s/d +100) |
| `contrast` | Slider kontras (−100 s/d +100) |
| `saturasi` | Slider saturasi (−100 s/d +100) |
| `hue` | Slider hue rotate (−180° s/d +180°) |
| `blur` | Slider blur (0–10px) |
| `grayscale` | Slider abu-abu (0–100%) |
| `sepia` | Slider sepia (0–100%) |
| `rotasiSudut` | Slider rotasi bebas (−180° s/d +180°) |
| `preset` | Dropdown preset filter (6 pilihan) |
| `aspekRasio` | Dropdown rasio aspek crop (8 pilihan) |
| `crop` | Mode potong dengan resize handle |
| `undo` | Urungkan aksi terakhir (max 20 langkah) |
| `reset` | Reset semua ke kondisi awal |
| `simpan` | Simpan & emit event 'selesai' |
| `\|` | Separator toolbar |

#### Preset Fitur

```
minimal:  crop | simpan
standard: rotasiKiri, rotasiKanan | flipH | brightness, contrast | crop | undo, reset, simpan
full:     semua fitur di atas
```

#### Preset Filter Bawaan

Tersedia via tombol `preset` di toolbar:

| Preset | Efek |
|---|---|
| `Original` | Reset semua filter ke netral |
| `Vivid` | Warna lebih cerah dan jenuh |
| `Warm` | Nuansa hangat kekuningan |
| `Cool` | Nuansa dingin kebiru-biruan |
| `Noir` | Hitam putih kontras tinggi |
| `Vintage` | Efek klasik kecoklatan |

#### Rasio Aspek Crop

Tersedia via tombol `aspekRasio` di toolbar:

| Rasio | Keterangan |
|---|---|
| Bebas | Tanpa batasan (default) |
| 1:1 | Persegi |
| 4:3 | Standar foto/layar lama |
| 3:2 | Standar kamera DSLR |
| 16:9 | Widescreen |
| 9:16 | Vertikal (story/reels) |
| 2:3 | Portrait |
| 3:4 | Portrait lebar |

#### Interaksi Canvas

| Aksi | Cara |
|---|---|
| **Pan** (geser gambar) | Drag mouse/touch di canvas |
| **Zoom** | Scroll mouse atau pinch-to-zoom (mobile) |
| **Crop** | Aktifkan mode crop → drag untuk area seleksi |
| **Resize crop** | Tarik handle di sudut/tepi area crop |
| **Pindah crop** | Drag area crop yang sudah ada |
| **Pan keyboard** | Tombol panah ← ↑ → ↓ saat canvas difokuskan |
| **Zoom keyboard** | Tombol `+`/`-` saat canvas difokuskan |
| **Undo keyboard** | `Ctrl+Z` saat canvas difokuskan |

#### API Publik

```js
// Muat gambar dari File object
imgEditor.muatFile(file);

// Muat gambar dari URL (data URL, object URL, atau URL biasa)
await imgEditor.muatUrl('https://example.com/gambar.jpg');
await imgEditor.muatUrl(dataUrlString);

// Terapkan area crop yang aktif ke gambar (bakes crop)
imgEditor.terapkanCrop();

// Simpan hasil sebagai Promise<Blob>
const blob = await imgEditor.simpan();

// Ambil data URL string dari kanvas saat ini
const dataUrl = imgEditor.getDataUrl('jpeg', 0.9);

// Dapatkan info editor saat ini
const info = imgEditor.dapatkanInfo();
// → { lebar, tinggi, rotasi, sudutBebas, flipH, flipV, zoom, filter: {...}, versi }

// Undo (kembali ke state sebelumnya)
imgEditor.undo();

// Hancurkan (hapus DOM, clear listener)
imgEditor.hancurkan();
```

#### Contoh Upload Gambar Profil

```js
import { ImageEditor } from '@wanuky10/web-editor';

const editor = new ImageEditor('#editor-foto-profil', {
  fiturPreset:    'full',
  bentukCrop:     'circle',
  formatOutput:   'webp',
  kualitasOutput: 0.85,
  ukuranMaks:     { lebar: 800, tinggi: 800 },
});

editor.on('muat', ({ lebar, tinggi }) => {
  console.log(`Gambar dimuat: ${lebar}×${tinggi}px`);
});

editor.on('selesai', async (blob) => {
  const formData = new FormData();
  formData.append('foto', blob, 'profil.webp');

  const res = await fetch('/api/v1/pengguna/foto-profil', {
    method: 'POST',
    body:   formData,
  });

  if (res.ok) tampilkanToast('Foto profil berhasil diperbarui');
});

// Buka file picker
document.querySelector('#btn-ganti-foto').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => editor.muatFile(e.target.files[0]);
  input.click();
});

// Atau drag & drop — editor sudah menangani ini secara otomatis
```

---

### EditorError

`EditorError` dilempar oleh komponen web-editor saat terjadi kesalahan (URL tidak valid, file bukan gambar, dsb.). Merupakan subclass dari `Error`.

```js
import { EditorError } from '@wanuky10/web-editor';

editor.on('error', (err) => {
  if (err instanceof EditorError) {
    tampilkanToast(err.message);
  }
});

// Atau tangkap langsung
try {
  await editor.muatUrl(url);
} catch (err) {
  if (err instanceof EditorError) console.error(err.message, err.cause);
}
```

---

### `sanitasi`

Fungsi `sanitasi` membersihkan HTML dari tag/atribut berbahaya (XSS). Berguna di frontend sebelum menyimpan konten atau menampilkan HTML dari sumber tidak terpercaya.

```js
import { sanitasi } from '@wanuky10/web-editor';

const bersih = sanitasi(htmlKotor);

// Dengan konfigurasi custom
const bersih = sanitasi(htmlKotor, {
  // Tag yang diizinkan (default: p, br, strong, b, em, i, u, s, del, h1-h3, ul, ol, li, blockquote, code, pre, a, img)
  tagDiizinkan: ['p', 'br', 'strong', 'em', 'a'],
});
```

Apa yang dibersihkan:
- Semua event handler (`onclick`, `onerror`, dsb.)
- Atribut `href`/`src` dengan protokol berbahaya (`javascript:`, `data:`, dsb.)
- Tag tidak dikenal di luar `tagDiizinkan`
- `<a target="_blank">` otomatis ditambah `rel="noopener noreferrer"`

> `sanitasi` membutuhkan `DOMParser` — hanya berjalan di browser.

---

### EXIF Reader

Baca orientasi gambar JPEG dari byte EXIF, berguna untuk mengoreksi rotasi foto dari kamera/smartphone sebelum dikirim ke server.

```js
import { bacaOrientasiExif, orientasiKeTransform } from '@wanuky10/web-editor';

// Saat file dipilih dari input
inputFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];

  // Baca nilai orientasi EXIF (1–8, atau 1 jika tidak ada EXIF)
  const orientasi = await bacaOrientasiExif(file);

  // Konversi ke transform CSS/Canvas
  const { rotate, flipH, flipV } = orientasiKeTransform(orientasi);
  // rotate: 0 | 90 | 180 | 270
  // flipH:  boolean
  // flipV:  boolean
});
```

`bacaOrientasiExif` hanya membaca 64KB pertama file untuk efisiensi.

| Nilai Orientasi | rotate | flipH | flipV | Keterangan |
|---|---|---|---|---|
| 1 | 0 | false | false | Normal |
| 2 | 0 | true | false | Mirror horizontal |
| 3 | 180 | false | false | Putar 180° |
| 4 | 180 | true | false | Mirror vertikal |
| 5 | 90 | true | false | Putar 90° + mirror |
| 6 | 90 | false | false | Putar 90° CW (foto portrait iPhone) |
| 7 | 270 | true | false | Putar 270° + mirror |
| 8 | 270 | false | false | Putar 270° CW |

---

### FormatManager

`FormatManager` adalah layer Selection API untuk contenteditable — digunakan secara internal oleh `RichTextEditor`. Tersedia sebagai export publik jika perlu membangun editor custom.

```js
import { FormatManager } from '@wanuky10/web-editor';

const fm = new FormatManager(
  document.querySelector('#area-edit'), // elemen contenteditable
  100,                                   // maxHistori (default 100)
  (html) => console.log('undo/redo', html) // callback setelah undo/redo
);

fm.toggleInline('bold');            // bold/italic/underline/strikethrough/superscript/subscript
fm.setBlok('h2');                   // heading, p, blockquote, code, dll.
fm.insertLink('https://...', 'Teks');
fm.insertGambar('https://...', 'Alt');
fm.hapusFormat();                   // removeFormat
fm.undo();
fm.redo();
fm.simpanSnapshot();                // simpan state ke histori manual
```

---

## Integrasi ke Proyek

### Struktur yang Direkomendasikan

```
proyek/
├── .npmrc                          ← konfigurasi GitHub Packages
├── package.json
├── backend/
│   ├── config/
│   │   └── templateEngine.js       ← inisialisasi engine sekali
│   └── controllers/
│       └── [fitur]/
│           └── [fitur]Controller.js
└── frontend/
    ├── views/
    │   ├── layouts/
    │   │   └── utama.html           ← layout dengan <contents></contents>
    │   ├── pages/
    │   │   └── [fitur]/
    │   │       └── index.html
    │   └── partials/
    │       ├── core/
    │       │   ├── navbar.html
    │       │   └── footer.html
    │       └── [fitur]/
    └── public/
        └── js/
            └── [fitur]/
                └── editor.js        ← import RichTextEditor / ImageEditor
```

### Pola Controller SSR

```js
// backend/controllers/artikel/artikelController.js
import { engine }         from '../../config/templateEngine.js';
import { ambilArtikel }   from '../../services/artikel/artikelService.js';

export async function tampilArtikel(req, res, next) {
  try {
    const artikel = await ambilArtikel(req.params.id);
    const html = await engine.render('pages/artikel/detail.html', { artikel }, 'utama');
    res.send(html);
  } catch (err) {
    next(err);
  }
}
```

### Simpan Output RichTextEditor ke Database

```js
// Server menerima { html, teks } dari fetch POST frontend
export async function simpanArtikel(req, res) {
  const { judul, html, teks } = req.body;

  // html  → disimpan dan ditampilkan (sudah ter-sanitasi oleh RTE)
  // teks  → untuk search index, preview, meta description
  await buatArtikel({ judul, kontenHtml: html, kontenTeks: teks });

  return successResponse(res, 201, 'Artikel berhasil disimpan');
}
```

---

## Catatan Penting

### Template Engine

**Operator `>` di kondisi:**
Karakter `>` di dalam `<if>` dianggap penutup tag. Untuk "lebih dari", tukar operan dan gunakan `<` atau ganti ke `>=`:

```html
<!-- ✗ Tidak bisa: -->
<if jumlah > 10>Banyak</if>

<!-- ✓ Tukar posisi operan: -->
<if 10 < jumlah>Banyak</if>

<!-- ✓ Atau gunakan >= dengan nilai +1: -->
<if jumlah >= 11>Banyak</if>
```

**Include path:**
Path di `<include="...">` selalu relatif dari **file yang sedang di-render**, bukan dari `dirViews`.

**Development tanpa cache:**
Set `cache: false` di development agar perubahan template langsung terlihat tanpa restart server. Di production, biarkan `cache: true` (default) dengan LRU 200 file.

**`<macro>` bersifat global per render:**
Macro yang didefinisikan di partial yang di-include tetap tersedia di seluruh halaman dalam satu siklus render.

### WebEditor

**Hanya berjalan di browser:**
Jangan import `@wanuky10/web-editor` di file Node.js/server. Gunakan hanya di JavaScript yang diload browser (`type="module"`).

**CSS editor:**
Kedua editor perlu styling. Gunakan class selector berikut di `public/css/components.css`:

```css
/* RichTextEditor */
.wanuky-rte { ... }
.wanuky-rte__toolbar { ... }
.wanuky-rte__area { ... }

/* ImageEditor */
.wanuky-ie { ... }
.wanuky-ie__toolbar { ... }
.wanuky-ie__canvas { ... }
.wanuky-ie__panel { ... }
.wanuky-ie__drop { ... }
.wanuky-ie__btn { ... }
.wanuky-ie__btn--aktif { ... }
.wanuky-ie__slider { ... }
.wanuky-ie__dropdown { ... }
```

**CSS filter browser support:**
`CanvasRenderingContext2D.filter` (digunakan ImageEditor v2.1.0 untuk brightness, contrast, saturasi, hue, blur, grayscale, sepia) didukung di Chrome 47+, Firefox 49+, Safari 18+. Pada browser lama, filter warna tidak berefek tetapi editor tetap berfungsi.

**`document.execCommand` deprecated:**
RichTextEditor menggunakan `execCommand` yang secara teknis deprecated di spesifikasi W3C, namun masih didukung penuh di semua browser modern. Tidak ada pengganti universal untuk contenteditable editing API.

---

*wanuky-lib v2.1.0 — dibuat untuk kebutuhan proyek pribadi.*
