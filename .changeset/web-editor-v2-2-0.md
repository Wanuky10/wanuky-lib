---
"@wanuky10/web-editor": minor
---

V2.2.0 — empat perbaikan internal pada `ImageEditor`, sanitasi HTML, dan packaging:

- **EXIF rotation wiring**: `ImageEditor.muatFile()` sekarang benar-benar memanggil
  `bacaOrientasiExif`/`orientasiKeTransform` dan menerapkan koreksi rotasi/flip secara
  otomatis saat memuat foto dari kamera/HP. Memperbaiki kebocoran `Object URL`
  (`URL.createObjectURL`) — URL lama sekarang di-revoke setiap kali gambar baru dimuat dan
  saat `destroy()` dipanggil.
- **Konsolidasi sanitizer**: primitif yang identik antara `sanitasi()` (API publik, ketat)
  dan `sanitasiHtml()` privat di `RichTextEditor` (permisif, untuk hasil paste/upload)
  diekstrak ke `sanitizer-core.js` internal — pelucutan event handler, deteksi
  `javascript:`, `rel=noopener`. Whitelist tag/atribut dan strategi validasi URL kedua sisi
  tetap terpisah secara sengaja (threat model berbeda). Opsi `atributDiizinkan` yang
  terdokumentasi tapi tidak pernah diimplementasikan dihapus dari `SanitasiOptions`.
  Ditambah test suite (`tests/sanitizer.test.js`, 27 test).
- **Standardisasi `EditorError`**: seluruh `throw`/`reject` di `ImageEditor` (termasuk
  `_simpanGambar()`) sekarang konsisten melempar `EditorError`, bukan `Error` polos —
  memudahkan consumer membedakan error package ini lewat `instanceof EditorError`.
- **Stylesheet resmi** (`src/web-editor.css`), diekspor lewat `package.json` exports sebagai
  `@wanuky10/web-editor/style` dan `@wanuky10/web-editor/style.css`. Mencakup seluruh class
  `.wanuky-ie__*`/`.wanuky-rte__*`, memakai CSS custom properties dengan fallback literal
  (`--wie-*`, `--wrte-*`) agar tampil benar standalone sekaligus themable oleh aplikasi
  consumer.

Tidak ada breaking change pada signature API publik (`RichTextEditor`, `ImageEditor`,
`sanitasi`, `bacaOrientasiExif`, `orientasiKeTransform`, `FormatManager`). Package ini saat
ini hanya dipakai secara internal — belum ada konsumen eksternal yang terdampak.
