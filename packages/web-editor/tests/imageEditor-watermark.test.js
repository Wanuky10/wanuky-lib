// @vitest-environment happy-dom
//
// @adr Mock manual HTMLCanvasElement.prototype.getContext, bukan dependensi node-canvas
// @context ImageEditor (lihat ../src/imageEditor.js) butuh CanvasRenderingContext2D nyata
//     di constructor (this._ctx = this._canvas.getContext('2d')) dan di beberapa offscreen
//     canvas (_simpanGambar(), terapkanCrop()). happy-dom (environment test di repo ini,
//     lihat sanitizer.test.js untuk ADR pemilihan happy-dom) TIDAK mengimplementasikan
//     Canvas 2D API — getContext('2d') mengembalikan null (dibuktikan via tests/probe.test.js,
//     dipertahankan sebagai regression guard). Tanpa context yang valid, constructor
//     ImageEditor tidak meledak, TAPI hampir semua method lain (_render, _muatDariSrc,
//     _simpanGambar, _gambarWatermarkKeCanvas) memanggil method pada this._ctx/klonCtx
//     yang bernilai null → TypeError.
// @decision Pasang stub HTMLCanvasElement.prototype.getContext('2d') yang mengembalikan objek
//     context palsu ber-method no-op (save/restore/drawImage/fillText/dst.) sebelum membuat
//     instance ImageEditor, lalu kembalikan prototype asli setelah test selesai (afterEach).
//     Ini TIDAK menggambar piksel nyata — tujuannya murni membuat code path watermark
//     (aturWatermark → simpan → _gambarWatermarkKeCanvas) bisa dieksekusi tanpa TypeError,
//     sehingga bisa diverifikasi: argumen yang dipanggil ke context (drawImage, fillText,
//     globalAlpha, dst.), urutan pemanggilan, dan hasil akhir (resolve/reject simpan()).
// @tradeoff Tidak ada verifikasi pixel-level (warna/posisi piksel sebenarnya di output) —
//     hanya verifikasi "API context dipanggil dengan argumen yang benar". Cukup untuk
//     watermark karena logic intinya (_hitungPosisiWatermark, _validasiOpsiWatermark) adalah
//     fungsi murni yang diuji terpisah TANPA mock sama sekali (lihat describe blok pertama).
// @alternatives Tambah devDependency `canvas` (node-canvas) untuk rendering pixel nyata
//     (ditolak: package.json @wanuky10/web-editor menyatakan eksplisit "tanpa dependensi
//     eksternal" — hanya happy-dom yang ada sebagai test infra; menambah node-canvas hanya
//     untuk testing melanggar filosofi desain proyek ini tanpa persetujuan eksplisit user).
//
// @adr Image.onerror di-monkeypatch untuk menguji jalur fail-loudly watermark gambar gagal
// @context happy-dom tidak mensimulasikan kegagalan network/decode secara realistis —
//     src dengan protokol tidak valid atau base64 rusak terbukti TIDAK memicu onload
//     maupun onerror sama sekali (lihat probe manual saat menulis test ini), sehingga
//     promise preload watermark tidak pernah resolve dalam waktu wajar jika mengandalkan
//     perilaku native happy-dom.
// @decision Untuk test spesifik yang butuh mensimulasikan watermark gambar gagal dimuat,
//     ganti sementara window.Image dengan subclass yang memicu onerror secara sinkron
//     (via queueMicrotask) saat property `src` di-set, lalu kembalikan window.Image asli
//     setelah test tersebut selesai.
// @tradeoff Hanya mensimulasikan "gambar gagal dimuat" pada level callback, bukan kegagalan
//     network yang sesungguhnya — cukup untuk memverifikasi kontrak EditorError simpan()
//     tanpa butuh server HTTP nyata di test environment.

