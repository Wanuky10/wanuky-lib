/**
 * Resolver nilai dari konteks data menggunakan dot-notation dan bracket-notation.
 *
 * Perubahan di v2.0.0:
 *   - Support bracket notation: items[0], matrix[1][2]
 *   - Support literal number, boolean, null sebagai path value
 *   - Support wildcard '$' sebagai referensi ke root data
 */

/**
 * Mengambil nilai dari objek data menggunakan dot/bracket notation path.
 * Mendukung akses bersarang dengan optional chaining implisit.
 *
 * Literal yang didukung langsung (tanpa lookup ke data):
 *   - Angka     : '42', '3.14', '-1'
 *   - Boolean   : 'true', 'false'
 *   - Null      : 'null'
 *   - Undefined : 'undefined'
 *
 * Path yang didukung:
 *   - Dot notation   : 'pengguna.profil.nama'
 *   - Array index    : 'items[0]', 'items[2].nama'
 *   - Mixed          : 'daftar[0].profil.kota'
 *
 * @param {object} data - Objek sumber data.
 * @param {string} path - Path atau literal.
 * @returns {unknown}   - Nilai pada path tersebut, atau undefined jika tidak ada.
 */
export function resolveNilai(data, path) {
  if (path === null || path === undefined) return undefined;
  if (typeof path !== 'string') return undefined;

  const trimmed = path.trim();
  if (!trimmed) return undefined;

  // ── Literal langsung ──────────────────────────────────────────
  if (/^-?\d+\.?\d*$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true')      return true;
  if (trimmed === 'false')     return false;
  if (trimmed === 'null')      return null;
  if (trimmed === 'undefined') return undefined;

  // ── Normalisasi bracket notation → dot notation ───────────────
  // 'items[0].nama' → 'items.0.nama'
  // 'matrix[1][2]'  → 'matrix.1.2'
  const normalised = trimmed
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\[['"]([^'"]+)['"]\]/g, '.$1');

  // ── Resolve melalui objek secara iteratif ─────────────────────
  return normalised
    .split('.')
    .filter(Boolean)
    .reduce((obj, key) => {
      if (obj === null || obj === undefined) return undefined;
      return obj[key];
    }, data);
}
