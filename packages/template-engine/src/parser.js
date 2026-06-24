/**
 * Parser template v2.2.0
 *
 * Konstruksi yang didukung:
 *
 *   Interpolasi
 *     <{ variabel }>                  — auto-escape XSS
 *     <{ !variabel }>                 — raw HTML (tanpa escape)
 *     <{ variabel | filter }>         — filter/pipe
 *     <{ variabel | filter: arg }>    — filter dengan argumen
 *     <{ var | f1 | f2: a, b }>       — chained filters
 *
 *   Loop
 *     <each item in koleksi>...</each>
 *     <each idx, item in koleksi>...</each>
 *     (loop.indeks, loop.pertama, loop.terakhir, loop.total selalu tersedia)
 *
 *   Kondisional
 *     <if ekspresi>...<elseif ekspresi>...<else>...</if>
 *     <unless ekspresi>...</unless>      — inverse dari <if>
 *
 *   Switch
 *     <switch variabel>
 *       <when "nilai1">...</when>
 *       <when nilai2>...</when>
 *       <default>...</default>
 *     </switch>
 *
 *   Variabel lokal
 *     <set namaVar = "literal">
 *     <set namaVar = path.ke.nilai>
 *
 *   Scope aliasing
 *     <with path.ke.objek>...</with>
 *
 *   Blok raw (tidak diproses)
 *     <raw>...</raw>
 *
 *   Macro (fragment reusable)
 *     <macro namaFungsi(param1, param2)>...</macro>
 *     <call namaFungsi(param1="nilai", param2=path)>
 *
 *   Include partial
 *     <include="path/ke/partial.html">
 *
 *   Named fills (untuk layout sistem)
 *     <fill name="header">konten</fill>
 *
 * Catatan:
 *   - Semua konstruksi mendukung nesting yang benar via depth tracking
 *   - <set> di dalam <if>/<each> berlaku hanya untuk scope tersebut
 *   - Macro tidak boleh didefinisikan secara bersarang
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { escapeHtml } from './utils/escaper.js';
import { resolveNilai } from './utils/resolver.js';
import { evaluasiEkspresi } from './utils/expression.js';
import { applyFilters, parseFilterExpression } from './utils/filter.js';
import { TemplateError } from './errors.js';

// ─────────────────────────────────────────────────────────────
// Konstanta regex — dikompilasi di module level
// ─────────────────────────────────────────────────────────────

// Interpolasi: <{ ekspresi }> dengan dukungan pipe dan raw mode
const REGEX_INTERPOLASI = /<\{\s*(.*?)\s*\}>/gs;

// Include: <include="path">
const REGEX_INCLUDE = /<include="([^"]+)">/g;

// Each: <each [idx,] item in koleksi>
// Grup 1: alias indeks (opsional)
// Grup 2: alias item
// Grup 3: path koleksi
const REGEX_EACH_BUKA = /<each\s+(?:([\w]+)\s*,\s*)?([\w]+)\s+in\s+([\w.[\]]+)\s*>/;

// If/Unless/Elseif
//
// @adr     Ekspresi kondisi diekstrak via scanner manual (cariTutupTagKondisi),
//          BUKAN regex character-class.
// @context Delimiter penutup tag (`>`) dan operator comparison (`>`, `>=`) memakai
//          karakter yang sama persis. Regex lokal seperti /<if\s+((?:[^>]|>=)+)>/
//          tidak punya cara membedakan keduanya — ia berhenti di `>` PERTAMA yang
//          bukan `>=`, sehingga `<if usia > 17>` salah ditangkap sebagai tag pembuka
//          `<if usia >` (ekspresi cuma "usia "), dan sisa " 17>DEWASA..." bocor
//          mentah ke output. Operator `>` standalone jadi tidak mungkin dipakai
//          tanpa workaround (lihat git history/CHANGELOG sebelum v2.2.0).
// @decision Scanner token-aware (lihat cariTutupTagKondisi di bagian helper) yang
//          melacak apakah posisi saat ini "mengharapkan operand" atau "mengharapkan
//          operator-atau-akhir-tag" — closing delimiter `>` hanya valid saat berada
//          dalam state kedua. String literal dilewati utuh (quote-aware) agar `>`
//          di dalamnya (jika ada di masa depan) tidak pernah disalahartikan.
// @tradeoff Sedikit lebih mahal dibanding regex tunggal (O(n) scan manual per tag),
//          tapi n di sini adalah panjang satu baris tag pembuka — overhead diabaikan.
// @alternatives Mengubah sintaks delimiter (mis. `<if(...)>` atau `{% if %}`) akan
//          menghapus ambiguitas total, tapi itu breaking change pada sintaks publik
//          — ditolak demi backward compatibility template existing.
const REGEX_IF_BUKA_NAMA     = /^<if\s+/;
const REGEX_UNLESS_BUKA_NAMA = /^<unless\s+/;
const REGEX_ELSEIF_NAMA      = /^<elseif\s+/;

// Switch
const REGEX_SWITCH_BUKA = /<switch\s+([\w.[\]]+)\s*>/;

// Set: <set varName = "literal"> atau <set varName = path[(+|-)path...]>
// Grup 3 menangkap operand pertama + 0..n pasangan (operator, operand) lanjutan.
// Operand boleh path (dot/bracket notation) atau angka literal (mis. -3.5).
const OPERAND_SET = '(?:-?\\d+\\.?\\d*|[\\w.[\\]]+)';
const REGEX_SET = new RegExp(
  `<set\\s+([\\w]+)\\s*=\\s*(?:"([^"]*)"|(${OPERAND_SET}(?:\\s*[+\\-]\\s*${OPERAND_SET})*))\\s*>`,
  'g',
);

// With: <with path>
const REGEX_WITH_BUKA = /<with\s+([\w.[\]]+)\s*>/;

// Call: <call macroName> atau <call macroName(args)>
const REGEX_CALL = /<call\s+([\w]+)(?:\s*\(([\s\S]*?)\))?\s*>/g;

// Placeholder untuk blok raw
const RAW_PREFIX = '\x00WANUKY_RAW_';
const RAW_SUFFIX = '\x00';

// ─────────────────────────────────────────────────────────────
// Proteksi blok <raw>
// ─────────────────────────────────────────────────────────────

/**
 * Ekstrak blok <raw>...</raw> dan ganti dengan placeholder.
 * Blok raw tidak diproses oleh engine sama sekali.
 *
 * @param {string} template
 * @returns {{ template: string, rawBlocks: Map<string, string> }}
 */
