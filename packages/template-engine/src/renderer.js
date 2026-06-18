/**
 * Renderer v2.0.0
 *
 * Pipeline rendering per panggilan renderTemplate:
 *   1. Proteksi blok <raw>
 *   2. Ekstrak definisi <macro>
 *   3. Proses <set> (variabel lokal)
 *   4. Proses <each> (loop)
 *   5. Proses <if> / <unless> (kondisional)
 *   6. Proses <switch> (multi-case)
 *   7. Proses <with> (scope aliasing)
 *   8. Proses <call> (macro invocation)
 *   9. Proses <include> (partial)
 *  10. Proses interpolasi <{ expr | filter }>
 *  11. Pulihkan blok <raw>
 *
 * renderHalaman menangani layout dengan named slots:
 *   - Render view → ekstrak <fill name="..."> blocks
 *   - Inject fill ke <slot name="..."> di layout
 *   - Render layout + data
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { TemplateError } from './errors.js';
import {
  protectRawBlocks,
  restoreRawBlocks,
  extractMacros,
  prosesSet,
  prosesEach,
  prosesIf,
  prosesUnless,
  prosesSwitch,
  prosesWith,
  prosesCall,
  prosesInclude,
  prosesInterpolasi,
  extractFills,
  injectFillsToSlots,
} from './parser.js';

/** Batas kedalaman include — cegah circular include */
const BATAS_KEDALAMAN_INCLUDE = 20;

/** Slot konten utama yang kompatibel dengan v1.x */
const SLOT_KONTEN = '<contents></contents>';

// ─────────────────────────────────────────────────────────────
// Fungsi bacaFile default
// ─────────────────────────────────────────────────────────────

export function bacaFileDefault(pathAbsolut) {
  return readFileSync(pathAbsolut, 'utf-8');
}

// ─────────────────────────────────────────────────────────────
// renderTemplate — inti rendering
// ─────────────────────────────────────────────────────────────

/**
 * Merender template string dengan data yang diberikan.
 * Dipanggil secara rekursif untuk loop body, conditional block, dll.
 *
 * @param {string}   template  - String template
 * @param {object}   data      - Konteks data
 * @param {string}   baseDir   - Direktori basis untuk resolve include path
 * @param {object}   [opsi]
 * @param {Function} [opsi.bacaFile]  - Fungsi baca file (default: readFileSync)
 * @param {number}   [opsi.kedalaman] - Level kedalaman rekursi saat ini
 * @returns {string}
 */
export function renderTemplate(template, data, baseDir, opsi = {}) {
  const { bacaFile = bacaFileDefault, kedalaman = 0 } = opsi;

  if (kedalaman > BATAS_KEDALAMAN_INCLUDE) {
    throw new TemplateError(
      `Batas kedalaman include terlampaui (maksimum: ${BATAS_KEDALAMAN_INCLUDE} level). ` +
      `Periksa kemungkinan circular include di ${baseDir}.`,
    );
  }

  // Fungsi render rekursif yang diteruskan ke semua prosesor
  const renderRekursif = (tpl, ctx, dir = baseDir) =>
    renderTemplate(tpl, ctx, dir, { bacaFile, kedalaman: kedalaman + 1 });

  // ── 1. Proteksi blok <raw> ─────────────────────────────────
  const { template: tplBersih, rawBlocks } = protectRawBlocks(template);

  // ── 2. Ekstrak definisi <macro> ────────────────────────────
  const { template: tplTanpaMacro, macros: macrosBaru } = extractMacros(tplBersih);
  const dataWithMacros = {
    ...data,
    __macros__: { ...(data.__macros__ ?? {}), ...macrosBaru },
  };

  // ── 3. Proses <set> ────────────────────────────────────────
  const { template: tplSetBersih, data: dataLokal } = prosesSet(tplTanpaMacro, dataWithMacros);

  // ── 4–9. Proses blok konstruksi ───────────────────────────
  let hasil = tplSetBersih;
  hasil = prosesEach(hasil,   dataLokal, renderRekursif);
  hasil = prosesIf(hasil,     dataLokal, renderRekursif);
  hasil = prosesUnless(hasil, dataLokal, renderRekursif);
  hasil = prosesSwitch(hasil, dataLokal, renderRekursif);
  hasil = prosesWith(hasil,   dataLokal, renderRekursif);
  hasil = prosesCall(hasil,   dataLokal, renderRekursif);
  hasil = prosesInclude(hasil, dataLokal, baseDir, renderRekursif, bacaFile);

  // ── 10. Proses interpolasi ─────────────────────────────────
  hasil = prosesInterpolasi(hasil, dataLokal);

  // ── 11. Pulihkan blok <raw> ────────────────────────────────
  hasil = restoreRawBlocks(hasil, rawBlocks);

  return hasil;
}