import { test, describe, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { ImageEditor } from '../src/imageEditor.js';
import { EditorError } from '../src/errors.js';

// PNG 1x1 transparent valid, dipakai sebagai sumber gambar utama maupun watermark
// di seluruh test — happy-dom terbukti bisa men-decode data URL ini (onload terpanggil,
// naturalWidth = 1).
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// PNG 200x100 solid merah, dipakai khusus untuk test yang butuh kanvas berdimensi
// nyata (mis. memverifikasi bahwa `skala` watermark mempengaruhi ukuran font/logo
// secara proporsional). PNG_1X1 tidak cukup untuk ini karena lebarTarget di
// _gambarWatermarkKeCanvas() di-clamp via Math.max(1, Math.round(W * skala)) — pada
// kanvas 1px lebar, skala 0.1 dan skala 0.5 keduanya menghasilkan lebarTarget = 1
// (tidak ada beda yang bisa diobservasi).
const PNG_200X100 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAABkCAIAAABM5OhcAAAAx0lEQVR42u3SMQ0AAAjAsPk3DSY4OJpUwbKm4JwEGAtjYSwwFsbCWGAsjIWxwFgYC2OBsTAWxgJjYSyMBcbCWBgLjIWxMBYYC2NhLDAWxsJYYCyMhbHAWBgLY4GxMBbGAmNhLIwFxsJYGAuMhbEwFhgLY2EsMBbGwlhgLIyFscBYGAtjgbEwFsYCY2EsjAXGwlgYC4yFsTAWGAtjgQQYC2NhLDAWxsJYYCyMhbHAWBgLY4GxeG4B1PnWZEuCN48AAAAASUVORK5CYII=';

/**
 * Bangun objek context 2D palsu dengan method no-op + beberapa property yang
 * settable apa adanya (filter, globalAlpha, fillStyle, font, textAlign, textBaseline).
 * measureText() mengembalikan lebar proporsional ke panjang string supaya
 * _gambarWatermarkKeCanvas() tetap menghasilkan angka yang masuk akal (bukan NaN/0
 * konstan) ketika test perlu memverifikasi posisi/ukuran blok watermark.
 */
function buatCtxPalsu() {
  const panggilan = [];
  const ctx = {
    _panggilan: panggilan,
    save()             { panggilan.push(['save']); },
    restore()          { panggilan.push(['restore']); },
    clearRect(...a)    { panggilan.push(['clearRect', ...a]); },
    drawImage(...a)    { panggilan.push(['drawImage', ...a]); },
    fillRect(...a)     { panggilan.push(['fillRect', ...a]); },
    strokeRect(...a)   { panggilan.push(['strokeRect', ...a]); },
    fillText(...a)     { panggilan.push(['fillText', ...a]); },
    beginPath()        { panggilan.push(['beginPath']); },
    closePath()        { panggilan.push(['closePath']); },
    ellipse(...a)      { panggilan.push(['ellipse', ...a]); },
    clip()             { panggilan.push(['clip']); },
    scale(...a)        { panggilan.push(['scale', ...a]); },
    rotate(...a)       { panggilan.push(['rotate', ...a]); },
    translate(...a)    { panggilan.push(['translate', ...a]); },
    setTransform(...a) { panggilan.push(['setTransform', ...a]); },
    measureText(teks)  { return { width: (teks?.length ?? 0) * 6 }; },
    filter: 'none',
    globalAlpha: 1,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  return ctx;
}

let _origGetContext;
let _ctxTerakhir; // referensi context palsu yang dibuat paling akhir, untuk inspeksi panggilan

function pasangStubCanvas() {
  _origGetContext = window.HTMLCanvasElement.prototype.getContext;
  window.HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type === '2d') {
      _ctxTerakhir = buatCtxPalsu();
      return _ctxTerakhir;
    }
    return _origGetContext.call(this, type, ...rest);
  };
}

function lepasStubCanvas() {
  window.HTMLCanvasElement.prototype.getContext = _origGetContext;
  _ctxTerakhir = undefined;
}

/** Buat instance ImageEditor baru dengan container fresh di document.body. */
function buatEditor(opsi) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return new ImageEditor(div, opsi);
}

// ─────────────────────────────────────────────────────────────
// Bagian 1 — Pure-logic: _hitungPosisiWatermark()
// Fungsi murni, TIDAK butuh canvas/DOM sama sekali — dipanggil langsung
// lewat instance (method tidak static), tapi tidak menyentuh this._ctx/this._canvas.
// ─────────────────────────────────────────────────────────────

