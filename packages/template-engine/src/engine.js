import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { LRUCache } from './lru-cache.js';
import { renderHalaman, renderTemplate } from './renderer.js';
import { TemplateError } from './errors.js';

/**
 * @typedef {Object} EngineOptions
 * @property {string}  dirViews              - Path absolut ke direktori views. WAJIB.
 * @property {string}  dirLayouts            - Path absolut ke direktori layouts. WAJIB.
 * @property {boolean} [cache=true]          - Aktifkan file cache.
 * @property {number}  [cacheMaxSize=200]    - Maks entri cache sebelum LRU evict.
 * @property {boolean} [debug=false]         - Log detail render ke stderr.
 * @property {number}  [maxIncludeDepth=20]  - Kedalaman include maksimum (cegah circular).
 */

/**
 * Factory — buat instance engine template.
 *
 * @param {EngineOptions} options
 * @returns {EngineInstance}
 */
export function buatEngine(options = {}) {
  if (!options.dirViews)   throw new TypeError('buatEngine: dirViews wajib diisi');
  if (!options.dirLayouts) throw new TypeError('buatEngine: dirLayouts wajib diisi');

  const config = {
    dirViews:        resolve(options.dirViews),
    dirLayouts:      resolve(options.dirLayouts),
    cache:           options.cache ?? true,
    cacheMaxSize:    options.cacheMaxSize ?? 200,
    debug:           options.debug ?? false,
    maxIncludeDepth: options.maxIncludeDepth ?? 20,
  };

  const fileCache = new LRUCache(config.cacheMaxSize);

  function bacaFile(absolutePath) {
    if (config.cache) {
      const cached = fileCache.get(absolutePath);
      if (cached !== undefined) return cached;
    }
    try {
      const isi = readFileSync(absolutePath, 'utf8');
      if (config.cache) fileCache.set(absolutePath, isi);
      return isi;
    } catch (err) {
      throw new TemplateError(`File tidak ditemukan: ${absolutePath}`, {
        file: absolutePath,
        cause: err,
      });
    }
  }

  /**
   * Render view dengan data dan layout opsional.
   *
   * @param {string} namaView  - Path relatif dari dirViews
   * @param {Record<string, unknown>} [data={}]
   * @param {string|null} [layout=null] - Nama layout (tanpa .html)
   * @returns {string}
   * @throws {TemplateError}
   */
  function rendang(namaView, data = {}, layout = null) {
    if (config.debug) process.stderr.write(`[template-engine] render: ${namaView}\n`);
    const pathAbsolut = join(config.dirViews, namaView);
    return renderHalaman(pathAbsolut, data, layout, config.dirLayouts, bacaFile);
  }

  /**
   * Render string template langsung tanpa baca file.
   *
   * @param {string} template
   * @param {Record<string, unknown>} [data={}]
   * @returns {string}
   */
  function renderString(template, data = {}) {
    return renderTemplate(template, data, config.dirViews, { bacaFile });
  }

  /**
   * Render async — data bisa berupa Promise.
   *
   * @param {string} namaView
   * @param {Record<string, unknown> | Promise<Record<string, unknown>>} [data={}]
   * @param {string|null} [layout=null]
   * @returns {Promise<string>}
   */
  async function renderAsync(namaView, data = {}, layout = null) {
    const dataResolved = await data;
    return rendang(namaView, dataResolved, layout);
  }

  return {
    // ── Render Methods ──────────────────────────────────────────
    render: rendang,
    renderString,
    renderAsync,

    // ── Cache Management ────────────────────────────────────────
    kosongkanCache() { fileCache.clear(); },

    hapusCache(namaView) {
      const absolute = join(config.dirViews, namaView);
      fileCache.delete(absolute);
    },

    get infoCache() {
      return { jumlah: fileCache.size, max: fileCache.maxSize };
    },
  };
}
