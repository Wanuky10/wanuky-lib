import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { escapeHtml } from './utils/escaper.js';
import { resolveNilai, evaluasiKondisi } from './utils/resolver.js';

// ─────────────────────────────────────────────────────────────
// Regex untuk setiap konstruksi template — dikompilasi di module level.
// ─────────────────────────────────────────────────────────────

// Interpolasi: <{ ekspresi }>  |  <{ !ekspresi }> (raw)
const REGEX_INTERPOLASI = /<\{\s*(!?[\w.]+)\s*\}>/g;

// Include: <include="path/ke/file.html">
const REGEX_INCLUDE = /<include="([^"]+)">/g;

// Loop: <each item in koleksi>  atau  <each idx, item in koleksi>
// Group 1: alias indeks (opsional, mungkin undefined)
// Group 2: alias item
// Group 3: path koleksi (dot-notation)
const REGEX_EACH_BUKA = /<each\s+(?:([\w]+)\s*,\s*)?([\w]+)\s+in\s+([\w.[\]]+)\s*>/;

// Kondisional
const REGEX_IF_BUKA = /<if\s+((?:[^>]|>=)+)>/;
const REGEX_ELSEIF = /^<elseif\s+((?:[^>]|>=)+)>/;

// ─────────────────────────────────────────────────────────────
// Prosesor publik
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <{ variabel }> — auto-escape XSS kecuali prefix '!'.
 *
 * @param {string} template
 * @param {object} data
 * @returns {string}
 */
export function prosesInterpolasi(template, data) {
  return template.replace(REGEX_INTERPOLASI, (_match, ekspresi) => {
    const rawMode = ekspresi.startsWith('!');
    const path = rawMode ? ekspresi.slice(1) : ekspresi;
    const nilai = resolveNilai(data, path);
    return rawMode ? (nilai ?? '') : escapeHtml(nilai);
  });
}

/**
 * Memproses <each [idx,] item in koleksi>...</each> secara rekursif.
 * Mendukung:
 *   - <each item in daftar>        — alias item saja
 *   - <each i, item in daftar>     — alias indeks + item
 *   - loop.indeks, loop.pertama, loop.terakhir, loop.total selalu tersedia
 *
 * @param {string} template
 * @param {object} data
 * @param {Function} renderFn
 * @returns {string}
 */
export function prosesEach(template, data, renderFn) {
  let hasil = template;

  while (true) {
    const kecocokan = hasil.match(REGEX_EACH_BUKA);
    if (!kecocokan) break;

    const indeksBuka = hasil.indexOf(kecocokan[0]);
    const namaIndeks  = kecocokan[1]; // mungkin undefined
    const namaAlias   = kecocokan[2];
    const namaKoleksi = kecocokan[3];
    const setelahBuka = indeksBuka + kecocokan[0].length;

    const indeksTutup = cariPasanganEach(hasil, setelahBuka);
    if (indeksTutup === -1) {
      // Tag tidak berpasangan — lewati agar tidak infinite loop
      break;
    }

    const kontenLoop = hasil.slice(setelahBuka, indeksTutup);
    const koleksi = resolveNilai(data, namaKoleksi);
    const total = Array.isArray(koleksi) ? koleksi.length : 0;

    let hasilLoop = '';
    if (Array.isArray(koleksi)) {
      hasilLoop = koleksi
        .map((item, indeks) => {
          const konteksItem = {
            ...data,
            [namaAlias]: item,
            // Jika ada alias indeks eksplisit, tambahkan ke konteks
            ...(namaIndeks ? { [namaIndeks]: indeks } : {}),
            // Metadata loop selalu tersedia tanpa alias eksplisit
            loop: {
              indeks,
              pertama: indeks === 0,
              terakhir: indeks === total - 1,
              total,
            },
          };
          return renderFn(kontenLoop, konteksItem);
        })
        .join('');
    }

    hasil =
      hasil.slice(0, indeksBuka) +
      hasilLoop +
      hasil.slice(indeksTutup + '</each>'.length);
  }

  return hasil;
}

/**
 * Memproses <if ekspresi>...<elseif ekspresi>...<else>...</if>.
 * Mendukung banyak <elseif> dan nested <if> yang benar.
 *
 * @param {string} template
 * @param {object} data
 * @param {Function} renderFn
 * @returns {string}
 */
export function prosesIf(template, data, renderFn) {
  let hasil = template;

  while (true) {
    const kecocokan = hasil.match(REGEX_IF_BUKA);
    if (!kecocokan) break;

    const indeksBuka = hasil.indexOf(kecocokan[0]);
    const ekspresiAwal = kecocokan[1].trim();
    const setelahBuka = indeksBuka + kecocokan[0].length;

    const indeksTutup = cariPasanganIf(hasil, setelahBuka);
    if (indeksTutup === -1) break;

    const kontenBlok = hasil.slice(setelahBuka, indeksTutup);

    // Pecah blok menjadi klausa: [{kondisi, konten}, ...]
    const klausa = cariKlausaIf(ekspresiAwal, kontenBlok);

    // Evaluasi klausa satu per satu — ambil klausa pertama yang kondisinya benar
    let kontenTerpilih = '';
    for (const k of klausa) {
      // kondisi null = klausa <else> — selalu diambil jika belum ada yang cocok
      if (k.kondisi === null || evaluasiKondisi(k.kondisi, data)) {
        kontenTerpilih = k.konten;
        break;
      }
    }

    hasil =
      hasil.slice(0, indeksBuka) +
      renderFn(kontenTerpilih, data) +
      hasil.slice(indeksTutup + '</if>'.length);
  }

  return hasil;
}