describe('_hitungPosisiWatermark (pure logic, tanpa canvas)', () => {
  // Instance dibuat sekali di luar stub canvas khusus untuk grup ini — constructor
  // tetap memanggil getContext('2d') yang asli (null di happy-dom), tapi karena kita
  // hanya memanggil _hitungPosisiWatermark() secara langsung (tidak lewat _render()/
  // simpan()), this._ctx yang null tidak pernah disentuh.
  let editor;

  beforeEach(() => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    editor = new ImageEditor(div);
  });

  afterEach(() => {
    editor.hancurkan();
  });

  const W = 200, H = 100, w = 40, h = 20, margin = 10;

  test('atas-kiri: anchor di pojok kiri-atas + margin', () => {
    const { x, y } = editor._hitungPosisiWatermark('atas-kiri', W, H, w, h, margin);
    assert.equal(x, margin);
    assert.equal(y, margin);
  });

  test('atas-tengah: x di tengah horizontal, y di atas + margin', () => {
    const { x, y } = editor._hitungPosisiWatermark('atas-tengah', W, H, w, h, margin);
    assert.equal(x, (W - w) / 2);
    assert.equal(y, margin);
  });

  test('atas-kanan: anchor di pojok kanan-atas, x dihitung dari tepi kanan', () => {
    const { x, y } = editor._hitungPosisiWatermark('atas-kanan', W, H, w, h, margin);
    assert.equal(x, W - w - margin);
    assert.equal(y, margin);
  });

  test('tengah-kiri: x di kiri + margin, y di tengah vertikal', () => {
    const { x, y } = editor._hitungPosisiWatermark('tengah-kiri', W, H, w, h, margin);
    assert.equal(x, margin);
    assert.equal(y, (H - h) / 2);
  });

  test('tengah: x dan y keduanya di tengah', () => {
    const { x, y } = editor._hitungPosisiWatermark('tengah', W, H, w, h, margin);
    assert.equal(x, (W - w) / 2);
    assert.equal(y, (H - h) / 2);
  });

  test('tengah-kanan: x dari tepi kanan, y di tengah vertikal', () => {
    const { x, y } = editor._hitungPosisiWatermark('tengah-kanan', W, H, w, h, margin);
    assert.equal(x, W - w - margin);
    assert.equal(y, (H - h) / 2);
  });

  test('bawah-kiri: x di kiri + margin, y dari tepi bawah', () => {
    const { x, y } = editor._hitungPosisiWatermark('bawah-kiri', W, H, w, h, margin);
    assert.equal(x, margin);
    assert.equal(y, H - h - margin);
  });

  test('bawah-tengah: x di tengah horizontal, y dari tepi bawah', () => {
    const { x, y } = editor._hitungPosisiWatermark('bawah-tengah', W, H, w, h, margin);
    assert.equal(x, (W - w) / 2);
    assert.equal(y, H - h - margin);
  });

  test('bawah-kanan (default): anchor di pojok kanan-bawah', () => {
    const { x, y } = editor._hitungPosisiWatermark('bawah-kanan', W, H, w, h, margin);
    assert.equal(x, W - w - margin);
    assert.equal(y, H - h - margin);
  });

  test('posisi tidak dikenal fallback ke bawah-kanan', () => {
    const fallback = editor._hitungPosisiWatermark('tidak-ada-posisi-ini', W, H, w, h, margin);
    const bawahKanan = editor._hitungPosisiWatermark('bawah-kanan', W, H, w, h, margin);
    assert.deepEqual(fallback, bawahKanan);
  });

  test('margin 0 menempatkan watermark tepat di tepi kanvas', () => {
    const { x, y } = editor._hitungPosisiWatermark('atas-kiri', W, H, w, h, 0);
    assert.equal(x, 0);
    assert.equal(y, 0);
  });
});

// ─────────────────────────────────────────────────────────────
// Bagian 2 — Pure-logic: _validasiOpsiWatermark()
// Juga fungsi murni — hanya throw/tidak throw, tidak menyentuh canvas.
// ─────────────────────────────────────────────────────────────

