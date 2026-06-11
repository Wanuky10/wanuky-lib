/**
 * Expression evaluator untuk kondisional template.
 *
 * Mendukung:
 *   - Operator logika  : &&, ||, !
 *   - Grouping         : (expr && expr)
 *   - Perbandingan     : ==, !=, >, <, >=, <=
 *   - Literal string   : "nilai" atau 'nilai'
 *   - Literal number   : 42, 3.14
 *   - Literal boolean  : true, false
 *   - Literal null     : null
 *   - Path dot-notation: user.nama, item.status
 *   - Bracket notation : items[0], items[1].nama
 *
 * TIDAK menggunakan eval() — menggunakan recursive descent parser
 * yang aman dari code injection.
 *
 * Contoh ekspresi yang valid:
 *   "user.aktif"
 *   "!user.aktif"
 *   "user.aktif && user.peran == admin"
 *   "jumlah > 0 || jumlah == -1"
 *   "!(user.aktif || user.terblokir)"
 *   "status == \"aktif\" && level >= 3"
 */

import { resolveNilai } from './resolver.js';

// ─────────────────────────────────────────────────────────────
// Fungsi publik
// ─────────────────────────────────────────────────────────────

/**
 * Mengevaluasi ekspresi boolean dari konteks data.
 *
 * @param {string} ekspresi - Ekspresi kondisional
 * @param {object} data     - Konteks data aktif
 * @returns {boolean}
 */
export function evaluasiEkspresi(ekspresi, data) {
  if (!ekspresi || typeof ekspresi !== 'string') return false;
  try {
    return Boolean(new ExprParser(ekspresi.trim(), data).parse());
  } catch {
    // Jika parsing gagal, fallback ke false — jangan crash template
    return false;
  }
}

/**
 * Alias backward-compatible — menggantikan evaluasiKondisi dari resolver.js v1.x
 */
export const evaluasiKondisi = evaluasiEkspresi;

// ─────────────────────────────────────────────────────────────
// Recursive Descent Parser — Private
// ─────────────────────────────────────────────────────────────

/**
 * Grammar (EBNF):
 *   expr       := or_expr
 *   or_expr    := and_expr ('||' and_expr)*
 *   and_expr   := not_expr ('&&' not_expr)*
 *   not_expr   := '!' not_expr | comparison
 *   comparison := primary (op primary)?
 *   primary    := '(' expr ')' | string_lit | num_lit | keyword | path
 *   op         := '>=' | '<=' | '!=' | '==' | '>' | '<'
 */
class ExprParser {
  constructor(input, data) {
    this.src  = input;
    this.data = data;
    this.pos  = 0;
  }

  eof()  { return this.pos >= this.src.length; }
  cur()  { return this.src[this.pos]; }
  peek(offset = 0) { return this.src[this.pos + offset]; }

  skipWS() {
    while (!this.eof() && /\s/.test(this.cur())) this.pos++;
  }

  startsWith(s) {
    return this.src.startsWith(s, this.pos);
  }

  parse() {
    const v = this.parseOr();
    return v;
  }

  // or_expr := and_expr ('||' and_expr)*
  parseOr() {
    let left = this.parseAnd();
    this.skipWS();
    while (this.startsWith('||')) {
      this.pos += 2;
      const right = this.parseAnd();
      // Gunakan loose OR — tidak short-circuit agar semua sisi tetap di-parse
      left = left || right;
      this.skipWS();
    }
    return left;
  }

  // and_expr := not_expr ('&&' not_expr)*
  parseAnd() {
    let left = this.parseNot();
    this.skipWS();
    while (this.startsWith('&&')) {
      this.pos += 2;
      const right = this.parseNot();
      left = left && right;
      this.skipWS();
    }
    return left;
  }

  // not_expr := '!' not_expr | comparison
  parseNot() {
    this.skipWS();
    // Pastikan '!' bukan bagian dari '!='
    if (this.cur() === '!' && this.peek(1) !== '=') {
      this.pos++;
      return !Boolean(this.parseNot());
    }
    return this.parseComparison();
  }

