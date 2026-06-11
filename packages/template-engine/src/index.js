/**
 * Template Engine v2.0.0 — Entry Point
 *
 * Perubahan utama dari v1.1.0:
 *   - Filter/pipe system: <{ variabel | filter: arg }>
 *   - Ekspresi boolean: &&, ||, !, (), ==, !=, >, <, >=, <=
 *   - Konstruksi baru: <unless>, <switch>/<when>, <with>, <macro>/<call>, <set>, <raw>
 *   - Named slots: <slot name="..."> di layout, <fill name="..."> di view
 *   - Hot-reload: invalidasi cache otomatis via fs.watch (mode development)
 *   - Bracket notation: items[0], items[1].nama
 */

import { resolve, dirname } from 'path';
import { readFileSync, watch as fsWatch } from 'fs';
import { renderHalaman, renderTemplate, bacaFileDefault } from './renderer.js';

export const versi = '2.0.0';

// ─────────────────────────────────────────────────────────────
// buatEngine — factory engine utama
// ─────────────────────────────────────────────────────────────

/**
 * Membuat instance engine template yang terkonfigurasi.
 *
 * @param {object}  config
 * @param {string}  config.dirViews      - Direktori root file view
 * @param {string}  config.dirLayouts    - Direktori layout
 * @param {boolean} [config.cache=true]  - Aktifkan in-memory cache (nonaktifkan di dev)
 * @param {boolean} [config.hotReload=false] - Aktifkan invalidasi cache otomatis via fs.watch
 *                                             Hanya efektif jika cache juga aktif.
 *
 * @returns {{
 *   render(pathView, data, namaLayout): string,
 *   renderString(template, data, baseDir): string,
 *   kosongkanCache(): void,
 *   invalidasiCache(path): void,
 *   get ukuranCache(): number,
 *   matikanHotReload(): void,
 * }}
 */
export function buatEngine(config) {
  const {
    dirViews,
    dirLayouts,
    cache:     aktifkanCache  = true,
    hotReload: aktifkanHotReload = false,
  } = config;

  if (!dirViews || !dirLayouts) {
    throw new Error(
      '[template-engine] Konfigurasi tidak lengkap: dirViews dan dirLayouts wajib diisi.',
    );
  }

  const _cache = new Map();

  // ── Fungsi baca file dengan optional cache ─────────────────
  const bacaFile = (pathAbsolut) => {
    if (aktifkanCache && _cache.has(pathAbsolut)) return _cache.get(pathAbsolut);
    const konten = readFileSync(pathAbsolut, 'utf-8');
    if (aktifkanCache) _cache.set(pathAbsolut, konten);
    return konten;
  };

  // ── Hot-reload via fs.watch ────────────────────────────────
  /**
   * @adr     Menggunakan fs.watch dengan event-deduplification 50ms debounce
   * @context fs.watch pada beberapa OS (Windows, Linux inotify) mengirimkan
   *          dua event 'change' berturutan untuk satu save. Tanpa debounce,
   *          cache di-invalidasi dua kali dan ada risiko race condition baca file.
   * @decision Debounce 50ms per path — invalidasi hanya satu kali per save cycle
   * @tradeoff File yang diubah lebih cepat dari 50ms bisa terlewat (sangat jarang terjadi)
   * @alternatives Polling (ditolak: CPU overhead tinggi), chokidar (ditolak: dependensi eksternal)
   */
  const _watcherTimers = new Map();
  const _watchers      = [];

  if (aktifkanCache && aktifkanHotReload) {
    const dirList = [dirViews, dirLayouts];

    for (const dir of dirList) {
      try {
        const watcher = fsWatch(dir, { recursive: true }, (event, filename) => {
          if (!filename) return;
          const pathAbsolut = resolve(dir, filename);

          // Debounce 50ms: batalkan timer sebelumnya jika masih pending
          if (_watcherTimers.has(pathAbsolut)) {
            clearTimeout(_watcherTimers.get(pathAbsolut));
          }
          const timer = setTimeout(() => {
            _cache.delete(pathAbsolut);
            _watcherTimers.delete(pathAbsolut);
          }, 50);

          _watcherTimers.set(pathAbsolut, timer);
        });

        _watchers.push(watcher);
      } catch {
        // fs.watch gagal di beberapa environment (container tanpa inotify) —
        // hot-reload dinonaktifkan secara diam-diam, cache tetap berjalan.
      }
    }
  }

  // ── API publik engine ──────────────────────────────────────
  return {
    /**
     * Merender file view dengan layout opsional.
     *
     * @param {string}      pathView   - Path relatif dari dirViews
     * @param {object}      [data={}]
     * @param {string|null} [namaLayout=null] - Nama layout (tanpa .html)
     * @returns {string}
     */
    render(pathView, data = {}, namaLayout = null) {
      const pathAbsolut = resolve(dirViews, pathView);
      return renderHalaman(pathAbsolut, data, namaLayout, dirLayouts, bacaFile);
    },

    /**
     * Merender string template langsung tanpa membaca file.
     * Berguna untuk render snippet/cuplikan atau testing.
     *
     * @param {string} template
     * @param {object} [data={}]
     * @param {string} [baseDir=dirViews] - Basis direktori untuk resolve include path
     * @returns {string}
     */
    renderString(template, data = {}, baseDir = dirViews) {
      return renderTemplate(template, data, baseDir, { bacaFile });
    },

    /**
     * Mengosongkan seluruh in-memory cache.
     * Berguna setelah deployment atau perubahan massal.
     */
    kosongkanCache() {
      _cache.clear();
    },

    /**
     * Menginvalidasi satu file dari cache berdasarkan path absolut.
     * File tersebut akan dibaca ulang pada request berikutnya.
     *
     * @param {string} pathAbsolut
     */
    invalidasiCache(pathAbsolut) {
      _cache.delete(resolve(pathAbsolut));
    },

    /** Jumlah entry yang saat ini ada di cache. */
    get ukuranCache() {
      return _cache.size;
    },

    /**
     * Menutup semua fs.watch watcher yang aktif.
     * Panggil saat server shutdown untuk mencegah handle leak.
     */
    matikanHotReload() {
      for (const timer of _watcherTimers.values()) clearTimeout(timer);
      _watcherTimers.clear();
      for (const watcher of _watchers) {
        try { watcher.close(); } catch { /* abaikan error close */ }
      }
      _watchers.length = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Re-export utilitas publik
// ─────────────────────────────────────────────────────────────

// Renderer
export { renderHalaman, renderTemplate, bacaFileDefault } from './renderer.js';

// Escaping
export { escapeHtml, rawHtml } from './utils/escaper.js';

// Resolver path (bracket + dot notation)
export { resolveNilai } from './utils/resolver.js';

// Expression evaluator — evaluasiKondisi diekspor sebagai alias backward-compat
export {
  evaluasiEkspresi,
  evaluasiKondisi,
} from './utils/expression.js';

// Filter system — berguna jika consumer ingin extend atau test filter secara langsung
export {
  applyFilters,
  parseFilterExpression,
  FILTER_LIBRARY,
} from './utils/filter.js';
