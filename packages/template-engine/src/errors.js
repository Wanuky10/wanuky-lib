/**
 * @typedef {Object} TemplateErrorOptions
 * @property {string}   [file]              - Path absolut file template yang error.
 * @property {number}   [line]              - Nomor baris (1-based) lokasi error.
 * @property {string[]} [variabelTersedia]  - Daftar key yang tersedia di data context.
 * @property {Error}    [cause]             - Error original (untuk error chaining).
 */

export class TemplateError extends Error {
  /** @type {string | undefined} */   file;
  /** @type {number | undefined} */   line;
  /** @type {string[] | undefined} */ variabelTersedia;

  /**
   * @param {string} message
   * @param {TemplateErrorOptions} [options={}]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'TemplateError';
    this.file = options.file;
    this.line = options.line;
    this.variabelTersedia = options.variabelTersedia;
  }

  toString() {
    const parts = [`TemplateError: ${this.message}`];
    if (this.file) {
      parts.push(`  di: ${this.file}${this.line ? ` (baris ${this.line})` : ''}`);
    }
    if (this.variabelTersedia?.length) {
      parts.push(`  data tersedia: [${this.variabelTersedia.map(v => `'${v}'`).join(', ')}]`);
    }
    return parts.join('\n');
  }
}