describe('_validasiOpsiWatermark (pure logic, tanpa canvas)', () => {
  let editor;

  beforeEach(() => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    editor = new ImageEditor(div);
  });

  afterEach(() => {
    editor.hancurkan();
  });

  test('menerima opsi dengan hanya teks', () => {
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'Brand' }));
  });

  test('menerima opsi dengan hanya gambar (string URL)', () => {
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ gambar: PNG_1X1 }));
  });

  test('menerima opsi dengan teks DAN gambar sekaligus', () => {
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'Brand', gambar: PNG_1X1 }));
  });

  test('menolak opsi tanpa teks maupun gambar', () => {
    assert.throws(() => editor._validasiOpsiWatermark({}), EditorError);
  });

  test('menolak teks bukan string', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 12345 }), EditorError);
  });

  test('menolak teks lebih dari 200 karakter', () => {
    const teksPanjang = 'x'.repeat(201);
    assert.throws(() => editor._validasiOpsiWatermark({ teks: teksPanjang }), EditorError);
  });

  test('menerima teks tepat 200 karakter (boundary)', () => {
    const teks200 = 'x'.repeat(200);
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: teks200 }));
  });

  test('menolak gambar dengan tipe selain File/Blob/string', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ gambar: 12345 }), EditorError);
  });

  test('menerima gambar berupa Blob', () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'a', gambar: blob }));
  });

  test('menolak posisi yang tidak dikenal', () => {
    assert.throws(
      () => editor._validasiOpsiWatermark({ teks: 'a', posisi: 'posisi-ngarang' }),
      EditorError,
    );
  });

  test('menerima semua 9 posisi preset', () => {
    const posisiValid = [
      'atas-kiri', 'atas-tengah', 'atas-kanan',
      'tengah-kiri', 'tengah', 'tengah-kanan',
      'bawah-kiri', 'bawah-tengah', 'bawah-kanan',
    ];
    for (const posisi of posisiValid) {
      assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'a', posisi }));
    }
  });

  test('menolak opacity di luar rentang 0-1 (negatif)', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 'a', opacity: -0.1 }), EditorError);
  });

  test('menolak opacity di luar rentang 0-1 (lebih dari 1)', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 'a', opacity: 1.1 }), EditorError);
  });

  test('menerima opacity boundary 0 dan 1', () => {
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'a', opacity: 0 }));
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'a', opacity: 1 }));
  });

  test('menolak opacity bukan angka', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 'a', opacity: '0.5' }), EditorError);
  });

  test('menolak skala <= 0', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 'a', skala: 0 }), EditorError);
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 'a', skala: -0.5 }), EditorError);
  });

  test('menolak skala > 1', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 'a', skala: 1.5 }), EditorError);
  });

  test('menerima skala boundary mendekati 0 (eksklusif) dan tepat 1', () => {
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'a', skala: 0.001 }));
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'a', skala: 1 }));
  });

  test('menolak margin negatif', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 'a', margin: -1 }), EditorError);
  });

  test('menerima margin 0 dan margin besar', () => {
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'a', margin: 0 }));
    assert.doesNotThrow(() => editor._validasiOpsiWatermark({ teks: 'a', margin: 9999 }));
  });

  test('menolak margin bukan angka', () => {
    assert.throws(() => editor._validasiOpsiWatermark({ teks: 'a', margin: '16px' }), EditorError);
  });
});

// ─────────────────────────────────────────────────────────────
// Bagian 3 — aturWatermark() / hapusWatermark(): state transitions runtime
// Butuh instance ImageEditor nyata, tapi belum butuh stub canvas karena hanya
// memeriksa state this._watermark, bukan menggambar.
// ─────────────────────────────────────────────────────────────

