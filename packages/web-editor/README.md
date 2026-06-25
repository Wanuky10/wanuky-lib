# @wanuky10/web-editor

Library editor web berbasis browser — `RichTextEditor` (contenteditable) dan `ImageEditor`
(Canvas) — tanpa dependensi eksternal. ES Modules, target browser modern (tidak ada build
step/transpile; lihat `engines` di `package.json`).

> **Status:** dipakai hanya secara internal (Wahid + tim). Belum ada konsumen eksternal —
> perubahan breaking pada API tidak memerlukan deprecation cycle formal sampai ada konsumen
> di luar monorepo ini.

## Instalasi

Paket ini didistribusikan lewat GitHub Packages (lihat `publishConfig` di `package.json`).
Di dalam monorepo (workspace), cukup:

```json
{
  "dependencies": {
    "@wanuky10/web-editor": "workspace:*"
  }
}
```

## Import

```js
import {
  RichTextEditor,
  ImageEditor,
  EditorError,
  sanitasi,
  bacaOrientasiExif,
  orientasiKeTransform,
  FormatManager,
} from '@wanuky10/web-editor';
```

Atau impor langsung per-modul (menghindari bundling yang tidak perlu jika hanya butuh satu
editor):

```js
import { RichTextEditor } from '@wanuky10/web-editor/rich-text';
import { ImageEditor }    from '@wanuky10/web-editor/image';
```

### Stylesheet

```js
import '@wanuky10/web-editor/style';
// atau '@wanuky10/web-editor/style.css' — keduanya menunjuk ke file yang sama
```

Kedua entry `exports` ini menunjuk ke `src/web-editor.css`. File ini berisi seluruh style
default untuk `.wanuky-ie` (ImageEditor) dan `.wanuky-rte` (RichTextEditor), memakai CSS
custom properties dengan fallback literal (`--wie-*`, `--wrte-*`) sehingga tampil benar
tanpa konfigurasi apa pun, sekaligus bisa di-theme oleh aplikasi consumer dengan
mendefinisikan ulang variabel bernama sama di `:root` (lihat ADR di header
`src/web-editor.css`).

Pada aplikasi yang mengikuti konvensi `wanuky-stack`, taruh/copy file ini sebagai
`frontend/public/css/core/webEditor.css` dan muat hanya pada halaman yang benar-benar
memakai salah satu editor.

## API

### `RichTextEditor`

```js
const editor = new RichTextEditor(container, {
  placeholder: 'Tulis sesuatu…',
  maxPanjang: 5000,
  maxHistori: 100,
  onChange: (html) => { /* ... */ },
});

editor.getHtml();
editor.setHtml('<p>Halo</p>');
editor.destroy();

editor.on('change', (html) => { /* ... */ });
editor.off('change', handler);
```

Fitur: toolbar modular (bold/italic/underline/strike, superscript/subscript, alignment,
heading, blockquote, code, list), color picker, font size, tabel, paste cleanup (sanitasi
HTML hasil paste — lihat bagian Sanitasi di bawah), upload gambar (disimpan sebagai data
URL base64), markdown shortcut (`**tebal**`, `# heading`, dst.), event system
(`on`/`off`/`emit`), history/undo-redo (lewat `FormatManager` internal).

### `ImageEditor`

```js
const editor = new ImageEditor(container, {
  maxLebar: 2000,
  maxTinggi: 2000,
  kualitas: 0.9,
});

await editor.muatFile(file);   // dari <input type="file">, EXIF orientation otomatis dikoreksi
await editor.muatUrl(url);
const blob = await editor.simpan();  // Promise<Blob>

editor.on('ubah', () => { /* ... */ });
editor.destroy();
```

Fitur: crop (rectangle/circle), zoom, flip, rotate (90° step + rotasi bebas), filter via
`ctx.filter` (brightness/contrast/saturate/dst.) + preset filter, rasio aspek crop, history/
undo, pinch-to-zoom (touch), pembacaan & koreksi orientasi EXIF otomatis saat `muatFile()`
(lihat `bacaOrientasiExif`/`orientasiKeTransform` di bawah — `ImageEditor` memanggil
keduanya secara internal; tidak perlu dipanggil manual kecuali butuh logic kustom).

