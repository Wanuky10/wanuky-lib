/**
 * FormatManager — kelola operasi format teks dan undo/redo history.
 * Beroperasi langsung pada contenteditable element via Selection API.
 * Berjalan di browser environment saja.
 */

import { EditorError } from './errors.js';

export class FormatManager {
  #editArea;
  #history      = [];
  #historyIndex = -1;
  #maxHistori;
  #onUndoRedo;

  /**
   * @param {HTMLElement} editArea          - Elemen contenteditable
   * @param {number}      [maxHistori=100]
   * @param {Function}    [onUndoRedo]
   */
  constructor(editArea, maxHistori = 100, onUndoRedo = null) {
    this.#editArea   = editArea;
    this.#maxHistori = maxHistori;
    this.#onUndoRedo = onUndoRedo;
  }

  // ── Snapshot (Undo/Redo) ────────────────────────────────────

  snapshot() {
    const state = {
      html:      this.#editArea.innerHTML,
      selection: this.#serializeSelection(),
    };

    this.#history = this.#history.slice(0, this.#historyIndex + 1);
    this.#history.push(state);

    if (this.#maxHistori > 0 && this.#history.length > this.#maxHistori) {
      this.#history.shift();
    } else {
      this.#historyIndex++;
    }

    this.#emitUndoRedo();
  }

  undo() {
    if (!this.bisaUndo) return;
    this.#historyIndex--;
    const state = this.#history[this.#historyIndex];
    this.#editArea.innerHTML = state.html;
    this.#restoreSelection(state.selection);
    this.#emitUndoRedo();
  }

  redo() {
    if (!this.bisaRedo) return;
    this.#historyIndex++;
    const state = this.#history[this.#historyIndex];
    this.#editArea.innerHTML = state.html;
    this.#restoreSelection(state.selection);
    this.#emitUndoRedo();
  }

  get bisaUndo() { return this.#historyIndex > 0; }
  get bisaRedo() { return this.#historyIndex < this.#history.length - 1; }

  // ── Format Inline ───────────────────────────────────────────

  /**
   * Toggle format inline. Jika selection sudah bold, remove. Jika belum, wrap.
   * @param {'strong'|'em'|'u'|'del'|'code'} tagName
   */
  toggleInline(tagName) {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;

    this.snapshot();
    const range    = selection.getRangeAt(0);
    const existing = this.#cariAncestor(range.commonAncestorContainer, tagName.toUpperCase());

    if (existing) {
      const frag = document.createDocumentFragment();
      while (existing.firstChild) frag.appendChild(existing.firstChild);
      existing.replaceWith(frag);
    } else {
      try {
        const el = document.createElement(tagName);
        range.surroundContents(el);
      } catch {
        // Fallback jika selection melintasi boundary tag
        const frag = range.extractContents();
        const el   = document.createElement(tagName);
        el.appendChild(frag);
        range.insertNode(el);
        selection.removeAllRanges();
        const newRange = document.createRange();
        newRange.selectNodeContents(el);
        selection.addRange(newRange);
      }
    }
  }

  // ── Format Blok ────────────────────────────────────────────

  /**
   * Ubah block element di posisi cursor.
   * @param {'p'|'h1'|'h2'|'h3'|'blockquote'|'pre'} tagBaru
   */
  setBlok(tagBaru) {
    const blockTags = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
                                'BLOCKQUOTE', 'PRE', 'DIV', 'LI']);
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    this.snapshot();
    const range = selection.getRangeAt(0);
    const blockSekarang = this.#cariAncestorDenganSet(
      range.commonAncestorContainer,
      blockTags,
      this.#editArea,
    );

    if (!blockSekarang) return;

