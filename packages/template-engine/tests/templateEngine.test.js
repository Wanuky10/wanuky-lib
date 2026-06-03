/**
 * Test suite untuk @wanuky/template-engine v1.1.0
 * Menggunakan Node.js built-in test runner (node:test).
 *
 * Jalankan: node --test tests/templateEngine.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { buatEngine, versi } from '../src/index.js';
import { escapeHtml } from '../src/utils/escaper.js';
import { resolveNilai, evaluasiKondisi } from '../src/utils/resolver.js';
import {
  prosesInterpolasi,
  prosesEach,
  prosesIf,
} from '../src/parser.js';
import { renderTemplate } from '../src/renderer.js';

// ─────────────────────────────────────────────
// Setup direktori temp sekali pakai
// ─────────────────────────────────────────────

function buatDirTemp(suffix = '') {
  const uid = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const dir = join(tmpdir(), `wanuky-te-${suffix}-${uid}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'layouts'), { recursive: true });
  mkdirSync(join(dir, 'partials'), { recursive: true });
  return dir;
}

// ─────────────────────────────────────────────
// Versi
// ─────────────────────────────────────────────

describe('versi', () => {
  test('harus bernilai 1.1.0', () => {
    assert.equal(versi, '1.1.0');
  });
});

// ─────────────────────────────────────────────
// escapeHtml
// ─────────────────────────────────────────────

describe('escapeHtml', () => {
  test('escape semua karakter HTML berbahaya', () => {
    assert.equal(
      escapeHtml('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });
  test('string biasa tidak berubah', () => assert.equal(escapeHtml('Halo dunia'), 'Halo dunia'));
  test('null → string kosong', () => assert.equal(escapeHtml(null), ''));
  test('undefined → string kosong', () => assert.equal(escapeHtml(undefined), ''));
  test('angka → string', () => assert.equal(escapeHtml(42), '42'));
  test('backtick di-escape', () => assert.equal(escapeHtml('`test`'), '&#x60;test&#x60;'));
  test('ampersand di-escape', () => assert.equal(escapeHtml('a & b'), 'a &amp; b'));
  test('single quote di-escape', () => assert.ok(escapeHtml("a'b").includes('&#x27;')));
});

// ─────────────────────────────────────────────
// resolveNilai
// ─────────────────────────────────────────────

describe('resolveNilai', () => {
  const data = { nama: 'Wahid', pengguna: { profil: { email: 'wahid@test.com' } } };

  test('resolve key sederhana', () => assert.equal(resolveNilai(data, 'nama'), 'Wahid'));
  test('resolve bersarang 3 level', () => assert.equal(resolveNilai(data, 'pengguna.profil.email'), 'wahid@test.com'));
  test('key tidak ada → undefined', () => assert.equal(resolveNilai(data, 'tidakAda'), undefined));
  test('nested tidak ada → undefined (tidak throw)', () => assert.equal(resolveNilai(data, 'pengguna.x.y'), undefined));
  test('path kosong → undefined', () => assert.equal(resolveNilai(data, ''), undefined));
  test('path null → undefined', () => assert.equal(resolveNilai(data, null), undefined));
});

// ─────────────────────────────────────────────
// evaluasiKondisi
// ─────────────────────────────────────────────

describe('evaluasiKondisi', () => {
  const data = { aktif: true, nonaktif: false, jumlah: 5, nama: 'admin', kosong: '' };

  test('truthy check — true', ()  => assert.equal(evaluasiKondisi('aktif', data), true));
  test('truthy check — false', () => assert.equal(evaluasiKondisi('nonaktif', data), false));
  test('negasi !', ()           => assert.equal(evaluasiKondisi('!nonaktif', data), true));
  test('perbandingan ==', ()    => assert.equal(evaluasiKondisi('nama == admin', data), true));
  test('perbandingan !=', ()    => assert.equal(evaluasiKondisi('nama != pengguna', data), true));
  test('perbandingan > angka',  () => assert.equal(evaluasiKondisi('jumlah > 3', data), true));
  test('perbandingan < angka',  () => assert.equal(evaluasiKondisi('jumlah < 3', data), false));
  test('perbandingan >= sama',  () => assert.equal(evaluasiKondisi('jumlah >= 5', data), true));
  test('perbandingan <= lebih', () => assert.equal(evaluasiKondisi('jumlah <= 4', data), false));
  test('string kosong = falsy', () => assert.equal(evaluasiKondisi('kosong', data), false));
  test('key tidak ada = falsy', () => assert.equal(evaluasiKondisi('tidakAda', data), false));
});

// ─────────────────────────────────────────────
// prosesInterpolasi
// ─────────────────────────────────────────────

describe('prosesInterpolasi', () => {
  test('interpolasi sederhana', () =>
    assert.equal(prosesInterpolasi('<h1><{ judul }></h1>', { judul: 'Beranda' }), '<h1>Beranda</h1>'));

  test('interpolasi bersarang', () =>
    assert.equal(prosesInterpolasi('<{ a.b }>', { a: { b: 'oke' } }), 'oke'));

  test('XSS di-escape otomatis', () => {
    const hasil = prosesInterpolasi('<{ input }>', { input: '<script>xss()</script>' });
    assert.ok(!hasil.includes('<script>'));
    assert.ok(hasil.includes('&lt;script&gt;'));
  });

  test('variabel tidak ada → string kosong', () =>
    assert.equal(prosesInterpolasi('<{ tidakAda }>', {}), ''));

  test('berganda dalam satu template', () =>
    assert.equal(prosesInterpolasi('<{ a }> dan <{ b }>', { a: 'X', b: 'Y' }), 'X dan Y'));

  test('raw mode: prefix ! tidak meng-escape HTML', () =>
    assert.equal(prosesInterpolasi('<{ !html }>', { html: '<b>tebal</b>' }), '<b>tebal</b>'));

  // Regression: karakter $ dalam nilai tidak boleh memecah output
  test('regression: karakter $ dalam nilai', () =>
    assert.equal(prosesInterpolasi('<{ harga }>', { harga: '$100' }), '$100'));
});

// ─────────────────────────────────────────────
// prosesEach
// ─────────────────────────────────────────────

describe('prosesEach', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('iterasi array sederhana', () => {
    const hasil = render('<each item in daftar><li><{ item }></li></each>', { daftar: ['a', 'b', 'c'] });
    assert.equal(hasil, '<li>a</li><li>b</li><li>c</li>');
  });

  test('alias indeks eksplisit (i, item)', () => {
    const hasil = render('<each i, item in daftar><{ i }>:<{ item }> </each>', { daftar: ['x', 'y'] });
    assert.equal(hasil.trim(), '0:x 1:y');
  });

  test('metadata loop.indeks', () => {
    const hasil = render('<each item in daftar><{ loop.indeks }></each>', { daftar: ['a', 'b'] });
    assert.equal(hasil, '01');
  });

  test('metadata loop.pertama & loop.terakhir', () => {
    const hasil = render(
      '<each item in daftar><if loop.pertama>P</if><if loop.terakhir>T</if></each>',
      { daftar: ['a', 'b', 'c'] },
    );
    assert.equal(hasil, 'PT');
  });

  test('koleksi kosong → string kosong', () => {
    assert.equal(render('<each item in daftar><{ item }></each>', { daftar: [] }), '');
  });

  test('koleksi bukan array → string kosong', () => {
    assert.equal(render('<each item in x><{ item }></each>', { x: 'bukan-array' }), '');
  });

  test('nested <each>', () => {
    const hasil = render(
      '<each baris in tabel><each sel in baris><td><{ sel }></td></each></each>',
      { tabel: [['a', 'b'], ['c', 'd']] },
    );
    assert.equal(hasil, '<td>a</td><td>b</td><td>c</td><td>d</td>');
  });

  // Regression: tag <eachother> tidak boleh memicu parser loop
  test('regression: <eachother> tidak diproses sebagai <each>', () => {
    const hasil = render('<eachother>teks</eachother>', {});
    assert.equal(hasil, '<eachother>teks</eachother>');
  });
});

// ─────────────────────────────────────────────
// prosesIf — termasuk elseif baru
// ─────────────────────────────────────────────

describe('prosesIf', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('kondisi true menampilkan konten', () =>
    assert.equal(render('<if tampil>OK</if>', { tampil: true }), 'OK'));

  test('kondisi false menyembunyikan konten', () =>
    assert.equal(render('<if tampil>OK</if>', { tampil: false }), ''));

  test('if-else — cabang true', () =>
    assert.equal(render('<if ok>YA<else>TIDAK</if>', { ok: true }), 'YA'));

  test('if-else — cabang false', () =>
    assert.equal(render('<if ok>YA<else>TIDAK</if>', { ok: false }), 'TIDAK'));

  test('perbandingan kondisi', () =>
    assert.equal(render('<if peran == admin>ADMIN</if>', { peran: 'admin' }), 'ADMIN'));

  // ── Fitur baru v1.1.0: elseif ──
  test('if-elseif: klausa if dipilih', () => {
    const hasil = render(
      '<if nilai >= 90>A<elseif nilai >= 80>B<elseif nilai >= 70>C<else>D</if>',
      { nilai: 95 },
    );
    assert.equal(hasil, 'A');
  });

  test('if-elseif: klausa elseif pertama dipilih', () => {
    const hasil = render(
      '<if nilai >= 90>A<elseif nilai >= 80>B<elseif nilai >= 70>C<else>D</if>',
      { nilai: 85 },
    );
    assert.equal(hasil, 'B');
  });

  test('if-elseif: klausa elseif kedua dipilih', () => {
    const hasil = render(
      '<if nilai >= 90>A<elseif nilai >= 80>B<elseif nilai >= 70>C<else>D</if>',
      { nilai: 75 },
    );
    assert.equal(hasil, 'C');
  });

  test('if-elseif: klausa else dipilih', () => {
    const hasil = render(
      '<if nilai >= 90>A<elseif nilai >= 80>B<elseif nilai >= 70>C<else>D</if>',
      { nilai: 50 },
    );
    assert.equal(hasil, 'D');
  });

  test('nested <if> — kedalaman 2', () => {
    assert.equal(render('<if a>LUAR<if b>DALAM</if></if>', { a: true, b: true }), 'LUARDALAM');
  });

  test('<else> di nested <if> tidak salah ditangkap oleh <if> luar', () => {
    const hasil = render('<if luar>LUAR<if dalam>YA<else>TIDAK</if></if>', { luar: true, dalam: false });
    assert.equal(hasil, 'LUARTIDAK');
  });

  // Regression: tag <ifstuff> tidak boleh memicu parser kondisional
  test('regression: <ifstuff> bukan <if>', () => {
    const hasil = render('<ifstuff>teks</ifstuff>', {});
    assert.equal(hasil, '<ifstuff>teks</ifstuff>');
  });
});

// ─────────────────────────────────────────────
// Circular include protection
// ─────────────────────────────────────────────

describe('proteksi circular include', () => {
  test('melempar error saat kedalaman include melampaui batas', () => {
    const dirTemp = buatDirTemp('circular');
    // self.html meng-include dirinya sendiri — circular
    writeFileSync(join(dirTemp, 'self.html'), '<include="self.html">');

    const engine = buatEngine({
      dirViews:   dirTemp,
      dirLayouts: join(dirTemp, 'layouts'),
    });

    assert.throws(
      () => engine.render('self.html', {}),
      /Batas kedalaman include terlampaui/,
    );
  });
});

// ─────────────────────────────────────────────
// File cache
// ─────────────────────────────────────────────

describe('file cache', () => {
  test('ukuranCache bertambah setelah render', () => {
    const dirTemp = buatDirTemp('cache');
    writeFileSync(join(dirTemp, 'layouts', 'utama.html'), '<body><contents></contents></body>');
    writeFileSync(join(dirTemp, 'halaman.html'), '<p>Konten</p>');

    const engine = buatEngine({ dirViews: dirTemp, dirLayouts: join(dirTemp, 'layouts') });
    engine.render('halaman.html', {}, 'utama');

    assert.ok(engine.ukuranCache >= 2); // minimal view + layout
  });

  test('kosongkanCache mengosongkan cache', () => {
    const dirTemp = buatDirTemp('kosong');
    // Render tanpa layout agar tidak butuh file layouts/ — lebih isolated
    writeFileSync(join(dirTemp, 'snippet.html'), '<p><{ teks }></p>');

    const engine = buatEngine({ dirViews: dirTemp, dirLayouts: join(dirTemp, 'layouts') });
    engine.render('snippet.html', { teks: 'tes' }); // tanpa layout: hanya 1 file di-cache
    assert.ok(engine.ukuranCache >= 1, 'Cache harus terisi setelah render');

    engine.kosongkanCache();
    assert.equal(engine.ukuranCache, 0);
  });
});

// ─────────────────────────────────────────────
// Integrasi: buatEngine dengan file nyata
// ─────────────────────────────────────────────

describe('buatEngine — integrasi', () => {
  const dirTemp = buatDirTemp('integrasi');

  writeFileSync(
    join(dirTemp, 'layouts', 'utama.html'),
    '<!DOCTYPE html><html><body><main><contents></contents></main></body></html>',
  );
  writeFileSync(join(dirTemp, 'partials', 'header.html'), '<header><h1><{ judul }></h1></header>');
  writeFileSync(
    join(dirTemp, 'beranda.html'),
    '<include="partials/header.html"><p>Halo, <{ pengguna.nama }>!</p>',
  );

  const engine = buatEngine({ dirViews: dirTemp, dirLayouts: join(dirTemp, 'layouts') });

  test('render dengan layout menyisipkan konten ke slot', () => {
    const html = engine.render('beranda.html', { judul: 'Beranda', pengguna: { nama: 'Wahid' } }, 'utama');
    assert.ok(html.includes('<main>'));
    assert.ok(html.includes('<h1>Beranda</h1>'));
    assert.ok(html.includes('Halo, Wahid!'));
  });

  test('render tanpa layout mengembalikan view saja', () => {
    const html = engine.render('beranda.html', { judul: 'T', pengguna: { nama: 'T' } });
    assert.ok(!html.includes('<main>'));
    assert.ok(html.includes('Halo, T!'));
  });

  test('renderString merender template langsung', () =>
    assert.equal(engine.renderString('<p><{ pesan }></p>', { pesan: 'Halo' }), '<p>Halo</p>'));

  test('regression: karakter $ di konten view tidak merusak layout', () => {
    writeFileSync(join(dirTemp, 'harga.html'), '<p>Harga: $100 dan $$200</p>');
    const html = engine.render('harga.html', {}, 'utama');
    assert.ok(html.includes('$100'));
    assert.ok(html.includes('$$200'));
    assert.ok(html.includes('<main>'));
  });

  test('XSS di-escape', () => {
    const html = engine.renderString('<div><{ input }></div>', { input: '<script>alert(1)</script>' });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  test('failure: view tidak ditemukan melempar error', () =>
    assert.throws(() => engine.render('tidak-ada.html', {}), /Gagal membaca view/));

  test('failure: layout tidak ditemukan melempar error', () =>
    assert.throws(() => engine.render('beranda.html', {}, 'tidak-ada'), /Gagal membaca layout/));

  test('failure: slot tidak ada di layout melempar error', () => {
    writeFileSync(join(dirTemp, 'layouts', 'tanpa-slot.html'), '<html>Tanpa slot</html>');
    assert.throws(
      () => engine.render('beranda.html', {}, 'tanpa-slot'),
      /tidak mengandung slot/,
    );
  });

  test('failure: buatEngine tanpa konfigurasi melempar error', () =>
    assert.throws(() => buatEngine({}), /Konfigurasi tidak lengkap/));
});
