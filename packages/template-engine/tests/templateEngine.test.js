/**
 * Test suite untuk @wanuky/template-engine v2.0.0
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
import { resolveNilai } from '../src/utils/resolver.js';
import { evaluasiEkspresi, evaluasiKondisi } from '../src/utils/expression.js';
import { applyFilters, parseFilterExpression, FILTER_LIBRARY } from '../src/utils/filter.js';
import {
  prosesInterpolasi,
  prosesEach,
  prosesIf,
  prosesUnless,
  prosesSwitch,
  prosesWith,
} from '../src/parser.js';
import { renderTemplate } from '../src/renderer.js';

// ─────────────────────────────────────────────
// Helper: buat direktori temp
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
  test('harus bernilai 2.0.0', () => {
    assert.equal(versi, '2.0.0');
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
  test('string biasa tidak berubah',  () => assert.equal(escapeHtml('Halo dunia'), 'Halo dunia'));
  test('null → string kosong',         () => assert.equal(escapeHtml(null), ''));
  test('undefined → string kosong',    () => assert.equal(escapeHtml(undefined), ''));
  test('angka → string',               () => assert.equal(escapeHtml(42), '42'));
  test('backtick di-escape',           () => assert.equal(escapeHtml('`test`'), '&#x60;test&#x60;'));
  test('ampersand di-escape',          () => assert.equal(escapeHtml('a & b'), 'a &amp; b'));
  test('single quote di-escape',       () => assert.ok(escapeHtml("a'b").includes('&#x27;')));
});

// ─────────────────────────────────────────────
// resolveNilai — termasuk bracket notation baru
// ─────────────────────────────────────────────

describe('resolveNilai', () => {
  const data = {
    nama: 'Wahid',
    pengguna: { profil: { email: 'wahid@test.com' } },
    daftar: ['satu', 'dua', 'tiga'],
    matriks: [['a', 'b'], ['c', 'd']],
  };

  test('resolve key sederhana', () =>
    assert.equal(resolveNilai(data, 'nama'), 'Wahid'));

  test('resolve bersarang 3 level', () =>
    assert.equal(resolveNilai(data, 'pengguna.profil.email'), 'wahid@test.com'));

  test('key tidak ada → undefined', () =>
    assert.equal(resolveNilai(data, 'tidakAda'), undefined));

  test('nested tidak ada → undefined (tidak throw)', () =>
    assert.equal(resolveNilai(data, 'pengguna.x.y'), undefined));

  test('path kosong → undefined', () =>
    assert.equal(resolveNilai(data, ''), undefined));

  test('path null → undefined', () =>
    assert.equal(resolveNilai(data, null), undefined));

  // Bracket notation — fitur baru v2.0.0
  test('bracket notation [0]', () =>
    assert.equal(resolveNilai(data, 'daftar[0]'), 'satu'));

  test('bracket notation [2]', () =>
    assert.equal(resolveNilai(data, 'daftar[2]'), 'tiga'));

  test('bracket notation chained: matriks[1][0]', () =>
    assert.equal(resolveNilai(data, 'matriks[1][0]'), 'c'));

  test('literal number → Number', () =>
    assert.strictEqual(resolveNilai(data, '42'), 42));

  test('literal true → boolean true', () =>
    assert.strictEqual(resolveNilai(data, 'true'), true));

  test('literal false → boolean false', () =>
    assert.strictEqual(resolveNilai(data, 'false'), false));

  test('literal null → null', () =>
    assert.strictEqual(resolveNilai(data, 'null'), null));
});

// ─────────────────────────────────────────────
// evaluasiEkspresi — ekspresi boolean penuh
// ─────────────────────────────────────────────

describe('evaluasiEkspresi', () => {
  const data = {
    aktif: true,
    nonaktif: false,
    jumlah: 5,
    nama: 'admin',
    kosong: '',
    pengguna: { peran: 'admin', level: 3 },
  };

  // Dasar
  test('truthy check — true',  () => assert.equal(evaluasiEkspresi('aktif', data), true));
  test('truthy check — false', () => assert.equal(evaluasiEkspresi('nonaktif', data), false));

  // Negasi
  test('negasi !true',  () => assert.equal(evaluasiEkspresi('!aktif', data), false));
  test('negasi !false', () => assert.equal(evaluasiEkspresi('!nonaktif', data), true));

  // Perbandingan — string literal wajib dikutip
  test('==',  () => assert.equal(evaluasiEkspresi('nama == "admin"', data), true));
  test('!=',  () => assert.equal(evaluasiEkspresi('nama != "pengguna"', data), true));
  test('>',   () => assert.equal(evaluasiEkspresi('jumlah > 3', data), true));
  test('<',   () => assert.equal(evaluasiEkspresi('jumlah < 3', data), false));
  test('>=',  () => assert.equal(evaluasiEkspresi('jumlah >= 5', data), true));
  test('<=',  () => assert.equal(evaluasiEkspresi('jumlah <= 4', data), false));

  // AND / OR — fitur baru v2.0.0
  test('&& keduanya true',   () => assert.equal(evaluasiEkspresi('aktif && jumlah > 3', data), true));
  test('&& salah satu false', () => assert.equal(evaluasiEkspresi('aktif && nonaktif', data), false));
  test('|| salah satu true',  () => assert.equal(evaluasiEkspresi('aktif || nonaktif', data), true));
  test('|| keduanya false',   () => assert.equal(evaluasiEkspresi('nonaktif || kosong', data), false));

  // Grouping dengan tanda kurung
  test('group: !(a || b)', () =>
    assert.equal(evaluasiEkspresi('!(aktif || nonaktif)', data), false));

  test('group: (a && b) || c', () =>
    assert.equal(evaluasiEkspresi('(nonaktif && aktif) || jumlah > 4', data), true));

  // Ekspresi bersarang dengan dot notation
  test('dot notation dalam ekspresi', () =>
    assert.equal(evaluasiEkspresi('pengguna.peran == "admin"', data), true));

  test('dot notation && perbandingan angka', () =>
    assert.equal(evaluasiEkspresi('pengguna.level >= 3 && aktif', data), true));

  // String literal dalam ekspresi — wajib dikutip
  test('perbandingan string literal dengan kutip ganda', () =>
    assert.equal(evaluasiEkspresi('nama == "admin"', data), true));

  // Edge case
  test('string kosong = falsy',   () => assert.equal(evaluasiEkspresi('kosong', data), false));
  test('key tidak ada = false',   () => assert.equal(evaluasiEkspresi('tidakAda', data), false));
  test('ekspresi kosong = false', () => assert.equal(evaluasiEkspresi('', data), false));
  test('ekspresi null = false',   () => assert.equal(evaluasiEkspresi(null, data), false));
});

// backward-compat alias
describe('evaluasiKondisi (alias backward-compat)', () => {
  test('adalah referensi ke evaluasiEkspresi (nilai ada)', () =>
    assert.equal(evaluasiKondisi('aktif', { aktif: true }), true));
  test('adalah referensi ke evaluasiEkspresi (nilai tidak ada)', () =>
    assert.equal(evaluasiKondisi('tidakAda', { aktif: true }), false));
});

// ─────────────────────────────────────────────
// Filter system — fitur baru v2.0.0
// ─────────────────────────────────────────────

describe('parseFilterExpression', () => {
  test('tanpa filter: hanya path', () => {
    const r = parseFilterExpression('nama');
    assert.equal(r.path, 'nama');
    assert.equal(r.isRaw, false);
    assert.deepEqual(r.filters, []);
  });

  test('satu filter tanpa argumen', () => {
    const r = parseFilterExpression('nama | uppercase');
    assert.equal(r.path, 'nama');
    assert.equal(r.filters[0].name, 'uppercase');
    assert.deepEqual(r.filters[0].args, []);
  });

  test('filter dengan argumen', () => {
    const r = parseFilterExpression('nama | truncate: 10, ...');
    assert.equal(r.filters[0].name, 'truncate');
    assert.equal(r.filters[0].args[0], '10');
    assert.equal(r.filters[0].args[1], '...');
  });

  test('filter berantai', () => {
    const r = parseFilterExpression('teks | trim | uppercase');
    assert.equal(r.filters.length, 2);
    assert.equal(r.filters[0].name, 'trim');
    assert.equal(r.filters[1].name, 'uppercase');
  });

  test('prefix ! → isRaw = true', () => {
    const r = parseFilterExpression('!html | uppercase');
    assert.equal(r.isRaw, true);
    assert.equal(r.path, 'html');
  });
});

describe('FILTER_LIBRARY — string', () => {
  test('uppercase', () => assert.equal(FILTER_LIBRARY.uppercase('halo'), 'HALO'));
  test('lowercase', () => assert.equal(FILTER_LIBRARY.lowercase('HALO'), 'halo'));
  test('capitalize', () => assert.equal(FILTER_LIBRARY.capitalize('hALO dUNIA'), 'Halo dunia'));
  test('titlecase', () => assert.equal(FILTER_LIBRARY.titlecase('halo dunia'), 'Halo Dunia'));
  test('trim', () => assert.equal(FILTER_LIBRARY.trim('  halo  '), 'halo'));
  test('replace', () => assert.equal(FILTER_LIBRARY.replace('halo dunia', 'dunia', 'world'), 'halo world'));
  test('truncate lebih panjang', () => assert.equal(FILTER_LIBRARY.truncate('halo dunia', '5', '…'), 'halo…'));
  test('truncate tidak dipotong jika pendek', () => assert.equal(FILTER_LIBRARY.truncate('hai', '10'), 'hai'));
  test('padStart', () => assert.equal(FILTER_LIBRARY.padStart('5', '3', '0'), '005'));
  test('slug', () => assert.equal(FILTER_LIBRARY.slug('Halo Dunia!'), 'halo-dunia'));
});

describe('FILTER_LIBRARY — number', () => {
  test('round 2 desimal', () => assert.equal(FILTER_LIBRARY.round(3.14159, '2'), 3.14));
  test('floor', () => assert.equal(FILTER_LIBRARY.floor(3.9), 3));
  test('ceil',  () => assert.equal(FILTER_LIBRARY.ceil(3.1), 4));
  test('abs',   () => assert.equal(FILTER_LIBRARY.abs(-5), 5));
  test('percent', () => assert.equal(FILTER_LIBRARY.percent(0.75, '0'), '75%'));
  test('default — nilai ada',  () => assert.equal(FILTER_LIBRARY.default('ok', 'fallback'), 'ok'));
  test('default — nilai null', () => assert.equal(FILTER_LIBRARY.default(null, 'fallback'), 'fallback'));
  test('default — nilai ""',   () => assert.equal(FILTER_LIBRARY.default('', 'fallback'), 'fallback'));
  test('bool truthy', () => assert.equal(FILTER_LIBRARY.bool(1), true));
  test('bool falsy',  () => assert.equal(FILTER_LIBRARY.bool(0), false));
});

describe('FILTER_LIBRARY — date', () => {
  test('dateFormat default dd/MM/yyyy', () => {
    const hasil = FILTER_LIBRARY.dateFormat(new Date(2024, 0, 15));
    assert.equal(hasil, '15/01/2024');
  });
  test('dateFormat pola custom', () => {
    const hasil = FILTER_LIBRARY.dateFormat(new Date(2024, 5, 3), 'yyyy-MM-dd');
    assert.equal(hasil, '2024-06-03');
  });
  test('dateFormat nilai invalid → string asli', () =>
    assert.equal(FILTER_LIBRARY.dateFormat('bukan-tanggal'), 'bukan-tanggal'));
  test('timeAgo tidak throw untuk timestamp valid', () => {
    const hasil = FILTER_LIBRARY.timeAgo(Date.now() - 70_000);
    assert.ok(typeof hasil === 'string' && hasil.length > 0);
  });
});

describe('FILTER_LIBRARY — array', () => {
  test('length array',  () => assert.equal(FILTER_LIBRARY.length([1, 2, 3]), 3));
  test('length string', () => assert.equal(FILTER_LIBRARY.length('halo'), 4));
  test('join default',  () => assert.equal(FILTER_LIBRARY.join(['a', 'b', 'c']), 'a, b, c'));
  test('join custom sep', () => assert.equal(FILTER_LIBRARY.join(['a', 'b'], ' - '), 'a - b'));
  test('first',  () => assert.equal(FILTER_LIBRARY.first([10, 20, 30]), 10));
  test('last',   () => assert.equal(FILTER_LIBRARY.last([10, 20, 30]), 30));
  test('reverse array',  () => assert.deepEqual(FILTER_LIBRARY.reverse([1, 2, 3]), [3, 2, 1]));
  test('unique',  () => assert.deepEqual(FILTER_LIBRARY.unique([1, 2, 2, 3]), [1, 2, 3]));
  test('sort asc', () => assert.deepEqual(FILTER_LIBRARY.sort([3, 1, 2]), [1, 2, 3]));
  test('slice array', () => assert.deepEqual(FILTER_LIBRARY.slice([1, 2, 3, 4], '1', '3'), [2, 3]));
});

describe('FILTER_LIBRARY — serialisasi', () => {
  test('json compact', () =>
    assert.equal(FILTER_LIBRARY.json({ a: 1 }, '0'), '{"a":1}'));
  test('keys', () =>
    assert.deepEqual(FILTER_LIBRARY.keys({ a: 1, b: 2 }), ['a', 'b']));
  test('values', () =>
    assert.deepEqual(FILTER_LIBRARY.values({ a: 1, b: 2 }), [1, 2]));
  test('entries', () =>
    assert.deepEqual(FILTER_LIBRARY.entries({ x: 10 }), [{ key: 'x', value: 10 }]));
});

describe('applyFilters — rantai filter', () => {
  test('satu filter', () =>
    assert.equal(applyFilters('halo', [{ name: 'uppercase', args: [] }]), 'HALO'));

  test('dua filter berantai', () =>
    assert.equal(applyFilters('  halo  ', [
      { name: 'trim', args: [] },
      { name: 'uppercase', args: [] },
    ]), 'HALO'));

  test('filter tidak dikenal melempar error', () =>
    assert.throws(
      () => applyFilters('x', [{ name: 'tidakAda', args: [] }]),
      /Filter tidak dikenal/,
    ));
});

// ─────────────────────────────────────────────
// Filter di template (integrasi)
// ─────────────────────────────────────────────

describe('filter dalam template (integrasi renderTemplate)', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('uppercase', () =>
    assert.equal(render('<{ nama | uppercase }>', { nama: 'wahid' }), 'WAHID'));

  test('truncate dengan argumen', () =>
    assert.equal(render('<{ deskripsi | truncate: 5, ... }>', { deskripsi: 'Halo dunia baru' }), 'Halo...'));

  test('default — nilai ada',  () =>
    assert.equal(render('<{ nama | default: Tamu }>', { nama: 'Wahid' }), 'Wahid'));

  test('default — nilai kosong', () =>
    assert.equal(render('<{ nama | default: Tamu }>', { nama: '' }), 'Tamu'));

  test('filter berantai dalam template', () =>
    assert.equal(render('<{ teks | trim | capitalize }>', { teks: '  halo ' }), 'Halo'));

  test('filter pada nilai angka', () =>
    assert.equal(render('<{ n | abs }>', { n: -42 }), '42'));

  test('join array', () =>
    assert.equal(render('<{ list | join: " - " }>', { list: ['a', 'b', 'c'] }), 'a - b - c'));
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

  test('koleksi kosong → string kosong', () =>
    assert.equal(render('<each item in daftar><{ item }></each>', { daftar: [] }), ''));

  test('koleksi bukan array → string kosong', () =>
    assert.equal(render('<each item in x><{ item }></each>', { x: 'bukan-array' }), ''));

  test('nested <each>', () => {
    const hasil = render(
      '<each baris in tabel><each sel in baris><td><{ sel }></td></each></each>',
      { tabel: [['a', 'b'], ['c', 'd']] },
    );
    assert.equal(hasil, '<td>a</td><td>b</td><td>c</td><td>d</td>');
  });

  test('regression: <eachother> tidak diproses sebagai <each>', () => {
    const hasil = render('<eachother>teks</eachother>', {});
    assert.equal(hasil, '<eachother>teks</eachother>');
  });
});

// ─────────────────────────────────────────────
// prosesIf (termasuk elseif dan && || baru)
// ─────────────────────────────────────────────

describe('prosesIf', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('kondisi true',  () => assert.equal(render('<if tampil>OK</if>', { tampil: true }), 'OK'));
  test('kondisi false', () => assert.equal(render('<if tampil>OK</if>', { tampil: false }), ''));
  test('if-else — true',  () => assert.equal(render('<if ok>YA<else>TIDAK</if>', { ok: true }), 'YA'));
  test('if-else — false', () => assert.equal(render('<if ok>YA<else>TIDAK</if>', { ok: false }), 'TIDAK'));
  test('perbandingan == (string dikutip)', () => assert.equal(render('<if peran == "admin">ADMIN</if>', { peran: 'admin' }), 'ADMIN'));

  // Operator logika baru v2.0.0
  test('kondisi &&', () =>
    assert.equal(render('<if a && b>OK</if>', { a: true, b: true }), 'OK'));

  test('kondisi && false', () =>
    assert.equal(render('<if a && b>OK</if>', { a: true, b: false }), ''));

  test('kondisi ||', () =>
    assert.equal(render('<if a || b>OK</if>', { a: false, b: true }), 'OK'));

  test('kondisi dengan grouping', () =>
    assert.equal(render('<if (a || b) && c>OK</if>', { a: false, b: true, c: true }), 'OK'));

  // elseif
  test('if-elseif: klausa if',          () => assert.equal(render('<if n >= 90>A<elseif n >= 80>B<else>C</if>', { n: 95 }), 'A'));
  test('if-elseif: klausa elseif',      () => assert.equal(render('<if n >= 90>A<elseif n >= 80>B<else>C</if>', { n: 85 }), 'B'));
  test('if-elseif: klausa else',        () => assert.equal(render('<if n >= 90>A<elseif n >= 80>B<else>C</if>', { n: 50 }), 'C'));

  // Nested
  test('nested <if>', () =>
    assert.equal(render('<if a>LUAR<if b>DALAM</if></if>', { a: true, b: true }), 'LUARDALAM'));

  test('<else> nested tidak ditangkap <if> luar', () => {
    const hasil = render('<if luar>LUAR<if dalam>YA<else>TIDAK</if></if>', { luar: true, dalam: false });
    assert.equal(hasil, 'LUARTIDAK');
  });

  test('regression: <ifstuff> bukan <if>', () =>
    assert.equal(render('<ifstuff>teks</ifstuff>', {}), '<ifstuff>teks</ifstuff>'));
});

// ─────────────────────────────────────────────
// prosesUnless — fitur baru v2.0.0
// ─────────────────────────────────────────────

describe('prosesUnless', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('unless true → konten tidak tampil', () =>
    assert.equal(render('<unless tampil>TERSEMBUNYI</unless>', { tampil: true }), ''));

  test('unless false → konten tampil', () =>
    assert.equal(render('<unless tampil>TAMPIL</unless>', { tampil: false }), 'TAMPIL'));

  test('unless dengan ekspresi perbandingan (n != 10)', () =>
    assert.equal(render('<unless n == 10>RENDAH</unless>', { n: 5 }), 'RENDAH'));

  test('unless dengan && — semua true → tidak tampil', () =>
    assert.equal(render('<unless a && b>TIDAK</unless>', { a: true, b: true }), ''));

  test('unless dengan || — salah satu true → tidak tampil', () =>
    assert.equal(render('<unless a || b>TIDAK</unless>', { a: false, b: true }), ''));

  test('nested unless', () => {
    const hasil = render(
      '<unless err><unless juga>OK</unless></unless>',
      { err: false, juga: false },
    );
    assert.equal(hasil, 'OK');
  });
});

// ─────────────────────────────────────────────
// prosesSwitch — fitur baru v2.0.0
// ─────────────────────────────────────────────

describe('prosesSwitch', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  const tplStatus = `
<switch status>
  <when aktif>AKTIF</when>
  <when nonaktif>NONAKTIF</when>
  <default>TIDAK DIKENAL</default>
</switch>`.trim();

  test('when cocok pertama', () =>
    assert.equal(render(tplStatus, { status: 'aktif' }).trim(), 'AKTIF'));

  test('when cocok kedua', () =>
    assert.equal(render(tplStatus, { status: 'nonaktif' }).trim(), 'NONAKTIF'));

  test('default — tidak ada when cocok', () =>
    assert.equal(render(tplStatus, { status: 'x' }).trim(), 'TIDAK DIKENAL'));

  test('switch dengan nilai angka', () => {
    const tpl = '<switch kode><when 1>SATU</when><when 2>DUA</when><default>LAIN</default></switch>';
    assert.equal(render(tpl, { kode: 1 }).trim(), 'SATU');
    assert.equal(render(tpl, { kode: 2 }).trim(), 'DUA');
    assert.equal(render(tpl, { kode: 9 }).trim(), 'LAIN');
  });

  test('tanpa default — tidak ada when cocok → string kosong', () => {
    const tpl = '<switch x><when a>A</when></switch>';
    assert.equal(render(tpl, { x: 'b' }).trim(), '');
  });
});

// ─────────────────────────────────────────────
// prosesWith — fitur baru v2.0.0
// ─────────────────────────────────────────────

describe('prosesWith', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('merge properti objek ke scope', () => {
    const hasil = render(
      '<with pengguna><{ nama }> (<{ email }>)</with>',
      { pengguna: { nama: 'Wahid', email: 'w@test.com' } },
    );
    assert.equal(hasil, 'Wahid (w@test.com)');
  });

  test('scope luar tetap bisa diakses', () => {
    const hasil = render(
      '<with obj><{ nilai }> dari <{ sumber }></with>',
      { obj: { nilai: 42 }, sumber: 'luar' },
    );
    assert.equal(hasil, '42 dari luar');
  });

  test('nested with', () => {
    const hasil = render(
      '<with a><with b><{ x }><{ y }></with></with>',
      { a: { x: 'X' }, b: { y: 'Y' } },
    );
    assert.equal(hasil, 'XY');
  });

  test('with pada path tidak ada → tidak throw, kosong render', () => {
    assert.doesNotThrow(() =>
      render('<with tidakAda><{ x }></with>', {}),
    );
  });
});

// ─────────────────────────────────────────────
// <set> — fitur baru v2.0.0
// ─────────────────────────────────────────────

describe('prosesSet', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('set variabel string literal', () => {
    const hasil = render('<set salam = "Halo Dunia"><{ salam }>', {});
    assert.equal(hasil, 'Halo Dunia');
  });

  test('set variabel dari path', () => {
    const hasil = render('<set nama = pengguna.nama><{ nama }>', { pengguna: { nama: 'Wahid' } });
    assert.equal(hasil, 'Wahid');
  });

  test('set variabel tidak mempengaruhi data di luar template', () => {
    const data = {};
    render('<set x = "test">', data);
    // data asli tidak berubah — set hanya dalam scope render
    assert.equal(data.x, undefined);
  });

  test('set override variabel yang sudah ada', () => {
    const hasil = render('<set nama = "Baru"><{ nama }>', { nama: 'Lama' });
    assert.equal(hasil, 'Baru');
  });
});

// ─────────────────────────────────────────────
// <raw> — fitur baru v2.0.0
// ─────────────────────────────────────────────

describe('raw block', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('konten <raw> tidak diproses', () => {
    const hasil = render('<raw><{ variabel }></raw>', { variabel: 'DIPROSES' });
    assert.equal(hasil.trim(), '<{ variabel }>');
  });

  test('tag <each> di dalam <raw> tidak dieksekusi', () => {
    const hasil = render('<raw><each item in list><{ item }}</each></raw>', { list: ['a'] });
    assert.ok(hasil.includes('<each item in list>'));
  });

  test('konten di luar <raw> tetap diproses', () => {
    const hasil = render('<{ a }><raw><{ b }></raw><{ c }>', { a: 'A', b: 'B', c: 'C' });
    assert.equal(hasil, 'A<{ b }>C');
  });
});

// ─────────────────────────────────────────────
// <macro> & <call> — fitur baru v2.0.0
// ─────────────────────────────────────────────

describe('macro & call', () => {
  const render = (tpl, data) => renderTemplate(tpl, data, tmpdir());

  test('definisi dan pemanggilan macro sederhana', () => {
    const hasil = render(
      '<macro sapaan(nama)>Halo, <{ nama }>!</macro><call sapaan(nama="Wahid")>',
      {},
    );
    assert.ok(hasil.includes('Halo, Wahid!'));
  });

  test('macro tidak muncul di output (definisi dihapus)', () => {
    const hasil = render('<macro greet(n)>Hi <{ n }></macro>teks setelah', {});
    assert.ok(!hasil.includes('<macro'));
    assert.ok(hasil.includes('teks setelah'));
  });

  test('macro dipanggil beberapa kali dengan argumen berbeda', () => {
    const hasil = render(
      '<macro tag(label)>[<{ label }>]</macro><call tag(label="A")><call tag(label="B")>',
      {},
    );
    assert.ok(hasil.includes('[A]'));
    assert.ok(hasil.includes('[B]'));
  });

  test('call macro tidak ada tidak melempar error', () => {
    assert.doesNotThrow(() =>
      render('<call tidakAda(x="val")>', {}),
    );
  });
});

// ─────────────────────────────────────────────
// Named slots — fitur baru v2.0.0
// ─────────────────────────────────────────────

describe('named slots: <fill> + <slot>', () => {
  const dirTemp = buatDirTemp('slots');

  // Layout dengan slot head dan slot title
  writeFileSync(
    join(dirTemp, 'layouts', 'dengan-slots.html'),
    [
      '<!DOCTYPE html>',
      '<html>',
      '<head><slot name="head"></slot></head>',
      '<body>',
      '<header><slot name="title">Judul Default</slot></header>',
      '<main><contents></contents></main>',
      '</body>',
      '</html>',
    ].join('\n'),
  );

  // View yang mengisi named slots + konten utama
  writeFileSync(
    join(dirTemp, 'beranda.html'),
    [
      '<fill name="head"><link rel="stylesheet" href="/app.css"></fill>',
      '<fill name="title">Beranda Utama</fill>',
      '<p>Isi halaman beranda.</p>',
    ].join('\n'),
  );

  // View tanpa fill — hanya konten utama
  writeFileSync(
    join(dirTemp, 'sederhana.html'),
    '<p>Hanya konten.</p>',
  );

  const engine = buatEngine({ dirViews: dirTemp, dirLayouts: join(dirTemp, 'layouts') });

  test('fill name="head" disuntikkan ke slot head', () => {
    const html = engine.render('beranda.html', {}, 'dengan-slots');
    assert.ok(html.includes('<link rel="stylesheet" href="/app.css">'));
  });

  test('fill name="title" disuntikkan ke slot title', () => {
    const html = engine.render('beranda.html', {}, 'dengan-slots');
    assert.ok(html.includes('Beranda Utama'));
    assert.ok(!html.includes('Judul Default'));
  });

  test('konten non-fill tetap di slot <contents>', () => {
    const html = engine.render('beranda.html', {}, 'dengan-slots');
    assert.ok(html.includes('<p>Isi halaman beranda.</p>'));
  });

  test('slot tanpa fill menampilkan konten default', () => {
    const html = engine.render('sederhana.html', {}, 'dengan-slots');
    assert.ok(html.includes('Judul Default'));
  });

  test('konten fill tidak muncul dobel (di <contents> sekaligus di <slot>)', () => {
    const html = engine.render('beranda.html', {}, 'dengan-slots');
    // <fill> harus diambil dari output konten utama, tidak ikut masuk ke <contents>
    const countLink = (html.match(/rel="stylesheet"/g) ?? []).length;
    assert.equal(countLink, 1);
  });
});

// ─────────────────────────────────────────────
// Circular include protection
// ─────────────────────────────────────────────

describe('proteksi circular include', () => {
  test('melempar error saat kedalaman include melampaui batas', () => {
    const dirTemp = buatDirTemp('circular');
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
// File cache & invalidasiCache
// ─────────────────────────────────────────────

describe('file cache', () => {
  test('ukuranCache bertambah setelah render', () => {
    const dirTemp = buatDirTemp('cache');
    writeFileSync(join(dirTemp, 'layouts', 'utama.html'), '<body><contents></contents></body>');
    writeFileSync(join(dirTemp, 'halaman.html'), '<p>Konten</p>');

    const engine = buatEngine({ dirViews: dirTemp, dirLayouts: join(dirTemp, 'layouts') });
    engine.render('halaman.html', {}, 'utama');

    assert.ok(engine.ukuranCache >= 2);
  });

  test('kosongkanCache mengosongkan cache', () => {
    const dirTemp = buatDirTemp('kosong');
    writeFileSync(join(dirTemp, 'snippet.html'), '<p><{ teks }></p>');

    const engine = buatEngine({ dirViews: dirTemp, dirLayouts: join(dirTemp, 'layouts') });
    engine.render('snippet.html', { teks: 'tes' });
    assert.ok(engine.ukuranCache >= 1);

    engine.kosongkanCache();
    assert.equal(engine.ukuranCache, 0);
  });

  test('invalidasiCache menghapus satu entry — fitur baru v2.0.0', () => {
    const dirTemp   = buatDirTemp('invalid');
    const pathView  = join(dirTemp, 'halaman.html');
    writeFileSync(pathView, '<p>A</p>');

    const engine = buatEngine({ dirViews: dirTemp, dirLayouts: join(dirTemp, 'layouts') });
    engine.render('halaman.html', {});
    const ukuranSebelum = engine.ukuranCache;

    engine.invalidasiCache(pathView);
    assert.equal(engine.ukuranCache, ukuranSebelum - 1);
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