export function protectRawBlocks(template) {
  const rawBlocks = new Map();
  let idx = 0;

  const result = template.replace(/<raw>([\s\S]*?)<\/raw>/g, (_, konten) => {
    const key = `${RAW_PREFIX}${idx++}${RAW_SUFFIX}`;
    rawBlocks.set(key, konten);
    return key;
  });

  return { template: result, rawBlocks };
}

/**
 * Pulihkan placeholder kembali ke konten raw aslinya.
 *
 * @param {string} template
 * @param {Map<string, string>} rawBlocks
 * @returns {string}
 */
export function restoreRawBlocks(template, rawBlocks) {
  let result = template;
  for (const [key, konten] of rawBlocks) {
    // Gunakan split/join agar tidak ada regex meta-character issue
    result = result.split(key).join(konten);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Macro
// ─────────────────────────────────────────────────────────────

/**
 * Ekstrak definisi <macro> dari template.
 * Macro yang diekstrak dihapus dari output — mereka hanya definisi.
 *
 * @param {string} template
 * @returns {{ template: string, macros: object }}
 */
export function extractMacros(template) {
  const macros = {};
  const REGEX  = /<macro\s+([\w]+)(?:\s*\(([\w\s,]*)\))?\s*>([\s\S]*?)<\/macro>/g;

  const cleaned = template.replace(REGEX, (_, name, params, body) => {
    macros[name] = {
      params: params
        ? params.split(',').map((p) => p.trim()).filter(Boolean)
        : [],
      body: body,
    };
    return '';
  });

  return { template: cleaned, macros };
}

/**
 * Mem-parse argumen <call macroName(key="val", key2=path)>.
 *
 * @param {string|undefined} argsStr - String argumen dari tag call
 * @param {object} data              - Konteks data untuk resolve path
 * @returns {object}
 */
function parseMacroCallArgs(argsStr, data) {
  const args = {};
  if (!argsStr?.trim()) return args;

  // Parse key="string" atau key=path.ke.nilai
  const PAIR = /\s*([\w]+)\s*=\s*(?:"([^"]*)"|([\w.[\]]+))\s*/g;
  let m;
  while ((m = PAIR.exec(argsStr)) !== null) {
    const [, key, strVal, pathVal] = m;
    args[key] = strVal !== undefined
      ? strVal
      : resolveNilai(data, pathVal);
  }
  return args;
}

// ─────────────────────────────────────────────────────────────
// Helper internal — line tracking untuk TemplateError
// ─────────────────────────────────────────────────────────────

/**
 * Menghitung nomor baris (1-based) dari sebuah index karakter dalam string.
 *
 * CATATAN PENTING soal akurasi: index dihitung relatif terhadap string
 * `template` yang sedang diproses pada level rekursi saat ini — BUKAN file
 * sumber asli di disk. Untuk template yang berasal langsung dari file (belum
 * melalui <include>/<call>/<each> dsb.), ini sama dengan baris di file asli.
 * Begitu sebuah fragment sudah melalui substitusi rekursif (mis. body
 * <each>/<macro> yang di-render ulang per iterasi, atau partial yang
 * di-include), nomor baris merujuk ke posisi dalam fragment tersebut, bukan
 * lagi baris absolut di file aslinya — keterbatasan inheren dari arsitektur
 * regex-driven string rewriting ini (tidak ada AST dengan source map).
 *
 * @param {string} str
 * @param {number} index
 * @returns {number}
 */
function hitungBarisDariIndeks(str, index) {
  let baris = 1;
  for (let i = 0; i < index && i < str.length; i++) {
    if (str[i] === '\n') baris++;
  }
  return baris;
}

// ─────────────────────────────────────────────────────────────
// Prosesor: Set
// ─────────────────────────────────────────────────────────────

/**
 * Mem-parse ekspresi <set> menjadi token operand + operator pada top level.
 * Hanya '+' dan '-' yang didukung (sesuai keputusan desain v2.2.0).
 *
 * PENTING: tidak menggunakan String.split(/[+-]/) — itu akan memecah tanda
 * minus literal pada operand pertama secara salah (mis. '-5 + harga' akan
 * terbaca sebagai operator '-' diikuti operand '5', bukan literal '-5').
 * Sebagai gantinya, setiap operand di-match secara eksplisit via regex
 * (boleh diawali '-' sebagai tanda literal HANYA pada posisi awal operand),
 * lalu operator pemisah dibaca dari karakter tepat setelah operand tersebut.
 *
 * Contoh: '-5 + harga - diskon' →
 *   [{ operand: '-5', op: null }, { operand: 'harga', op: '+' }, { operand: 'diskon', op: '-' }]
 *
 * @param {string} ekspresi
 * @returns {Array<{ operand: string, op: '+'|'-'|null }>}
 */
function tokenisasiSetEkspresi(ekspresi) {
  const token = [];
  // Operand: angka (boleh berawalan '-' literal) ATAU path dot/bracket notation.
  const REGEX_OPERAND = /-?\d+\.?\d*|[\w.[\]]+/g;

  let opBerikutnya = null;
  let m;
  while ((m = REGEX_OPERAND.exec(ekspresi)) !== null) {
    token.push({ operand: m[0], op: opBerikutnya });

    // Baca operator tepat setelah operand ini (jika ada) untuk token berikutnya
    const sisa = ekspresi.slice(REGEX_OPERAND.lastIndex).match(/^\s*([+-])\s*/);
    opBerikutnya = sisa ? sisa[1] : null;
  }
  return token;
}

/**
 * Mengevaluasi ekspresi <set> yang mungkin mengandung aritmatika (+, -).
 *
 * Aturan:
 *   - Operand tunggal tanpa operator → delegasikan langsung ke resolveNilai
 *     (mempertahankan dukungan nilai non-numerik: string, boolean, object, array).
 *   - Dua operand atau lebih dengan operator → WAJIB numerik. Jika salah satu
 *     operand resolve ke non-number (termasuk undefined/NaN), lempar
 *     TemplateError eksplisit — TIDAK silent-fail ke undefined seperti v2.1.x.
 *
 * @param {string} ekspresi - Ekspresi mentah dari REGEX_SET grup 3.
 * @param {object} data     - Konteks data untuk resolve operand berupa path.
 * @param {string} varName  - Nama variabel tujuan (untuk pesan error).
 * @param {number} [line]   - Nomor baris tag <set> ini (untuk TemplateError.line).
 * @returns {unknown}
 */
function evaluasiSetEkspresi(ekspresi, data, varName, line) {
  const token = tokenisasiSetEkspresi(ekspresi);

  // Operand tunggal — bukan aritmatika, perilaku v2.1.x dipertahankan penuh.
  if (token.length === 1) {
    return resolveNilai(data, token[0].operand);
  }

  // Aritmatika — setiap operand wajib numerik.
  let akumulator;
  for (const { operand, op } of token) {
    const nilai = resolveNilai(data, operand);
    if (typeof nilai !== 'number' || Number.isNaN(nilai)) {
      throw new TemplateError(
        `<set ${varName}>: operand "${operand}" tidak menghasilkan angka (didapat: ${JSON.stringify(nilai)}). ` +
        `Ekspresi aritmatika pada <set> hanya mendukung operand numerik.`,
        { variabelTersedia: Object.keys(data), line },
      );
    }
    akumulator = akumulator === undefined
      ? nilai
      : (op === '-' ? akumulator - nilai : akumulator + nilai);
  }
  return akumulator;
}

/**
 * Memproses <set varName = nilai> — variabel lokal template.
 * Tag <set> dihapus dari output; nilai ditambahkan ke salinan context baru.
 *
 * Mendukung tiga bentuk:
 *   <set nama = "literal string">     — literal, tanpa resolve
 *   <set nama = path.ke.nilai>        — resolve langsung via resolveNilai
 *   <set total = harga + diskon - 5>  — aritmatika numerik (+ dan -)
 *
 * CATATAN: <set> di dalam <each>/<if> berlaku untuk scope rekursif tersebut.
 * Variabel yang di-set tidak propagate ke scope parent.
 *
 * @param {string} template
 * @param {object} data
 * @returns {{ template: string, data: object }}
 */
export function prosesSet(template, data) {
  const newData = { ...data };
  const result  = template.replace(REGEX_SET, (_, varName, strVal, ekspresi, offset) => {
    newData[varName] = strVal !== undefined
      ? strVal
      : evaluasiSetEkspresi(ekspresi, newData, varName, hitungBarisDariIndeks(template, offset));
    return '';
  });
  // Reset lastIndex karena REGEX_SET adalah global
  REGEX_SET.lastIndex = 0;
  return { template: result, data: newData };
}

// ─────────────────────────────────────────────────────────────
// Prosesor: Interpolasi
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <{ variabel | filter }> dengan auto-escape XSS.
 * Prefix '!' mengaktifkan mode raw (tanpa escape).
 *
 * @param {string} template
 * @param {object} data
 * @returns {string}
 */
export function prosesInterpolasi(template, data) {
  return template.replace(REGEX_INTERPOLASI, (match, ekspresi) => {
    if (!ekspresi.trim()) return '';

    try {
      const { isRaw, path, filters } = parseFilterExpression(ekspresi);
      let nilai = resolveNilai(data, path);

      // Terapkan filters jika ada
      if (filters.length > 0) {
        nilai = applyFilters(nilai, filters);
      }

      // Raw mode: kembalikan langsung tanpa escape
      if (isRaw) {
        return nilai ?? '';
      }

      // Auto-escape XSS
      return escapeHtml(nilai);
    } catch (err) {
      // Jangan crash template karena error interpolasi — kembalikan komentar error
      return `<!-- [template-engine] Interpolasi gagal: ${escapeHtml(err.message)} -->`;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Prosesor: Each
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <each [idx,] item in koleksi>...</each>.
 * Mendukung nesting dan metadata loop.
 *
 * @param {string} template
 * @param {object} data
 * @param {Function} renderFn
 * @returns {string}
 */
export function prosesEach(template, data, renderFn) {
  let hasil = template;

  while (true) {
    const match = hasil.match(REGEX_EACH_BUKA);
    if (!match) break;

    const idxBuka    = hasil.indexOf(match[0]);
    const namaIndeks = match[1];       // opsional
    const namaAlias  = match[2];
    const namaKoleksi = match[3];
    const setelahBuka = idxBuka + match[0].length;

    const idxTutup = cariPasanganTag(hasil, setelahBuka, '<each ', '</each>');
    if (idxTutup === -1) break;

    const kontenLoop = hasil.slice(setelahBuka, idxTutup);
    const koleksi    = resolveNilai(data, namaKoleksi);
    const total      = Array.isArray(koleksi) ? koleksi.length : 0;

    let hasilLoop = '';
    if (Array.isArray(koleksi) && total > 0) {
      hasilLoop = koleksi
        .map((item, indeks) => {
          const ctxItem = {
            ...data,
            [namaAlias]: item,
            ...(namaIndeks ? { [namaIndeks]: indeks } : {}),
            loop: {
              indeks,
              pertama:  indeks === 0,
              terakhir: indeks === total - 1,
              total,
            },
          };
          return renderFn(kontenLoop, ctxItem);
        })
        .join('');
    }

    hasil =
      hasil.slice(0, idxBuka) +
      hasilLoop +
      hasil.slice(idxTutup + '</each>'.length);
  }

  return hasil;
}

// ─────────────────────────────────────────────────────────────
// Prosesor: If / Unless
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <if ekspresi>...<elseif>...<else>...</if>.
 * Menggunakan evaluasiEkspresi yang mendukung &&, ||, !.
 *
 * @param {string} template
 * @param {object} data
 * @param {Function} renderFn
 * @returns {string}
 */
export function prosesIf(template, data, renderFn) {
  let hasil = template;

  while (true) {
    const match = cariTagKondisiPertama(hasil, REGEX_IF_BUKA_NAMA);
    if (!match) break;

    const idxBuka      = match.idxBuka;
    const ekspresiAwal = match.ekspresi.trim();
    const setelahBuka   = idxBuka + match.match0.length;

    const idxTutup = cariPasanganTag(hasil, setelahBuka, '<if ', '</if>');
    if (idxTutup === -1) break;

    const kontenBlok = hasil.slice(setelahBuka, idxTutup);
    const klausa     = cariKlausaIf(ekspresiAwal, kontenBlok);

    let kontenTerpilih = '';
    for (const k of klausa) {
      if (k.kondisi === null || evaluasiEkspresi(k.kondisi, data)) {
        kontenTerpilih = k.konten;
        break;
      }
    }

    hasil =
      hasil.slice(0, idxBuka) +
      renderFn(kontenTerpilih, data) +
      hasil.slice(idxTutup + '</if>'.length);
  }

  return hasil;
}

/**
 * Memproses <unless ekspresi>...<else>...</unless>.
 * Mendukung klausa <else> opsional — inverse semantik dari <if>.
 *
 * @param {string} template
 * @param {object} data
 * @param {Function} renderFn
 * @returns {string}
 */
export function prosesUnless(template, data, renderFn) {
  let hasil = template;

  while (true) {
    const match = cariTagKondisiPertama(hasil, REGEX_UNLESS_BUKA_NAMA);
    if (!match) break;

    const idxBuka     = match.idxBuka;
    const ekspresi    = match.ekspresi.trim();
    const setelahBuka = idxBuka + match.match0.length;

    const idxTutup = cariPasanganTag(hasil, setelahBuka, '<unless ', '</unless>');
    if (idxTutup === -1) break;

    const kontenBlok = hasil.slice(setelahBuka, idxTutup);
    const idxElse   = cariElseTopLevel(kontenBlok);

    let kontenJikaFalse, kontenJikaTrue;
    if (idxElse !== -1) {
      kontenJikaFalse = kontenBlok.slice(0, idxElse);
      kontenJikaTrue  = kontenBlok.slice(idxElse + 6); // skip '<else>'
    } else {
      kontenJikaFalse = kontenBlok;
      kontenJikaTrue  = '';
    }

    const kondisi  = evaluasiEkspresi(ekspresi, data);
    const rendered = !kondisi
      ? renderFn(kontenJikaFalse, data)
      : renderFn(kontenJikaTrue, data);

    hasil =
      hasil.slice(0, idxBuka) +
      rendered +
      hasil.slice(idxTutup + '</unless>'.length);
  }

  return hasil;
}

// ─────────────────────────────────────────────────────────────
// Prosesor: Switch
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <switch variabel><when val>...</when><default>...</default></switch>.
 *
 * @param {string} template
 * @param {object} data
 * @param {Function} renderFn
 * @returns {string}
 */
export function prosesSwitch(template, data, renderFn) {
  let hasil = template;

  while (true) {
    const match = hasil.match(REGEX_SWITCH_BUKA);
    if (!match) break;

    const idxBuka    = hasil.indexOf(match[0]);
    const exprPath   = match[1].trim();
    const setelahBuka = idxBuka + match[0].length;

    const idxTutup = cariPasanganTag(hasil, setelahBuka, '<switch ', '</switch>');
    if (idxTutup === -1) break;

    const kontenSwitch = hasil.slice(setelahBuka, idxTutup);
    const nilaiSwitch  = String(resolveNilai(data, exprPath) ?? '');

    const klausa   = parseSwitchKlausa(kontenSwitch);
    let rendered   = '';

    for (const k of klausa) {
      if (k.isDefault || String(k.nilai) === nilaiSwitch) {
        rendered = renderFn(k.konten, data);
        break;
      }
    }

    hasil =
      hasil.slice(0, idxBuka) +
      rendered +
      hasil.slice(idxTutup + '</switch>'.length);
  }

  return hasil;
}

/**
 * Mem-parse blok <when>...</when> dan <default>...</default> dari konten switch.
 *
 * @param {string} konten
 * @returns {Array<{nilai: string|null, konten: string, isDefault: boolean}>}
 */
function parseSwitchKlausa(konten) {
  const klausa = [];

  // Parse <when "nilai"> atau <when nilai>
  const WHEN_REGEX = /<when\s+(?:"([^"]*)"|([\w.-]+))\s*>([\s\S]*?)<\/when>/g;
  let m;
  while ((m = WHEN_REGEX.exec(konten)) !== null) {
    const [, strVal, pathVal, isi] = m;
    klausa.push({
      nilai:     strVal ?? pathVal ?? '',
      konten:    isi,
      isDefault: false,
    });
  }

  // Parse <default>
  const defMatch = konten.match(/<default>([\s\S]*?)<\/default>/);
  if (defMatch) {
    klausa.push({ nilai: null, konten: defMatch[1], isDefault: true });
  }

  return klausa;
}

// ─────────────────────────────────────────────────────────────
// Prosesor: With
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <with path.ke.objek>...</with>.
 * Mengubah scope sehingga properti objek yang dituju dapat diakses langsung.
 *
 * Contoh: <with user.profil> → di dalam blok, <{ nama }> mengakses user.profil.nama
 *
 * @param {string} template
 * @param {object} data
 * @param {Function} renderFn
 * @returns {string}
 */
export function prosesWith(template, data, renderFn) {
  let hasil = template;

  while (true) {
    const match = hasil.match(REGEX_WITH_BUKA);
    if (!match) break;

    const idxBuka    = hasil.indexOf(match[0]);
    const path       = match[1].trim();
    const setelahBuka = idxBuka + match[0].length;

    const idxTutup = cariPasanganTag(hasil, setelahBuka, '<with ', '</with>');
    if (idxTutup === -1) break;

    const konten     = hasil.slice(setelahBuka, idxTutup);
    const nilaiWith  = resolveNilai(data, path);

    // Spread properti objek ke dalam scope (pertahankan data parent)
    const ctxWith =
      nilaiWith && typeof nilaiWith === 'object' && !Array.isArray(nilaiWith)
        ? { ...data, ...nilaiWith }
        : data;

    hasil =
      hasil.slice(0, idxBuka) +
      renderFn(konten, ctxWith) +
      hasil.slice(idxTutup + '</with>'.length);
  }

  return hasil;
}

// ─────────────────────────────────────────────────────────────
// Prosesor: Call (macro invocation)
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <call macroName(args)> — memanggil macro yang sudah terdaftar.
 *
 * @param {string} template
 * @param {object} data     - Data konteks, termasuk data.__macros__
 * @param {Function} renderFn
 * @returns {string}
 */
export function prosesCall(template, data, renderFn) {
  return template.replace(REGEX_CALL, (_, macroName, argsStr) => {
    const macro = data.__macros__?.[macroName];
    if (!macro) {
      return `<!-- [template-engine] Macro tidak ditemukan: "${macroName}" -->`;
    }

    const args    = parseMacroCallArgs(argsStr, data);
    const macroCx = { ...data, ...args };

    return renderFn(macro.body, macroCx);
  });
}

// ─────────────────────────────────────────────────────────────
// Prosesor: Include
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <include="path/partial.html">.
 * File partial dibaca dan di-render secara rekursif.
 *
 * @param {string} template
 * @param {object} data
 * @param {string} baseDir
 * @param {Function} renderFn
 * @param {Function} bacaFile
 * @returns {string}
 */
export function prosesInclude(template, data, baseDir, renderFn, bacaFile) {
  return template.replace(REGEX_INCLUDE, (_, pathPartial, offset) => {
    const pathAbsolut = resolve(baseDir, pathPartial);

    let kontenPartial;
    try {
      kontenPartial = bacaFile(pathAbsolut);
    } catch (err) {
      if (err instanceof TemplateError) throw err;
      throw new TemplateError(
        `Gagal membaca partial "${pathPartial}" (${pathAbsolut})`,
        { file: pathAbsolut, cause: err, line: hitungBarisDariIndeks(template, offset) },
      );
    }

    return renderFn(kontenPartial, data, dirname(pathAbsolut));
  });
}

// ─────────────────────────────────────────────────────────────
// Named fill extraction (untuk sistem layout)
// ─────────────────────────────────────────────────────────────

/**
 * Ekstrak <fill name="...">konten</fill> dari konten halaman yang sudah di-render.
 * Mengembalikan:
 *   - fills: Map<string, string> berisi konten per named slot
 *   - content: string berisi konten halaman setelah fill blocks dihapus
 *
 * @param {string} rendered - HTML halaman yang sudah di-render
 * @returns {{ fills: Map<string, string>, content: string }}
 */
export function extractFills(rendered) {
  const fills = new Map();

  const REGEX_FILL = /<fill\s+name="([\w-]+)">([\s\S]*?)<\/fill>/g;
  const content    = rendered.replace(REGEX_FILL, (_, name, konten) => {
    fills.set(name, konten);
    return '';
  });

  return { fills, content };
}

/**
 * Sisipkan fill ke dalam slot-slot layout.
 * <slot name="header">konten default</slot> → diganti dengan fill["header"]
 * Jika fill tidak ada, konten default dipertahankan.
 *
 * @param {string} layout - HTML layout
 * @param {Map<string, string>} fills
 * @returns {string}
 */
export function injectFillsToSlots(layout, fills) {
  const REGEX_SLOT = /<slot\s+name="([\w-]+)">([\s\S]*?)<\/slot>/g;
  return layout.replace(REGEX_SLOT, (_, name, defaultContent) => {
    return fills.has(name) ? fills.get(name) : defaultContent;
  });
}

// ─────────────────────────────────────────────────────────────
// Helper internal — ekstraksi ekspresi kondisi (if/unless/elseif)
// ─────────────────────────────────────────────────────────────

/**
 * Scan token-aware untuk menemukan posisi `>` yang menjadi closing delimiter
 * tag pembuka kondisional (`<if `, `<unless `, `<elseif `), membedakannya dari
 * `>` yang muncul sebagai operator comparison standalone (`>`) atau bagian
 * dari `>=` di dalam ekspresi.
 *
 * @adr     `>` standalone (bukan `>=`) adalah delimiter yang BENAR-BENAR ambigu
 *          secara leksikal — `usia > 17` dan closing delimiter `<if a>` memakai
 *          karakter identik, dan operand kanan suatu comparison (`17`, `b`, dst.)
 *          tidak bisa dibedakan dari konten tag (`DEWASA`, `YA`, dst.) hanya
 *          dengan melihat BENTUK token-nya — keduanya sama-sama cocok pola
 *          identifier/number/path.
 * @context Percobaan pertama (state machine 2-state murni: MENGHARAP_OPERAND vs
 *          MENGHARAP_OPERATOR_ATAU_AKHIR) GAGAL — begitu operand kiri selesai
 *          dibaca, `>` SELALU langsung di-treat sebagai closing tanpa pernah
 *          diberi kesempatan jadi operator baru, sehingga `usia > 17` rusak
 *          (tag terpotong di tengah ekspresi). Percobaan kedua (lookahead operand
 *          kanan tanpa syarat tambahan) overcorrect — `<if a>YA</if>` ikut rusak
 *          karena `YA` (konten) salah dibaca sebagai operand kanan yang valid.
 * @decision Disambiguasi via KONVENSI PENULISAN yang konsisten di seluruh
 *          codebase/test existing: operator comparison standalone (`>`, `<`)
 *          SELALU ditulis dengan whitespace di KEDUA sisinya (`usia > 17`,
 *          `a > 5 && b > 10`), sedangkan closing delimiter TIDAK PERNAH diapit
 *          whitespace di kedua sisi sekaligus (`<if a>`, `<if a >` — sisi kanan
 *          langsung konten tanpa spasi wajib). `>`/`<` hanya diperlakukan sebagai
 *          operator jika diapit whitespace persis di KEDUA sisi; selain itu
 *          (termasuk hanya salah satu sisi) dianggap closing delimiter.
 * @tradeoff Menolak gaya penulisan `usia >17` atau `usia> 17` (whitespace
 *          asimetris) sebagai operator — keduanya akan salah ditafsir sebagai
 *          closing delimiter. Ini dianggap dapat diterima: seluruh contoh,
 *          dokumentasi, dan test suite project selalu menulis operator dengan
 *          spasi simetris; gaya asimetris bukan konvensi yang didukung/diajarkan.
 * @alternatives Mengubah sintaks delimiter tag (`<if(...)>` dsb.) menghapus
 *          ambiguitas total tapi breaking change pada sintaks publik — ditolak.
 *          Lookahead-parsing operand kanan secara struktural (bukan via
 *          whitespace) terbukti tidak bisa disambiguasi tanpa informasi tipe,
 *          karena leksikal token konten dan token operand identik.
 *
 * String literal (diawali `"` atau `'`) dilewati utuh tanpa diinterpretasi —
 * isinya (termasuk karakter `>` jika ada) tidak pernah dianggap delimiter.
 *
 * @param {string} str        - Seluruh sisa template (atau substring) yang discan
 * @param {number} posisiMulai - Posisi tepat setelah `<if `/`<unless `/`<elseif `
 * @returns {number} Posisi karakter `>` closing delimiter, atau -1 jika tidak ditemukan
 */
function cariTutupTagKondisi(str, posisiMulai) {
  const OPERATOR_DUA_KARAKTER = ['>=', '<=', '==', '!='];
  let pos = posisiMulai;
  let mengharapOperand = true;

  const adaWsSebelum = (p) => p > 0 && /\s/.test(str[p - 1]);
  const adaWsSesudah = (p) => p + 1 < str.length && /\s/.test(str[p + 1]);

  while (pos < str.length) {
    const c = str[pos];

    // Lewati whitespace — tidak mengubah state
    if (/\s/.test(c)) { pos++; continue; }

    // Lewati string literal utuh — isinya tidak pernah jadi delimiter
    if (c === '"' || c === "'") {
      const quote = c;
      pos++;
      while (pos < str.length && str[pos] !== quote) {
        if (str[pos] === '\\') pos++; // escape — lewati 1 karakter tambahan
        pos++;
      }
      pos++; // lewati quote penutup
      mengharapOperand = false; // string literal adalah operand lengkap
      continue;
    }

    // '&&' / '||' — selalu operator logika, mereset batas comparison
    const dua = str.slice(pos, pos + 2);
    if (dua === '&&' || dua === '||') {
      pos += 2;
      mengharapOperand = true;
      continue;
    }

    // '>=' / '<=' / '==' / '!=' — operator dua-karakter, tidak ambigu dengan
    // closing delimiter (closing selalu `>` TUNGGAL).
    if (OPERATOR_DUA_KARAKTER.includes(dua)) {
      pos += 2;
      mengharapOperand = true;
      continue;
    }

    // '>' / '<' satu-karakter saat MENGHARAP_OPERAND (mis. tepat setelah '&&')
    // — tidak valid sebagai awal operand, lewati defensif (template seharusnya
    // tidak menulis ini; mencegah infinite loop pada template tidak valid).
    if ((c === '>' || c === '<') && mengharapOperand) {
      pos++;
      continue;
    }

    // '>' satu-karakter, operand kiri sudah lengkap — AMBIGU antara operator
    // comparison standalone vs closing delimiter. Disambiguasi via whitespace
    // simetris (lihat @decision di atas).
    if (c === '>' && !mengharapOperand) {
      if (adaWsSebelum(pos) && adaWsSesudah(pos)) {
        pos++; // operator comparison '>' standalone
        mengharapOperand = true;
        continue;
      }
      return pos; // closing delimiter tag
    }

    // '<' satu-karakter, operand kiri sudah lengkap — operator comparison
    // standalone (closing delimiter if/unless/elseif selalu '>', tidak pernah
    // '<', sehingga '<' di state ini tidak ambigu — selalu operator).
    if (c === '<' && !mengharapOperand) {
      pos++;
      mengharapOperand = true;
      continue;
    }

    if (c === '!' && mengharapOperand) {
      pos++; // negasi unary — tetap MENGHARAP_OPERAND untuk operand setelahnya
      continue;
    }

    // Grouping
    if (c === '(') { pos++; mengharapOperand = true; continue; }
    if (c === ')') { pos++; mengharapOperand = false; continue; }

    // Operand: identifier/path (huruf, angka, ., $, _, [, ]) atau angka negatif (-3.5)
    if (/[\w.$[\]-]/.test(c)) {
      while (pos < str.length && /[\w.$[\]-]/.test(str[pos])) pos++;
      mengharapOperand = false;
      continue;
    }

    // Karakter tak dikenal — lewati agar tidak infinite loop
    pos++;
  }

  return -1; // tidak ditemukan closing delimiter — tag tidak tertutup
}

/**
 * Cari kemunculan PERTAMA tag pembuka kondisional (`<if `, `<unless `, `<elseif `)
 * di mana saja dalam string, lalu ekstrak ekspresi kondisinya via scanner
 * quote/operator-aware (cariTutupTagKondisi) — bukan regex character-class.
 *
 * Setara dengan `str.match(REGEX_LAMA)` versi lama, tapi closing delimiter `>`
 * ditentukan secara token-aware sehingga operator `>`/`>=` di dalam ekspresi
 * tidak pernah disalahartikan sebagai akhir tag.
 *
 * @param {string} str      - String yang dicari (boleh seluruh template)
 * @param {RegExp} prefixRe - Regex prefix nama tag TANPA closing delimiter,
 *                            mis. /<if\s+/ — boleh ber-flag 'g' untuk pencarian non-anchored.
 * @returns {{ idxBuka: number, match0: string, ekspresi: string } | null}
 */
function cariTagKondisiPertama(str, prefixRe) {
  // @adr     prefixRe (mis. /^<if\s+/) dibawa dengan anchor '^' karena dipakai
  //          JUGA secara anchored oleh cocokkanTagKondisiAnchored di bawah.
  // @context new RegExp(prefixRe.source) TIDAK menghapus anchor — `.source` dari
  //          /^<if\s+/ adalah string literal "^<if\\s+", anchor '^' ikut tercopy
  //          apa adanya. Akibatnya `sisa.match(re)` hanya berhasil ketika '<if '
  //          tepat di posisi 0 dari substring `sisa` — begitu cursor melewati
  //          kemunculan PERTAMA tanpa match (mis. tag nested di tengah string),
  //          pencarian gagal total dan fungsi ini salah mengembalikan null,
  //          walau '<if ' sebenarnya masih ada lebih jauh di dalam string.
  // @decision Strip '^' secara eksplisit dari source sebelum membentuk regex
  //          pencarian non-anchored — search global per posisi via .search()
  //          (bukan flag 'g' biasa, karena prefixRe bisa mengandung grup yang
  //          ingin tetap diakses via matchPrefix.index secara konsisten).
  const sourceTanpaAnchor = prefixRe.source.replace(/^\^/, '');
  const re = new RegExp(sourceTanpaAnchor);
  let cursor = 0;

  while (cursor <= str.length) {
    const sisa = str.slice(cursor);
    const matchPrefix = sisa.match(re);
    if (!matchPrefix) return null;

    const idxBuka          = cursor + matchPrefix.index;
    const posisiSetelahNama = idxBuka + matchPrefix[0].length;
    const idxTutup          = cariTutupTagKondisi(str, posisiSetelahNama);

    if (idxTutup !== -1) {
      return {
        idxBuka,
        match0:   str.slice(idxBuka, idxTutup + 1),
        ekspresi: str.slice(posisiSetelahNama, idxTutup),
      };
    }

    // Tag tidak punya closing delimiter yang valid (mis. tag rusak/tidak tertutup)
    // — lanjutkan cari kemunculan prefix berikutnya agar tidak infinite loop.
    cursor = idxBuka + matchPrefix[0].length;
  }

  return null;
}

/**
 * Varian anchored (harus mulai TEPAT di awal string) — pengganti perilaku
 * `^<elseif\s+...>` lama. Dipakai oleh cariKlausaIf yang men-tes `sisa.match(REGEX_ELSEIF)`
 * pada tiap posisi cursor.
 *
 * @param {string} str
 * @param {RegExp} prefixRe - mis. /^<elseif\s+/
 * @returns {{ match0: string, ekspresi: string } | null}
 */
function cocokkanTagKondisiAnchored(str, prefixRe) {
  const matchPrefix = str.match(prefixRe);
  if (!matchPrefix || matchPrefix.index !== 0) return null;

  const posisiSetelahNama = matchPrefix[0].length;
  const idxTutup = cariTutupTagKondisi(str, posisiSetelahNama);
  if (idxTutup === -1) return null;

  return {
    match0:   str.slice(0, idxTutup + 1),
    ekspresi: str.slice(posisiSetelahNama, idxTutup),
  };
}

/**
 * Fungsi generik untuk mencari closing tag berpasangan dengan depth tracking.
 * Mendukung semua konstruksi yang memiliki pasangan open/close tag.
 *
 * @param {string} template   - Template yang dicari
 * @param {number} setelahBuka - Posisi setelah tag pembuka
 * @param {string} openTag    - Prefix tag pembuka (dengan spasi, misal '<each ')
 * @param {string} closeTag   - Tag penutup (misal '</each>')
 * @returns {number} - Posisi closing tag, atau -1 jika tidak ditemukan
 */
function cariPasanganTag(template, setelahBuka, openTag, closeTag) {
  let kedalaman = 1;
  let pos       = setelahBuka;

  while (pos < template.length) {
    const idxTutup = template.indexOf(closeTag, pos);
    const idxBuka  = template.indexOf(openTag,  pos);

    if (idxTutup === -1) return -1;

    if (idxBuka !== -1 && idxBuka < idxTutup) {
      kedalaman++;
      pos = idxBuka + openTag.length;
    } else {
      kedalaman--;
      if (kedalaman === 0) return idxTutup;
      pos = idxTutup + closeTag.length;
    }
  }

  return -1;
}

/**
 * Memecah konten <if>...</if> menjadi klausa-klausa:
 *   [ {kondisi: 'ekspresi', konten: '...'}, ... , {kondisi: null, konten: '...'} ]
 * kondisi null = klausa <else>.
 *
 * @param {string} ekspresiAwal - Kondisi dari tag <if> pembuka
 * @param {string} kontenBlok   - Isi antara <if> dan </if>
 * @returns {Array<{kondisi: string|null, konten: string}>}
 */
function cariKlausaIf(ekspresiAwal, kontenBlok) {
  const klausa       = [];
  let kondisiSaatIni = ekspresiAwal;
  let posisiMulai    = 0;
  let kedalaman      = 0;
  let posisi         = 0;

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

    if (kedalaman === 0) {
      const sisa = kontenBlok.slice(posisi);

      const matchElseif = cocokkanTagKondisiAnchored(sisa, REGEX_ELSEIF_NAMA);
      if (matchElseif) {
        klausa.push({ kondisi: kondisiSaatIni, konten: kontenBlok.slice(posisiMulai, posisi) });
        kondisiSaatIni = matchElseif.ekspresi.trim();
        posisiMulai    = posisi + matchElseif.match0.length;
        posisi         = posisiMulai;
        continue;
      }

      if (sisa.startsWith('<else>')) {
        klausa.push({ kondisi: kondisiSaatIni, konten: kontenBlok.slice(posisiMulai, posisi) });
        kondisiSaatIni = null;
        posisiMulai    = posisi + 6;
        posisi         = posisiMulai;
        continue;
      }
    }

    posisi++;
  }

  klausa.push({ kondisi: kondisiSaatIni, konten: kontenBlok.slice(posisiMulai) });
  return klausa;
}

/**
 * Cari posisi <else> di level teratas blok (tidak di dalam <if> atau <unless> bersarang).
 * Digunakan oleh prosesUnless untuk menemukan klausa <else> miliknya sendiri.
 *
 * @param {string} kontenBlok
 * @returns {number} Posisi <else>, atau -1 jika tidak ada.
 */
function cariElseTopLevel(kontenBlok) {
  let kedalaman = 0;
  let posisi    = 0;

  while (posisi < kontenBlok.length) {
    if (kontenBlok.startsWith('<if ', posisi)) {
      kedalaman++;
      posisi += 4;
      continue;
    }
    if (kontenBlok.startsWith('<unless ', posisi)) {
      kedalaman++;
      posisi += 8;
      continue;
    }
    if (kontenBlok.startsWith('</if>', posisi)) {
      kedalaman = Math.max(0, kedalaman - 1);
      posisi += 5;
      continue;
    }
    if (kontenBlok.startsWith('</unless>', posisi)) {
      kedalaman = Math.max(0, kedalaman - 1);
      posisi += 9;
      continue;
    }
    if (kedalaman === 0 && kontenBlok.startsWith('<else>', posisi)) {
      return posisi;
    }
    posisi++;
  }
  return -1;
}
