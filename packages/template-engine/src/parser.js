/**
 * Parser template v2.0.0
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

// If/Unless
const REGEX_IF_BUKA     = /<if\s+((?:[^>]|>=)+)>/;
const REGEX_UNLESS_BUKA = /<unless\s+((?:[^>]|>=)+)>/;
const REGEX_ELSEIF      = /^<elseif\s+((?:[^>]|>=)+)>/;

// Switch
const REGEX_SWITCH_BUKA = /<switch\s+([\w.[\]]+)\s*>/;

// Set: <set varName = "literal"> atau <set varName = path>
const REGEX_SET = /<set\s+([\w]+)\s*=\s*(?:"([^"]*)"|([\w.[\]]+(?:\s*[+\-]\s*[\w.[\]]+)*))\s*>/g;

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
// Prosesor: Set
// ─────────────────────────────────────────────────────────────

/**
 * Memproses <set varName = nilai> — variabel lokal template.
 * Tag <set> dihapus dari output; nilai ditambahkan ke salinan context baru.
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
  const result  = template.replace(REGEX_SET, (_, varName, strVal, pathVal) => {
    newData[varName] = strVal !== undefined
      ? strVal
      : resolveNilai(newData, pathVal);
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
    const match = hasil.match(REGEX_IF_BUKA);
    if (!match) break;

    const idxBuka     = hasil.indexOf(match[0]);
    const ekspresiAwal = match[1].trim();
    const setelahBuka  = idxBuka + match[0].length;

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
    const match = hasil.match(REGEX_UNLESS_BUKA);
    if (!match) break;

    const idxBuka     = hasil.indexOf(match[0]);
    const ekspresi    = match[1].trim();
    const setelahBuka = idxBuka + match[0].length;

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
  return template.replace(REGEX_INCLUDE, (_, pathPartial) => {
    const pathAbsolut = resolve(baseDir, pathPartial);

    let kontenPartial;
    try {
      kontenPartial = bacaFile(pathAbsolut);
    } catch (err) {
      if (err instanceof TemplateError) throw err;
      throw new TemplateError(
        `Gagal membaca partial "${pathPartial}" (${pathAbsolut})`,
        { file: pathAbsolut, cause: err },
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
// Helper internal — depth tracking
// ─────────────────────────────────────────────────────────────

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

      const matchElseif = sisa.match(REGEX_ELSEIF);
      if (matchElseif) {
        klausa.push({ kondisi: kondisiSaatIni, konten: kontenBlok.slice(posisiMulai, posisi) });
        kondisiSaatIni = matchElseif[1].trim();
        posisiMulai    = posisi + matchElseif[0].length;
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