**Manajemen memori:** `ImageEditor` membuat `Object URL` (`URL.createObjectURL`) saat
memuat gambar dari `File`/`Blob`. URL lama otomatis di-revoke (`URL.revokeObjectURL`) setiap
kali gambar baru dimuat dan saat `destroy()` dipanggil — jangan lupa panggil `destroy()`
saat komponen di-unmount untuk menghindari kebocoran memori.

#### Watermark brand

Watermark (gambar dan/atau teks) bisa diaktifkan lewat opsi constructor atau diatur ulang
secara runtime. Watermark **hanya di-burn-in saat `simpan()`** — canvas preview yang dilihat
user saat mengedit selalu bersih tanpa watermark.

```js
const editor = new ImageEditor(container, {
  watermark: {
    gambar: logoFile,        // File|Blob|string URL/dataURL — opsional
    teks: '© Wanuky 2026',   // string, maks 200 karakter — opsional
    posisi: 'bawah-kanan',   // salah satu dari 9 preset di bawah — default 'bawah-kanan'
    opacity: 0.6,            // 0–1 — default 0.6
    skala: 0.18,             // 0 < skala ≤ 1, relatif lebar kanvas output — default 0.18
    margin: 16,              // piksel dari tepi kanvas output — default 16
    warnaTeks: '#ffffff',    // default '#ffffff', hanya berlaku untuk watermark teks
    fontFamily: 'sans-serif', // default 'sans-serif', hanya berlaku untuk watermark teks
  },
});

// Runtime: ubah/ganti konfigurasi watermark setelah instansiasi.
// Memanggil ulang menggantikan konfigurasi sebelumnya SECARA PENUH (bukan merge parsial).
await editor.aturWatermark({ teks: 'DRAFT', posisi: 'tengah', opacity: 0.3 });

// Nonaktifkan watermark — aman dipanggil meski watermark belum pernah diaktifkan.
editor.hapusWatermark();

const blob = await editor.simpan(); // watermark aktif di-burn-in ke blob hasil di sini
```

Minimal salah satu dari `gambar` atau `teks` harus diisi. Jika keduanya diisi, gambar
digambar lebih dulu lalu teks di bawahnya, sebagai satu blok yang diposisikan bersama
sesuai `posisi`.

**9 posisi preset** (`watermark.posisi`) — 4 sudut, 4 tengah-sisi, 1 tengah:

```
atas-kiri      atas-tengah      atas-kanan
tengah-kiri    tengah           tengah-kanan
bawah-kiri     bawah-tengah     bawah-kanan
```

**Kontrak fail-loudly:** jika `watermark.gambar` gagal dimuat (URL invalid, network error,
dll.), `aturWatermark()` sendiri tetap **resolve** (preload gambar berjalan asinkron di
background, tidak memblokir pemanggil). Kegagalan baru terdeteksi saat `simpan()` dipanggil
berikutnya — pada kondisi ini `simpan()` me-**reject** dengan `EditorError` dan **tidak
menghasilkan blob sama sekali**. Ini desain sengaja: output tanpa watermark brand yang
seharusnya ada (mis. lisensi, hak cipta) lebih berbahaya secara silent daripada error yang
jelas — lihat ADR pada header `_gambarWatermarkKeCanvas()` di `src/imageEditor.js`.

```js
await editor.aturWatermark({ gambar: 'https://url-yang-tidak-valid.test/logo.png' });
// aturWatermark() resolve di sini meski URL invalid — preload gagal secara silent dulu.

try {
  await editor.simpan(); // baru di sini reject, karena watermark gambar gagal dimuat
} catch (e) {
  // e instanceof EditorError — TIDAK ADA blob yang dihasilkan.
}
```

`hapusWatermark()` juga membersihkan `Object URL` internal (jika watermark sebelumnya
memuat gambar dari `File`/`Blob`) — konsisten dengan pola manajemen memori `ImageEditor`
lainnya.

### `EditorError`

```js
class EditorError extends Error {
  constructor(message, options = {}) // options.cause didukung (native Error cause chaining)
}
```

