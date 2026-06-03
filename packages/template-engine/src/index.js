import { resolve } from 'path';
import { readFileSync } from 'fs';
import { renderHalaman, renderTemplate } from './renderer.js';

export const versi = '1.1.0';

export function buatEngine(config) {
  const { dirViews, dirLayouts, cache: aktifkanCache = true } = config;

  if (!dirViews || !dirLayouts) {
    throw new Error(
      '[template-engine] Konfigurasi tidak lengkap: dirViews dan dirLayouts wajib diisi.',
    );
  }

  const _cache = new Map();

  const bacaFile = (pathAbsolut) => {
    if (aktifkanCache && _cache.has(pathAbsolut)) return _cache.get(pathAbsolut);
    const konten = readFileSync(pathAbsolut, 'utf-8');
    if (aktifkanCache) _cache.set(pathAbsolut, konten);
    return konten;
  };

  return {
    render(pathView, data = {}, namaLayout = null) {
      const pathAbsolut = resolve(dirViews, pathView);
      return renderHalaman(pathAbsolut, data, namaLayout, dirLayouts, bacaFile);
    },

    renderString(template, data = {}, baseDir = dirViews) {
      return renderTemplate(template, data, baseDir, { bacaFile });
    },

    kosongkanCache() {
      _cache.clear();
    },

    get ukuranCache() {
      return _cache.size;
    },
  };
}

export { renderHalaman, renderTemplate, bacaFileDefault } from './renderer.js';
export { escapeHtml, rawHtml } from './utils/escaper.js';
export { resolveNilai, evaluasiKondisi } from './utils/resolver.js';