// ─────────────────────────────────────────────────────────────
// renderHalaman — render view + layout
// ─────────────────────────────────────────────────────────────

/**
 * Merender halaman lengkap: view + layout opsional + named slots.
 *
 * Alur:
 *   1. Baca dan render file view
 *   2. Ekstrak <fill name="..."> blocks dari hasil render
 *   3. Sisa konten (tanpa fill) menjadi isi <contents>
 *   4. Baca layout, inject fill ke <slot name="...">, ganti <contents>
 *   5. Render layout final dengan data
 *
 * @param {string}   pathView     - Path absolut file view
 * @param {object}   data         - Konteks data
 * @param {string}   namaLayout   - Nama layout (tanpa .html), atau null
 * @param {string}   dirLayouts   - Direktori layout
 * @param {Function} bacaFile     - Fungsi baca file
 * @returns {string}
 */
export function renderHalaman(pathView, data, namaLayout, dirLayouts, bacaFile = bacaFileDefault) {
  let kontenView;
  try {
    kontenView = bacaFile(pathView);
  } catch (err) {
    if (err instanceof TemplateError) throw err;
    throw new TemplateError(`Gagal membaca view "${pathView}"`, { file: pathView, cause: err });
  }

  const baseDirView      = dirname(pathView);
  const kontenViewRender = renderTemplate(kontenView, data, baseDirView, { bacaFile });

  if (!namaLayout) return kontenViewRender;

  // ── Ekstrak named fills dari view yang sudah di-render ──────
  const { fills, content: kontenUtama } = extractFills(kontenViewRender);

  // ── Baca layout ─────────────────────────────────────────────
  const pathLayout = resolve(dirLayouts, `${namaLayout}.html`);
  let kontenLayout;
  try {
    kontenLayout = bacaFile(pathLayout);
  } catch (err) {
    if (err instanceof TemplateError) throw err;
    throw new TemplateError(
      `Gagal membaca layout "${namaLayout}" (${pathLayout})`,
      { file: pathLayout, cause: err },
    );
  }

  // ── Pastikan slot <contents> ada ────────────────────────────
  if (!kontenLayout.includes(SLOT_KONTEN)) {
    throw new TemplateError(
      `Layout "${namaLayout}" tidak mengandung slot <contents></contents>. ` +
      `Tambahkan slot ini di dalam layout.`,
    );
  }

  // ── Inject named fills ke <slot> di layout ──────────────────
  let layoutDenganSlots = injectFillsToSlots(kontenLayout, fills);

  // ── Ganti <contents> dengan konten halaman ──────────────────
  // Gunakan fungsi replacer untuk mencegah karakter '$' salah diinterpretasi
  const layoutFinal = layoutDenganSlots.replace(SLOT_KONTEN, () => kontenUtama);

  // ── Render layout dengan data ────────────────────────────────
  const baseDirLayout = dirname(pathLayout);
  return renderTemplate(layoutFinal, data, baseDirLayout, { bacaFile });
}