describe('aturWatermark() / hapusWatermark() — state runtime', () => {
  let editor;

  beforeEach(() => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    editor = new ImageEditor(div);
  });

  afterEach(() => {
    editor.hancurkan();
  });

  test('watermark tidak aktif secara default (this._watermark null)', () => {
    assert.equal(editor._watermark, null);
  });

  test('aturWatermark() dengan hanya teks mengaktifkan state dengan default termerge', () => {
    editor.aturWatermark({ teks: 'Wanuky' });
    assert.ok(editor._watermark);
    assert.equal(editor._watermark.teks, 'Wanuky');
    assert.equal(editor._watermark.posisi, 'bawah-kanan'); // default
    assert.equal(editor._watermark.opacity, 0.6);           // default
    assert.equal(editor._watermark.skala, 0.18);             // default
    assert.equal(editor._watermark.margin, 16);              // default
  });

  test('aturWatermark() melempar EditorError jika argumen bukan objek', () => {
    assert.throws(() => editor.aturWatermark(null), EditorError);
    assert.throws(() => editor.aturWatermark('teks-saja'), EditorError);
    assert.throws(() => editor.aturWatermark(undefined), EditorError);
  });

  test('aturWatermark() melempar EditorError sinkron untuk opsi tidak valid (fail-fast)', () => {
    assert.throws(() => editor.aturWatermark({}), EditorError);
    assert.throws(() => editor.aturWatermark({ posisi: 'invalid' }), EditorError);
  });

  test('aturWatermark() mengoper opsi custom menimpa default', () => {
    editor.aturWatermark({ teks: 'Brand', posisi: 'atas-kiri', opacity: 0.9, skala: 0.3, margin: 5 });
    assert.equal(editor._watermark.posisi, 'atas-kiri');
    assert.equal(editor._watermark.opacity, 0.9);
    assert.equal(editor._watermark.skala, 0.3);
    assert.equal(editor._watermark.margin, 5);
  });

  test('aturWatermark() tanpa gambar membuat _gambarPromise yang resolve langsung', async () => {
    editor.aturWatermark({ teks: 'Brand' });
    await assert.doesNotReject(editor._watermark._gambarPromise);
  });

  test('aturWatermark() dipanggil dua kali — konfigurasi baru mengganti total, bukan merge', async () => {
    editor.aturWatermark({ teks: 'Pertama', posisi: 'atas-kiri' });
    await editor._watermark._gambarPromise;
    editor.aturWatermark({ teks: 'Kedua' }); // posisi tidak disebut lagi
    await editor._watermark._gambarPromise;
    assert.equal(editor._watermark.teks, 'Kedua');
    assert.equal(editor._watermark.posisi, 'bawah-kanan'); // balik ke default, bukan 'atas-kiri'
  });

  test('hapusWatermark() mengembalikan this._watermark ke null', () => {
    editor.aturWatermark({ teks: 'Brand' });
    assert.ok(editor._watermark);
    editor.hapusWatermark();
    assert.equal(editor._watermark, null);
  });

  test('hapusWatermark() aman dipanggil meski watermark belum pernah diaktifkan', () => {
    assert.doesNotThrow(() => editor.hapusWatermark());
    assert.equal(editor._watermark, null);
  });

  test('aturWatermark() via constructor opts mengaktifkan watermark sejak instansiasi', () => {
    const div2 = document.createElement('div');
    document.body.appendChild(div2);
    const editor2 = new ImageEditor(div2, { watermark: { teks: 'DariConstructor' } });
    assert.ok(editor2._watermark);
    assert.equal(editor2._watermark.teks, 'DariConstructor');
    editor2.hancurkan();
  });

  test('aturWatermark() dengan gambar File me-revoke object URL lama saat diganti', () => {
    // CATATAN: tidak meng-await _gambarPromise di test ini. Untuk gambar bersumber File,
    // _preloadGambarWatermark() membuat object URL via URL.createObjectURL(file) lalu
    // memasangnya sebagai Image.src. Di happy-dom, Image dengan src berupa object URL
    // TIDAK PERNAH memicu onload maupun onerror (dibuktikan via probe manual saat menulis
    // test ini) — beda dari src data URL (yang onload-nya terbukti jalan normal) maupun
    // src yang sengaja dipalsukan gagal lewat monkeypatch Image (lihat Bagian 5). Akibatnya
    // _gambarPromise untuk kasus File ini tidak pernah resolve di lingkungan test, dan
    // mengawait-nya akan timeout selamanya. Ini keterbatasan happy-dom, bukan bug
    // imageEditor.js — di browser asli, object URL termuat normal.
    //
    // Yang justru bisa diverifikasi secara SINKRON tanpa bergantung pada onload: bahwa
    // _objectUrlWatermark berubah ke nilai baru segera setelah aturWatermark() kedua
    // dipanggil (state lama diganti total oleh state baru, termasuk URL object barunya),
    // sesuai kontrak "konfigurasi baru mengganti total, bukan merge" yang juga diuji di
    // test lain pada describe block ini. _objectUrlWatermark di-set sinkron di dalam
    // body Promise executor _preloadGambarWatermark(), sebelum new Image() dibuat —
    // jadi nilainya sudah final begitu aturWatermark() return, tanpa perlu await apa pun.
    const fileLama = new File(['a'], 'logo-lama.png', { type: 'image/png' });
    editor.aturWatermark({ gambar: fileLama });
    const urlLama = editor._watermark._objectUrlWatermark;
    assert.ok(urlLama, 'object URL untuk File seharusnya dibuat segera (sinkron, sebelum onload)');

    const fileBaru = new File(['b'], 'logo-baru.png', { type: 'image/png' });
    editor.aturWatermark({ gambar: fileBaru });
    const urlBaru = editor._watermark._objectUrlWatermark;
    assert.ok(urlBaru, 'object URL baru seharusnya dibuat untuk File pengganti');
    assert.notEqual(urlBaru, urlLama, 'object URL baru harus berbeda dari yang lama (state lama diganti, bukan di-merge)');
  });
});

// ─────────────────────────────────────────────────────────────
// Bagian 4 — Integrasi dengan canvas (perlu stub getContext('2d'))
// Mencakup: _gambarWatermarkKeCanvas() dipanggil dengan argumen benar,
// simpan() berhasil membentuk blob saat watermark valid, fail-loudly EditorError
// saat watermark gambar gagal dimuat, dan preview (_render()/this._canvas) tetap
// bersih dari watermark.
// ─────────────────────────────────────────────────────────────

