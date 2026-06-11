/**
 * @wanuky10/web-editor v2.0.0
 *
 * Library editor web berbasis browser — tanpa dependensi eksternal.
 *
 * Ekspor:
 *   - RichTextEditor : editor teks kaya berbasis contenteditable
 *   - ImageEditor    : editor gambar berbasis Canvas API
 *
 * Penggunaan:
 *   import { RichTextEditor, ImageEditor } from '@wanuky10/web-editor';
 *
 * Atau import terpisah (code splitting):
 *   import { RichTextEditor } from '@wanuky10/web-editor/rich-text';
 *   import { ImageEditor }    from '@wanuky10/web-editor/image';
 *
 * PENTING: Library ini hanya berjalan di browser — tidak kompatibel dengan Node.js
 * karena bergantung pada DOM API (document, canvas, File, Blob, dll.)
 */

export { RichTextEditor } from './richTextEditor.js';
export { ImageEditor }    from './imageEditor.js';