  // comparison := primary (op primary)?
  parseComparison() {
    const left = this.parsePrimary();
    this.skipWS();

    // Urutan: operator lebih panjang dulu agar '>=' tidak salah diparsing sebagai '>'
    const OPS = ['>=', '<=', '!=', '==', '>', '<'];
    for (const op of OPS) {
      if (this.startsWith(op)) {
        this.pos += op.length;
        this.skipWS();
        const right = this.parsePrimary();
        return this.compare(left, op, right);
      }
    }

    return left;
  }

  // primary := '(' expr ')' | string_lit | num_lit | keyword | path
  parsePrimary() {
    this.skipWS();
    if (this.eof()) return undefined;

    // Grouped expression: (...)
    if (this.cur() === '(') {
      this.pos++;
      const v = this.parseOr();
      this.skipWS();
      if (this.cur() === ')') this.pos++;
      return v;
    }

    // String literal: "..." atau '...'
    if (this.cur() === '"' || this.cur() === "'") {
      return this.parseStrLiteral();
    }

    // Number literal (termasuk negatif jika tepat setelah operator)
    if (/\d/.test(this.cur())) {
      return this.parseNumLiteral();
    }

    // Keyword boolean/null
    if (this.startsWith('true')      && !/\w/.test(this.peek(4)))  { this.pos += 4; return true; }
    if (this.startsWith('false')     && !/\w/.test(this.peek(5)))  { this.pos += 5; return false; }
    if (this.startsWith('null')      && !/\w/.test(this.peek(4)))  { this.pos += 4; return null; }
    if (this.startsWith('undefined') && !/\w/.test(this.peek(9)))  { this.pos += 9; return undefined; }

    // Path dot/bracket notation: user.nama, items[0].status
    return this.parsePath();
  }

  parseStrLiteral() {
    const q = this.src[this.pos++];
    let s   = '';
    while (!this.eof() && this.cur() !== q) {
      if (this.cur() === '\\') {
        this.pos++;
        s += this.cur() ?? '';
      } else {
        s += this.cur();
      }
      this.pos++;
    }
    if (!this.eof()) this.pos++; // tutup quote
    return s;
  }

  parseNumLiteral() {
    let s = '';
    while (!this.eof() && /[\d.]/.test(this.cur())) s += this.src[this.pos++];
    return Number(s);
  }

  parsePath() {
    // Konsumsi karakter path: huruf, angka, titik, underscore, $, tanda kurung siku
    let s = '';
    while (!this.eof() && /[\w.$[\]]/.test(this.cur())) s += this.src[this.pos++];

    if (!s) {
      // Karakter tidak dikenal — lewati agar tidak infinite loop
      this.pos++;
      return undefined;
    }


    /**
     * @adr     Kembalikan undefined ketika path tidak ditemukan di data
     * @context Identifier tak dikenal (<if tidakAda>) harus falsy.
     *          Fallback ke string literal (s) membuat semua identifier truthy.
     * @decision Kembalikan resolveNilai langsung — undefined jika tidak ada
     * @tradeoff Perbandingan string tak-berkutip (== admin) tidak lagi didukung;
     *           gunakan kutip ganda: == "admin"
     * @alternatives Fallback ke s (v1.x): identifier tak dikenal selalu truthy
     */
    return resolveNilai(this.data, s);
  }

  compare(left, op, right) {
    // Coba numeric comparison jika keduanya bisa dikonversi ke angka
    const numL = Number(left);
    const numR = Number(right);
    const isNum =
      !isNaN(numL) && !isNaN(numR) &&
      left  !== null && right !== null &&
      left  !== ''   && right !== '' &&
      left  !== true && left  !== false &&
      right !== true && right !== false;

    const a = isNum ? numL : String(left  ?? '');
    const b = isNum ? numR : String(right ?? '');

    switch (op) {
      case '==': return a == b;
      case '!=': return a != b;
      case '>':  return a > b;
      case '<':  return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      default:   return false;
    }
  }
}