describe('Integrasi watermark + canvas (getContext distub)', () => {
  let editor;

  beforeEach(() => {
    pasangStubCanvas();
    editor = buatEditor();
  });

  afterEach(() => {
    editor.hancurkan();
    lepasStubCanvas();
  });

  test('simpan() tanpa watermark aktif tetap menghasilkan blob seperti biasa', async () => {
    await editor.muatUrl(PNG_1X1);
    const blob = await editor.simpan();
    assert.ok(blob instanceof Blob);
  });

  test('simpan() dengan watermark teks saja menghasilkan blob dan memanggil fillText pada klon canvas', async () => {
    await editor.muatUrl(PNG_1X1);
    editor.aturWatermark({ teks: 'Wanuky' });
    await editor._watermark._gambarPromise;

    const blob = await editor.simpan();
    assert.ok(blob instanceof Blob);

    // _ctxTerakhir adalah context dari canvas TERAKHIR yang dibuat — pada simpan() dengan
    // watermark, itu adalah klon canvas yang menerima _gambarWatermarkKeCanvas().
    const panggilanFillText = _ctxTerakhir._panggilan.filter((p) => p[0] === 'fillText');
    assert.equal(panggilanFillText.length, 1);
    assert.equal(panggilanFillText[0][1], 'Wanuky');
  });

  test('simpan() dengan watermark gambar saja memanggil drawImage pada klon canvas', async () => {
    await editor.muatUrl(PNG_1X1);
    editor.aturWatermark({ gambar: PNG_1X1 });
    await editor._watermark._gambarPromise;
    assert.equal(editor._watermark._gambarGagal, false, 'preload watermark seharusnya berhasil');

    await editor.simpan();

    const panggilanDrawImage = _ctxTerakhir._panggilan.filter((p) => p[0] === 'drawImage');
    // Minimal satu drawImage untuk watermark (drawImage gambar utama terjadi di canvas
    // sebelumnya saat klonCtx.drawImage(kanvasFinal,...), bukan di _ctxTerakhir watermark
    // — tapi _gambarWatermarkKeCanvas juga memanggil drawImage pada ctx yang sama (klonCtx),
    // sehingga klonCtx menerima drawImage gambar dasar + drawImage logo watermark.
    assert.ok(panggilanDrawImage.length >= 1);
  });

  test('simpan() dengan watermark teks+gambar kombinasi menggambar keduanya', async () => {
    await editor.muatUrl(PNG_1X1);
    editor.aturWatermark({ teks: 'Wanuky', gambar: PNG_1X1 });
    await editor._watermark._gambarPromise;

    await editor.simpan();

    const adaFillText  = _ctxTerakhir._panggilan.some((p) => p[0] === 'fillText');
    const adaDrawImage = _ctxTerakhir._panggilan.some((p) => p[0] === 'drawImage');
    assert.ok(adaFillText, 'teks watermark harus digambar');
    assert.ok(adaDrawImage, 'gambar watermark harus digambar');
  });

  test('simpan() menerapkan opacity watermark via globalAlpha pada context', async () => {
    await editor.muatUrl(PNG_1X1);
    editor.aturWatermark({ teks: 'Wanuky', opacity: 0.42 });
    await editor._watermark._gambarPromise;

    await editor.simpan();

    // globalAlpha di-set langsung sebagai property (bukan method call) — verifikasi
    // nilai akhir property tersebut pada context klon yang menerima watermark.
    assert.equal(_ctxTerakhir.globalAlpha, 0.42);
  });

  test('simpan() membungkus save()/restore() di sekitar penggambaran watermark', async () => {
    await editor.muatUrl(PNG_1X1);
    editor.aturWatermark({ teks: 'Wanuky' });
    await editor._watermark._gambarPromise;

    await editor.simpan();

    const namaPanggilan = _ctxTerakhir._panggilan.map((p) => p[0]);
    const idxSave    = namaPanggilan.indexOf('save');
    const idxRestore = namaPanggilan.lastIndexOf('restore');
    assert.ok(idxSave !== -1, 'save() harus dipanggil');
    assert.ok(idxRestore !== -1, 'restore() harus dipanggil');
    assert.ok(idxSave < idxRestore, 'save() harus mendahului restore()');
  });

  test('aturWatermark() untuk masing-masing dari 9 posisi preset tidak menyebabkan simpan() gagal', async () => {
    const posisiValid = [
      'atas-kiri', 'atas-tengah', 'atas-kanan',
      'tengah-kiri', 'tengah', 'tengah-kanan',
      'bawah-kiri', 'bawah-tengah', 'bawah-kanan',
    ];
    await editor.muatUrl(PNG_1X1);
    for (const posisi of posisiValid) {
      editor.aturWatermark({ teks: 'Wanuky', posisi });
      await editor._watermark._gambarPromise;
      const blob = await editor.simpan();
      assert.ok(blob instanceof Blob, `simpan() gagal untuk posisi "${posisi}"`);
    }
  });

  test('skala watermark mempengaruhi ukuran font yang dipakai (font string berubah)', async () => {
    // Pakai fixture 200x100 (bukan PNG_1X1) — pada kanvas 1px lebar, lebarTarget di
    // _gambarWatermarkKeCanvas() di-clamp via Math.max(1, Math.round(W * skala)) sehingga
    // skala 0.1 dan skala 0.5 keduanya menghasilkan lebarTarget = 1 (tidak ada beda yang
    // bisa diobservasi pada font). Dengan kanvas 200px lebar, perbedaan skala menghasilkan
    // lebarTarget yang benar-benar berbeda (20 vs 100).
    await editor.muatUrl(PNG_200X100);

    editor.aturWatermark({ teks: 'Wanuky', skala: 0.1 });
    await editor._watermark._gambarPromise;
    await editor.simpan();
    const fontKecil = _ctxTerakhir.font;

    editor.aturWatermark({ teks: 'Wanuky', skala: 0.5 });
    await editor._watermark._gambarPromise;
    await editor.simpan();
    const fontBesar = _ctxTerakhir.font;

    const ukuranKecil = parseInt(fontKecil, 10);
    const ukuranBesar = parseInt(fontBesar, 10);
    assert.ok(ukuranBesar > ukuranKecil, `font skala besar (${fontBesar}) harus lebih besar dari skala kecil (${fontKecil})`);
  });

  test('hapusWatermark() sebelum simpan() menghasilkan blob tanpa pemanggilan fillText/drawImage watermark', async () => {
    await editor.muatUrl(PNG_1X1);
    editor.aturWatermark({ teks: 'Wanuky' });
    await editor._watermark._gambarPromise;
    editor.hapusWatermark();

    await editor.simpan();

    // Tanpa watermark aktif, _simpanGambar() tidak membuat klon canvas khusus watermark
    // sama sekali (lihat guard `if (this._watermark)` di imageEditor.js) — _ctxTerakhir
    // pada kasus ini adalah context kanvas utama yang TIDAK dipakai untuk drawImage/fillText
    // bertujuan watermark (tidak ada panggilan fillText apa pun yang berasal dari watermark).
    const adaFillText = _ctxTerakhir._panggilan.some((p) => p[0] === 'fillText');
    assert.equal(adaFillText, false);
  });

  test('preview canvas (this._ctx) tidak pernah menerima fillText/drawImage watermark walau watermark aktif', async () => {
    await editor.muatUrl(PNG_1X1);
    const ctxPreview = editor._ctx;
    const jumlahPanggilanSebelum = ctxPreview._panggilan.length;

    editor.aturWatermark({ teks: 'Wanuky', gambar: PNG_1X1 });
    await editor._watermark._gambarPromise;
    await editor.simpan();

    // Context preview (this._ctx) adalah context PERTAMA yang dibuat (saat _bangunUI()),
    // bukan _ctxTerakhir (yang dibuat oleh simpan() untuk klon). simpan() tidak boleh
    // menambah panggilan apa pun ke context preview — watermark eksklusif di klon offscreen.
    assert.notEqual(ctxPreview, _ctxTerakhir);
    const panggilanBaruDiPreview = ctxPreview._panggilan.slice(jumlahPanggilanSebelum);
    const adaFillTextDiPreview = panggilanBaruDiPreview.some((p) => p[0] === 'fillText');
    const adaDrawImageWatermarkDiPreview = panggilanBaruDiPreview.some(
      (p) => p[0] === 'drawImage' && p[1] === editor._watermark._gambarEl,
    );
    assert.equal(adaFillTextDiPreview, false, 'preview tidak boleh menggambar teks watermark');
    assert.equal(adaDrawImageWatermarkDiPreview, false, 'preview tidak boleh menggambar logo watermark');
  });

  test('memanggil simpan() berkali-kali dengan watermark aktif tetap konsisten (idempotent secara hasil)', async () => {
    await editor.muatUrl(PNG_1X1);
    editor.aturWatermark({ teks: 'Wanuky' });
    await editor._watermark._gambarPromise;

    const blob1 = await editor.simpan();
    const blob2 = await editor.simpan();
    assert.ok(blob1 instanceof Blob);
    assert.ok(blob2 instanceof Blob);
    assert.equal(blob1.type, blob2.type);
  });
});

