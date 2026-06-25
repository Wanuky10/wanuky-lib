// @vitest-environment happy-dom
//
// @adr Environment override per-file (bukan vitest.config.js global)
// @context sanitasi() butuh DOMParser, yang tidak ada di environment Node
//     default Vitest. Tidak ada vitest.config.* di repo ini — environment
//     default ditentukan oleh Vitest sendiri (Node).
// @decision Pakai pragma komentar `// @vitest-environment happy-dom` di baris
//     pertama file ini, bukan membuat vitest.config.js baru.
// @tradeoff Override ini hanya berlaku untuk file ini — test lain
//     (errors.test.js, exif-reader.test.js) tetap jalan di Node environment
//     default, tidak ada risiko regresi pada mereka. Jika nanti banyak file
//     butuh DOM, evaluasi ulang: pindah ke vitest.config.js environment:
//     'happy-dom' global mungkin lebih murah daripada pragma berulang di
//     setiap file.

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { sanitasi } from '../src/sanitizer.js';

describe('sanitasi', () => {
  describe('whitelist tag default', () => {
    test('mempertahankan tag yang diizinkan (p, strong, a)', () => {
      const hasil = sanitasi('<p>Halo <strong>dunia</strong></p>');
      assert.equal(hasil, '<p>Halo <strong>dunia</strong></p>');
    });

    test('menghapus tag yang tidak diizinkan tapi mempertahankan teks di dalamnya', () => {
      const hasil = sanitasi('<script>alert(1)</script><p>aman</p>');
      assert.equal(hasil.includes('<script>'), false);
      assert.ok(hasil.includes('alert(1)')); // teks dipertahankan, tag dibuang
      assert.ok(hasil.includes('<p>aman</p>'));
    });

    test('menghapus tag iframe/style/object yang tidak ada di default whitelist', () => {
      const hasil = sanitasi('<iframe src="evil.com"></iframe><style>body{}</style><p>ok</p>');
      assert.equal(hasil.includes('<iframe'), false);
      assert.equal(hasil.includes('<style>'), false);
      assert.ok(hasil.includes('<p>ok</p>'));
    });

    test('tag nested yang tidak diizinkan tetap dibersihkan secara rekursif', () => {
      const hasil = sanitasi('<p><script>jahat()</script><strong>aman</strong></p>');
      assert.equal(hasil.includes('<script>'), false);
      assert.ok(hasil.includes('<strong>aman</strong>'));
    });
  });

  describe('pelucutan atribut event handler (on*)', () => {
    test('menghapus onclick dari <a>', () => {
      const hasil = sanitasi('<a href="https://example.com" onclick="alert(1)">klik</a>');
      assert.equal(hasil.includes('onclick'), false);
      assert.ok(hasil.includes('href="https://example.com"'));
    });

    test('menghapus onerror dari <img>', () => {
      const hasil = sanitasi('<img src="https://example.com/a.png" onerror="alert(1)">');
      assert.equal(hasil.includes('onerror'), false);
    });

    test('menghapus berbagai varian on* case-insensitive', () => {
      const hasil = sanitasi('<p OnMouseOver="alert(1)">teks</p>');
      assert.equal(/on\w*=/i.test(hasil), false);
    });
  });

  describe('validasi protokol href/src (paksakanHttps default true)', () => {
    test('mempertahankan href dengan protokol https', () => {
      const hasil = sanitasi('<a href="https://example.com">link</a>');
      assert.ok(hasil.includes('href="https://example.com"'));
    });

    test('mempertahankan href dengan protokol mailto', () => {
      const hasil = sanitasi('<a href="mailto:test@example.com">email</a>');
      assert.ok(hasil.includes('href="mailto:test@example.com"'));
    });

    test('mempertahankan href dengan protokol tel', () => {
      const hasil = sanitasi('<a href="tel:+6281234567890">telepon</a>');
      assert.ok(hasil.includes('href="tel:+6281234567890"'));
    });

    test('menghapus href dengan protokol javascript:', () => {
      const hasil = sanitasi('<a href="javascript:alert(1)">jahat</a>');
      assert.equal(hasil.includes('javascript:'), false);
      assert.equal(hasil.includes('href='), false);
    });

    test('menghapus href dengan protokol data: (tidak ada di whitelist sanitizer.js)', () => {
      const hasil = sanitasi('<a href="data:text/html,<script>alert(1)</script>">data</a>');
      assert.equal(hasil.includes('href='), false);
    });

    test('menghapus src gambar dengan protokol javascript:', () => {
      const hasil = sanitasi('<img src="javascript:alert(1)">');
      assert.equal(hasil.includes('src='), false);
    });

    test('paksakanHttps: false melewati validasi protokol (opsi eksplisit)', () => {
      const hasil = sanitasi('<a href="javascript:alert(1)">jahat</a>', { paksakanHttps: false });
      assert.ok(hasil.includes('href="javascript:alert(1)"'));
    });
  });

  describe('rel="noopener noreferrer" untuk target="_blank"', () => {
    test('menambahkan rel=noopener saat target=_blank ada', () => {
      const hasil = sanitasi('<a href="https://example.com" target="_blank">link</a>');
      assert.ok(hasil.includes('rel="noopener noreferrer"'));
    });

    test('tidak menambahkan rel jika tidak ada target=_blank', () => {
      const hasil = sanitasi('<a href="https://example.com">link</a>');
      assert.equal(hasil.includes('rel='), false);
    });
  });

  describe('atribut di luar whitelist per-tag', () => {
    test('atribut tidak dikenal pada <a> dihapus (selain href/target/rel)', () => {
      const hasil = sanitasi('<a href="https://example.com" data-evil="x">link</a>');
      assert.equal(hasil.includes('data-evil'), false);
    });

    test('atribut style dihapus dari <p> (tidak didukung sanitizer.js, beda dari richTextEditor)', () => {
      const hasil = sanitasi('<p style="color:red">teks</p>');
      assert.equal(hasil.includes('style='), false);
      assert.ok(hasil.includes('teks'));
    });

    test('atribut width/height dipertahankan pada <img>', () => {
      const hasil = sanitasi('<img src="https://example.com/a.png" width="100" height="50">');
      assert.ok(hasil.includes('width="100"'));
      assert.ok(hasil.includes('height="50"'));
    });
  });

  describe('opsi tagDiizinkan (override)', () => {
    test('mempersempit whitelist — tag default yang tidak di-override jadi dihapus', () => {
      const hasil = sanitasi('<p>teks</p><a href="https://example.com">link</a>', {
        tagDiizinkan: ['p'],
      });
      assert.ok(hasil.includes('<p>teks</p>'));
      assert.equal(hasil.includes('<a'), false);
      assert.ok(hasil.includes('link')); // teks anak tag yang dibuang tetap ada
    });

    test('tagDiizinkan case-insensitive', () => {
      const hasil = sanitasi('<p>teks</p>', { tagDiizinkan: ['P'] });
      assert.ok(hasil.includes('<p>teks</p>'));
    });

    test('tagDiizinkan kosong menghapus semua tag, menyisakan teks polos', () => {
      const hasil = sanitasi('<p>teks</p>', { tagDiizinkan: [] });
      assert.equal(hasil.includes('<p>'), false);
      assert.ok(hasil.includes('teks'));
    });
  });

  describe('opsi aktif: false (passthrough)', () => {
    test('mengembalikan HTML asli tanpa modifikasi apa pun, termasuk yang berbahaya', () => {
      const html = '<script>alert(1)</script><a href="javascript:x" onclick="y()">z</a>';
      const hasil = sanitasi(html, { aktif: false });
      assert.equal(hasil, html);
    });
  });

  describe('edge case', () => {
    test('string kosong menghasilkan string kosong', () => {
      assert.equal(sanitasi(''), '');
    });

    test('teks polos tanpa tag HTML dipertahankan utuh', () => {
      assert.equal(sanitasi('halo dunia'), 'halo dunia');
    });

    test('comment HTML dihapus', () => {
      const hasil = sanitasi('<p>a</p><!-- komentar jahat --><p>b</p>');
      assert.equal(hasil.includes('<!--'), false);
      assert.ok(hasil.includes('<p>a</p>'));
      assert.ok(hasil.includes('<p>b</p>'));
    });

    test('tag bersarang banyak level tetap dibersihkan rekursif', () => {
      const hasil = sanitasi('<ul><li><a href="javascript:x">x</a></li></ul>');
      assert.equal(hasil.includes('href='), false);
      assert.ok(hasil.includes('<ul>'));
      assert.ok(hasil.includes('<li>'));
    });
  });
});