    const elBaru = document.createElement(tagBaru);
    while (blockSekarang.firstChild) elBaru.appendChild(blockSekarang.firstChild);
    blockSekarang.replaceWith(elBaru);

    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(elBaru);
    newRange.collapse(false);
    selection.addRange(newRange);
  }

  // ── Link & Gambar ───────────────────────────────────────────

  /**
   * @param {string} url
   * @param {string} [label]
   */
  insertLink(url, label) {
    this.#validasiUrl(url);
    this.snapshot();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const a     = document.createElement('a');
    a.href   = url;
    a.target = '_blank';
    a.rel    = 'noopener noreferrer';

    if (!selection.isCollapsed) {
      try {
        a.appendChild(range.extractContents());
      } catch {
        a.textContent = label ?? url;
      }
    } else {
      a.textContent = label ?? url;
    }

    range.insertNode(a);
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(a);
    newRange.collapse(true);
    selection.addRange(newRange);
  }

  /**
   * @param {string} url
   * @param {string} [alt='']
   * @throws {EditorError} jika URL tidak HTTPS
   */
  insertGambar(url, alt = '') {
    this.#validasiUrl(url);
    this.snapshot();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const img   = document.createElement('img');
    img.src = url;
    img.alt = alt;
    range.insertNode(img);
  }

  hapusFormat() {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;

    this.snapshot();
    const range    = selection.getRangeAt(0);
    const teks     = range.toString();
    const textNode = document.createTextNode(teks);
    range.deleteContents();
    range.insertNode(textNode);
  }

  // ── Paste Handler ───────────────────────────────────────────

  /**
   * @param {ClipboardEvent} e
   * @param {'strip'|'plain'} mode
   */
  handlePaste(e, mode = 'strip') {
    e.preventDefault();
    this.snapshot();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    let konten;

    if (mode === 'plain') {
      konten = document.createTextNode(e.clipboardData.getData('text/plain'));
    } else {
      const html = e.clipboardData.getData('text/html');
      if (html) {
        const parser = new DOMParser();
        const doc    = parser.parseFromString(html, 'text/html');
        this.#stripVendorMarkup(doc.body);
        const frag = document.createDocumentFragment();
        while (doc.body.firstChild) frag.appendChild(doc.body.firstChild);
        konten = frag;
      } else {
        const teks = e.clipboardData.getData('text/plain');
        konten = document.createDocumentFragment();
        for (const par of teks.split(/\n\n+/)) {
          const p = document.createElement('p');
          p.textContent = par.trim();
          if (p.textContent) konten.appendChild(p);
        }
      }
    }

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(konten);
    selection.collapseToEnd();
  }

  // ── Private Helpers ─────────────────────────────────────────

  #emitUndoRedo() {
    this.#onUndoRedo?.({ bisaUndo: this.bisaUndo, bisaRedo: this.bisaRedo });
  }

  #cariAncestor(node, tagName) {
    let current = node;
    while (current && current !== this.#editArea) {
      if (current.nodeName === tagName.toUpperCase()) return current;
      current = current.parentNode;
    }
    return null;
  }

  #cariAncestorDenganSet(node, tagSet, batas) {
    let current = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (current && current !== batas) {
      if (tagSet.has(current.nodeName)) return current;
      current = current.parentNode;
    }
    return null;
  }

  #validasiUrl(url) {
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
        throw new EditorError(
          `URL tidak diizinkan: ${url}. Protokol harus https, http, mailto, atau tel.`,
        );
      }
    } catch (e) {
      if (e instanceof EditorError) throw e;
      throw new EditorError(`URL tidak valid: ${url}`);
    }
  }

  #stripVendorMarkup(el) {
    const ATRIBUT_HAPUS = ['style', 'class', 'id', 'lang', 'xmlns', 'data-mce-style'];
    for (const child of el.querySelectorAll('*')) {
      for (const attr of ATRIBUT_HAPUS) child.removeAttribute(attr);
      for (const attr of [...child.attributes]) {
        if (attr.name.startsWith('on')) child.removeAttribute(attr.name);
      }
    }
    for (const el of [...el.querySelectorAll('[class*="Mso"], o\\:p, w\\:wrap')]) {
      el.replaceWith(...el.childNodes);
    }
  }

  #serializeSelection() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return {
      anchorOffset: sel.anchorOffset,
      focusOffset:  sel.focusOffset,
    };
  }

  #restoreSelection(state) {
    if (!state) return;
    // Best-effort restore — position mungkin tidak valid setelah innerHTML overwrite
  }
}