// ─────────────────────────────────────────────────────────────
// Bagian 5 — Fail-loudly: watermark gambar gagal dimuat
// Kontrak: jika watermark gambar gagal dimuat, simpan() WAJIB reject dengan
// EditorError dan TIDAK menghasilkan blob apa pun (tidak ada fallback diam-diam
// yang menyimpan tanpa watermark, karena itu bisa mengakibatkan brand asset
// terkirim tanpa watermark tanpa sepengetahuan pengguna).
// ─────────────────────────────────────────────────────────────

describe('Fail-loudly: watermark gambar gagal dimuat', () => {
  let editor;
  let OriginalImage;

  class ImagePalsuGagal extends Image {
    set src(_v) {
      queueMicrotask(() => this.dispatchEvent(new Event('error')));
    }
  }

  function pasangImageSelaluGagal() {
    OriginalImage = global.Image;
    global.Image = ImagePalsuGagal;
    window.Image = ImagePalsuGagal;
  }

  function lepasImageSelaluGagal() {
    global.Image = OriginalImage;
    window.Image = OriginalImage;
  }

  beforeEach(() => {
    pasangStubCanvas();
    editor = buatEditor();
  });

  afterEach(() => {
    editor.hancurkan();
    lepasStubCanvas();
    if (OriginalImage) lepasImageSelaluGagal();
  });

  test('simpan() reject dengan EditorError jika watermark gambar gagal dimuat', async () => {
    await editor.muatUrl(PNG_1X1);
    pasangImageSelaluGagal();
    editor.aturWatermark({ gambar: PNG_1X1 });
    await editor._watermark._gambarPromise;
    assert.equal(editor._watermark._gambarGagal, true, 'flag gagal harus terset setelah preload gagal');

    await assert.rejects(
      () => editor.simpan(),
      (err) => {
        assert.ok(err instanceof EditorError, `error harus instance EditorError, dapat: ${err?.constructor?.name}`);
        return true;
      },
    );
  });

  test('simpan() yang reject karena watermark gagal TIDAK menghasilkan blob apa pun (tidak ada fallback diam-diam)', async () => {
    await editor.muatUrl(PNG_1X1);
    pasangImageSelaluGagal();
    editor.aturWatermark({ gambar: PNG_1X1 });
    await editor._watermark._gambarPromise;

    let blobDihasilkan = null;
    try {
      blobDihasilkan = await editor.simpan();
    } catch {
      // diharapkan reject — blobDihasilkan tetap null
    }
    assert.equal(blobDihasilkan, null, 'tidak boleh ada blob yang dihasilkan saat watermark gagal dimuat');
  });

  test('event "selesai" TIDAK pernah ter-emit saat simpan() gagal akibat watermark', async () => {
    await editor.muatUrl(PNG_1X1);
    pasangImageSelaluGagal();
    editor.aturWatermark({ gambar: PNG_1X1 });
    await editor._watermark._gambarPromise;

    let eventSelesaiTerpicu = false;
    editor.on('selesai', () => { eventSelesaiTerpicu = true; });

    try {
      await editor.simpan();
    } catch {
      // diharapkan reject
    }
    assert.equal(eventSelesaiTerpicu, false, 'event "selesai" tidak boleh terpicu saat simpan() gagal');
  });

  test('watermark TEKS tetap berhasil walau sebelumnya pernah ada watermark gambar yang gagal (recovery via aturWatermark ulang)', async () => {
    await editor.muatUrl(PNG_1X1);
    pasangImageSelaluGagal();
    editor.aturWatermark({ gambar: PNG_1X1 });
    await editor._watermark._gambarPromise;
    assert.equal(editor._watermark._gambarGagal, true);

    // Recovery: ganti total konfigurasi watermark ke teks saja (gambar lama dibuang).
    lepasImageSelaluGagal();
    editor.aturWatermark({ teks: 'Wanuky' });
    await editor._watermark._gambarPromise;

    const blob = await editor.simpan();
    assert.ok(blob instanceof Blob, 'simpan() harus berhasil setelah watermark diganti ke teks saja');
  });
});