/**
 * Memproses <include="path"> dengan membaca file dan me-render isinya.
 * Menggunakan bacaFile yang diinjeksikan agar dapat di-cache oleh engine.
 *
 * @param {string} template
 * @param {object} data
 * @param {string} baseDir
 * @param {Function} renderFn - render rekursif
 * @param {Function} bacaFile - (pathAbsolut: string) => string
 * @returns {string}
 */
export function prosesInclude(template, data, baseDir, renderFn, bacaFile) {
  return template.replace(REGEX_INCLUDE, (_match, pathPartial) => {
    const pathAbsolut = resolve(baseDir, pathPartial);

    let kontenPartial;
    try {
      kontenPartial = bacaFile(pathAbsolut);
    } catch (err) {
      throw new Error(
        `[template-engine] Gagal membaca partial "${pathPartial}" ` +
        `(${pathAbsolut}): ${err.message}`,
      );
    }

    const dirPartial = dirname(pathAbsolut);
    // renderFn sudah menyertakan increment kedalaman — circular include terproteksi
    return renderFn(kontenPartial, data, dirPartial);
  });
}

// ─────────────────────────────────────────────────────────────
// Helper internal
// ─────────────────────────────────────────────────────────────

/**
 * Mencari posisi </each> berpasangan dari posisi setelahBuka.
 * Menggunakan '<each ' (dengan spasi) untuk menghindari false match
 * pada tag lain seperti <eachother>.
 */
function cariPasanganEach(template, setelahBuka) {
  let kedalaman = 1;
  let posisi = setelahBuka;

  while (posisi < template.length) {
    const slisaTutup = template.indexOf('</each>', posisi);
    const slisaBuka  = template.indexOf('<each ', posisi);

    if (slisaTutup === -1) return -1;

    if (slisaBuka !== -1 && slisaBuka < slisaTutup) {
      kedalaman++;
      posisi = slisaBuka + 6; // panjang '<each '
    } else {
      kedalaman--;
      if (kedalaman === 0) return slisaTutup;
      posisi = slisaTutup + 7; // panjang '</each>'
    }
  }

  return -1;
}

/**
 * Mencari posisi </if> berpasangan dari posisi setelahBuka.
 * Menggunakan '<if ' (dengan spasi) untuk menghindari false match.
 */
function cariPasanganIf(template, setelahBuka) {
  let kedalaman = 1;
  let posisi = setelahBuka;

  while (posisi < template.length) {
    const slisaTutup = template.indexOf('</if>', posisi);
    const slisaBuka  = template.indexOf('<if ', posisi);

    if (slisaTutup === -1) return -1;

    if (slisaBuka !== -1 && slisaBuka < slisaTutup) {
      kedalaman++;
      posisi = slisaBuka + 4; // panjang '<if '
    } else {
      kedalaman--;
      if (kedalaman === 0) return slisaTutup;
      posisi = slisaTutup + 5; // panjang '</if>'
    }
  }

  return -1;
}

/**
 * Memecah konten di dalam <if>...</if> menjadi klausa-klausa:
 *   [ {kondisi: 'ekspresi', konten: '...'}, ... , {kondisi: null, konten: '...'} ]
 *
 * Klausa pertama menggunakan ekspresiAwal (dari tag <if> luar).
 * <elseif> dan <else> di level datar (bukan nested) membentuk klausa baru.
 * kondisi null menandai klausa <else>.
 *
 * @param {string} ekspresiAwal - Kondisi dari tag <if> luar
 * @param {string} kontenBlok - Seluruh isi antara <if> dan </if>
 * @returns {Array<{kondisi: string|null, konten: string}>}
 */
function cariKlausaIf(ekspresiAwal, kontenBlok) {
  const klausa = [];
  let kondisiSaatIni = ekspresiAwal;
  let posisiMulai = 0;
  let kedalaman = 0;
  let posisi = 0;

  while (posisi < kontenBlok.length) {
    // Lacak nesting <if> agar <elseif>/<else> di dalam nested <if> tidak salah ditangkap
    if (kontenBlok.startsWith('<if ', posisi)) {
      kedalaman++;
      posisi += 4;
      continue;
    }
    if (kontenBlok.startsWith('</if>', posisi)) {
      kedalaman = Math.max(0, kedalaman - 1);
      posisi += 5;
      continue;
    }

    // Hanya proses <elseif> dan <else> di level datar (kedalaman === 0)
    if (kedalaman === 0) {
      const sisa = kontenBlok.slice(posisi);

      // Cek <elseif kondisi>
      const matchElseif = sisa.match(REGEX_ELSEIF);
      if (matchElseif) {
        klausa.push({ kondisi: kondisiSaatIni, konten: kontenBlok.slice(posisiMulai, posisi) });
        kondisiSaatIni = matchElseif[1].trim();
        posisiMulai = posisi + matchElseif[0].length;
        posisi = posisiMulai;
        continue;
      }

      // Cek <else>
      if (sisa.startsWith('<else>')) {
        klausa.push({ kondisi: kondisiSaatIni, konten: kontenBlok.slice(posisiMulai, posisi) });
        kondisiSaatIni = null;
        posisiMulai = posisi + 6;
        posisi = posisiMulai;
        continue;
      }
    }

    posisi++;
  }

  // Tambah klausa terakhir
  klausa.push({ kondisi: kondisiSaatIni, konten: kontenBlok.slice(posisiMulai) });
  return klausa;
}