Seluruh error yang dilempar oleh `RichTextEditor`, `ImageEditor`, dan `FormatManager` di
package ini adalah instance `EditorError` (bukan `Error` polos) — memudahkan
`catch (e) { if (e instanceof EditorError) ... }` di sisi consumer untuk membedakan error
yang sengaja dilempar package ini dari error runtime lain.

### `sanitasi(html, opts?)`

```js
sanitasi('<script>alert(1)</script><p>halo</p>');
// → '<p>halo</p>'

sanitasi(html, {
  aktif: true,             // default true; false = lewati sanitasi sepenuhnya
  tagDiizinkan: ['p', 'b'], // override whitelist tag default
  paksakanHttps: true,      // default true; href/src selain https:/mailto:/tel: dibuang
});
```

API publik untuk sanitasi HTML dari sumber yang tidak tepercaya (mis. HTML eksternal yang
akan dirender ke DOM). Whitelist tag default: `p, br, strong, b, em, i, u, s, del, h1, h2,
h3, ul, ol, li, blockquote, code, pre, a, img`. Atribut diizinkan: `a` → `href, target, rel`;
`img` → `src, alt, width, height`. Selalu melucuti atribut event handler (`on*`) dan
menambahkan `rel="noopener noreferrer"` pada `<a target="_blank">`.

> **Berjalan hanya di browser** — bergantung pada `DOMParser` native. Tidak bisa dipakai
> langsung di Node.js tanpa polyfill (`happy-dom`/`jsdom`) — lihat `tests/sanitizer.test.js`
> untuk contoh pemakaian dengan `happy-dom` di lingkungan test.

> **Catatan arsitektur:** sanitasi paste-cleanup internal `RichTextEditor`
> (`sanitasiHtml()`, privat, tidak diekspor) memakai whitelist yang lebih permisif (tabel,
> atribut `style` terbatas, `data:` URL untuk gambar upload) karena sumbernya adalah HTML
> hasil `contentEditable`/paste milik browser sendiri, bukan HTML eksternal sembarang — ini
> bukan inkonsistensi, melainkan dua threat model yang berbeda secara sengaja. Logic yang
> benar-benar identik di kedua sisi (pelucutan event handler, deteksi `javascript:`,
> `rel=noopener`) diekstrak ke `src/sanitizer-core.js` (internal, tidak diekspor) supaya
> tidak diverge saat salah satu sisi di-patch. Detail lengkap ada di ADR pada header
> `src/sanitizer-core.js`.

### `bacaOrientasiExif(file)` / `orientasiKeTransform(orientasi)`

```js
const orientasi = await bacaOrientasiExif(file); // 1-8, default 1 jika tidak ada EXIF/bukan JPEG
const { rotate, flipH, flipV } = orientasiKeTransform(orientasi);
```

Utilitas EXIF tingkat-rendah yang dipakai `ImageEditor.muatFile()` secara internal untuk
otomatis mengoreksi orientasi foto dari kamera/HP (yang sering tersimpan ter-rotate secara
visual tapi benar secara EXIF). Diekspor terpisah untuk kasus pemakaian yang butuh baca
orientasi tanpa instansiasi `ImageEditor` penuh.

### `FormatManager`

```js
const fm = new FormatManager(editAreaElement, /* maxHistori */ 100, /* onUndoRedo */ cb);

fm.snapshot();            // simpan state saat ini ke history (dipanggil sebelum tiap mutasi)
fm.undo(); fm.redo();
fm.bisaUndo; fm.bisaRedo;  // getter boolean

fm.toggleInline('strong'); // 'strong'|'em'|'u'|'del'|'code'
fm.setBlok('h2');           // 'p'|'h1'|'h2'|'h3'|'blockquote'|'pre'
fm.insertLink(url, label);  // throws EditorError jika url bukan https
fm.insertGambar(url, alt);
```

Dipakai secara internal oleh `RichTextEditor` untuk mengelola operasi format teks dan
history undo/redo lewat Selection API browser. Diekspor terpisah untuk kasus pemakaian yang
butuh logic format/history tanpa toolbar UI penuh `RichTextEditor`.

## Testing

```bash
npm test   # vitest run — 103 test (9 file), lingkungan happy-dom
```

## Versi

Lihat `CHANGELOG.md` (di-generate otomatis dari `.changeset/` via `changesets`) untuk
riwayat perubahan per versi.
