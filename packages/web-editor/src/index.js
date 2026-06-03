/**
 * @wanuky/web-editor
 *
 * Library editor web berbasis browser — tanpa dependensi eksternal.
 *
 * Ekspor:
 *   - RichTextEditor: editor teks kaya berbasis contenteditable
 *   - ImageEditor: editor gambar berbasis Canvas API (crop, zoom, flip, rotate)
 *
 * Penggunaan:
 *   import { RichTextEditor, ImageEditor } from '@wanuky/web-editor';
 *
 * Atau import terpisah untuk code splitting:
 *   import { RichTextEditor } from '@wanuky/web-editor/rich-text';
 *   import { ImageEditor } from '@wanuky/web-editor/image';
 *
 * PENTING: Library ini hanya berjalan di browser — tidak kompatibel dengan Node.js
 * karena bergantung pada DOM API (document, canvas, File, Blob, dll.)
 */

export { RichTextEditor } from './richTextEditor.js';
export { ImageEditor } from './imageEditor.js';
