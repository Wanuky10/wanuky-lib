---
"@wanuky10/web-editor": minor
---

Fitur watermark brand pada `ImageEditor` — gambar dan/atau teks, diaktifkan lewat opsi
constructor `watermark` atau diatur ulang secara runtime via `aturWatermark()`/
`hapusWatermark()`.

- **Burn-in hanya saat `simpan()`**: canvas preview yang dilihat user saat mengedit selalu
  bersih tanpa watermark — watermark baru digambar ke kanvas output final tepat sebelum
  `toBlob()` dipanggil.
- **9 posisi preset** (`watermark.posisi`): 4 sudut, 4 tengah-sisi, dan 1 tengah
  (`atas-kiri`, `atas-tengah`, `atas-kanan`, `tengah-kiri`, `tengah`, `tengah-kanan`,
  `bawah-kiri`, `bawah-tengah`, `bawah-kanan`). Sengaja tidak menyediakan koordinat XY
  custom atau rotasi — sembilan preset mencakup seluruh kebutuhan praktis penempatan
  watermark brand tanpa membuka permukaan API yang lebih kompleks dari yang dibutuhkan.
- **Parameter tambahan**: `opacity` (0–1, default 0.6), `skala` (0 < skala ≤ 1, relatif
  lebar kanvas output, default 0.18), `margin` (piksel dari tepi kanvas output, default 16),
  serta `warnaTeks` (default `#ffffff`) dan `fontFamily` (default `sans-serif`) khusus untuk
  watermark teks. Gambar dan teks bisa dikombinasikan sebagai satu blok yang diposisikan
  bersama.
- **Kontrak fail-loudly**: jika `watermark.gambar` gagal dimuat, `simpan()` me-reject dengan
  `EditorError` dan **tidak menghasilkan blob sama sekali** — mencegah output tanpa
  watermark brand (mis. lisensi/hak cipta) yang seharusnya ada lolos secara silent.
  `aturWatermark()` sendiri tetap resolve di kasus ini (preload gambar berjalan asinkron di
  background); reject baru terjadi saat `simpan()` berikutnya dipanggil.
- Memanggil `aturWatermark()` berkali-kali menggantikan konfigurasi watermark sebelumnya
  secara penuh (bukan merge parsial) — konsisten dengan cara opsi lain di `ImageEditor`
  diperlakukan. `hapusWatermark()` aman dipanggil meski watermark belum pernah diaktifkan,
  dan membersihkan Object URL internal jika watermark sebelumnya memuat gambar dari
  `File`/`Blob`.

Ditambah test suite penuh (`tests/imageEditor-watermark.test.js`, 58 test) yang menutup
seluruh kombinasi posisi/opacity/skala/margin, kontrak fail-loudly, perilaku
`hapusWatermark()`, dan perilaku replace-wholesale pada pemanggilan `aturWatermark()`
berulang.

Tidak ada breaking change pada signature API publik yang sudah ada (`RichTextEditor`,
`ImageEditor`, `sanitasi`, `bacaOrientasiExif`, `orientasiKeTransform`, `FormatManager`).
Package ini saat ini hanya dipakai secara internal — belum ada konsumen eksternal yang
terdampak.
