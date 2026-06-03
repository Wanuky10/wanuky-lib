import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { prosesInterpolasi, prosesEach, prosesIf, prosesInclude } from './parser.js';

const BATAS_KEDALAMAN_INCLUDE = 20;

export function bacaFileDefault(pathAbsolut) {
  return readFileSync(pathAbsolut, 'utf-8');
}

export function renderTemplate(template, data, baseDir, opsi = {}) {
  const { bacaFile = bacaFileDefault, kedalaman = 0 } = opsi;

  if (kedalaman > BATAS_KEDALAMAN_INCLUDE) {
    throw new Error(
      `[template-engine] Batas kedalaman include terlampaui ` +
      `(maksimum: ${BATAS_KEDALAMAN_INCLUDE} level). ` +
      `Periksa kemungkinan circular include di ${baseDir}.`,
    );
  }

  const renderRekursif = (tpl, ctx, dir = baseDir) =>
    renderTemplate(tpl, ctx, dir, { bacaFile, kedalaman: kedalaman + 1 });

  let hasil = template;
  hasil = prosesEach(hasil, data, renderRekursif);
  hasil = prosesIf(hasil, data, renderRekursif);
  hasil = prosesInclude(hasil, data, baseDir, renderRekursif, bacaFile);
  hasil = prosesInterpolasi(hasil, data);
  return hasil;
}

export function renderHalaman(pathView, data, namaLayout, dirLayouts, bacaFile = bacaFileDefault) {
  let kontenView;
  try {
    kontenView = bacaFile(pathView);
  } catch (err) {
    throw new Error(`[template-engine] Gagal membaca view "${pathView}": ${err.message}`);
  }

  const baseDirView = dirname(pathView);
  const kontenViewRendered = renderTemplate(kontenView, data, baseDirView, { bacaFile });

  if (!namaLayout) return kontenViewRendered;

  const pathLayout = resolve(dirLayouts, `${namaLayout}.html`);
  let kontenLayout;
  try {
    kontenLayout = bacaFile(pathLayout);
  } catch (err) {
    throw new Error(
      `[template-engine] Gagal membaca layout "${namaLayout}" (${pathLayout}): ${err.message}`,
    );
  }

  const SLOT = '<contents></contents>';
  if (!kontenLayout.includes(SLOT)) {
    throw new Error(
      `[template-engine] Layout "${namaLayout}" tidak mengandung slot ` +
      `<contents></contents>. Tambahkan slot ini di dalam layout.`,
    );
  }

  // Fungsi replacer mencegah karakter '$' di kontenViewRendered
  // diinterpretasikan sebagai replacement pattern (bug v1.0.0)
  const layoutDenganKonten = kontenLayout.replace(SLOT, () => kontenViewRendered);

  const baseDirLayout = dirname(pathLayout);
  return renderTemplate(layoutDenganKonten, data, baseDirLayout, { bacaFile });
}
