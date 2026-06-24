/**
 * Template Engine v2.2.0 — Entry Point
 */

export const versi = '2.2.0';

// Public API
export { buatEngine }    from './engine.js';
export { TemplateError } from './errors.js';

// Internal utils — re-exported untuk consumer yang butuh akses langsung
export { renderHalaman, renderTemplate, bacaFileDefault } from './renderer.js';
export { escapeHtml, rawHtml }                           from './utils/escaper.js';
export { resolveNilai }                                  from './utils/resolver.js';
export { evaluasiEkspresi, evaluasiKondisi }             from './utils/expression.js';
export { applyFilters, parseFilterExpression, FILTER_LIBRARY } from './utils/filter.js';
