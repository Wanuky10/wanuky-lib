/**
 * Mengambil nilai dari objek data menggunakan dot-notation path.
 * Mendukung akses bersarang: 'pengguna.profil.nama'.
 *
 * Menggunakan reduce dengan optional chaining agar tidak melempar error
 * saat intermediate key tidak ada — mengembalikan undefined dengan aman.
 *
 * @param {object} data - Objek sumber data.
 * @param {string} path - Dot-notation path (misal: 'pengguna.nama').
 * @returns {unknown} Nilai pada path tersebut, atau undefined jika tidak ada.
 */
export function resolveNilai(data, path) {
  if (!path || typeof path !== 'string') return undefined;

  return path
    .trim()
    .split('.')
    .reduce((obj, kunci) => obj?.[kunci], data);
}

/**
 * Mengevaluasi ekspresi kondisional sederhana dari konteks data.
 * Mendukung: nilai truthy/falsy, negasi dengan '!', dan perbandingan
 * sederhana: '==', '!=', '>', '<', '>=', '<='.
 *
 * Contoh ekspresi yang valid:
 *   'pengguna.aktif'           → truthy check
 *   '!pengguna.aktif'          → falsy check
 *   'pengguna.peran == admin'  → perbandingan string (tanpa quote)
 *   'jumlah > 0'               → perbandingan numerik
 *
 * Desain: sengaja dibatasi pada ekspresi sederhana tanpa eval() —
 * eval() membuka celah XSS dan code injection yang tidak dapat diterima
 * untuk library yang digunakan bersama data dari pengguna.
 *
 * @param {string} ekspresi - Ekspresi kondisional.
 * @param {object} data - Konteks data aktif.
 * @returns {boolean}
 */
export function evaluasiKondisi(ekspresi, data) {
  const expr = ekspresi.trim();

  // Operator perbandingan — urutan penting: '==' sebelum '=' agar tidak salah split
  const OPERATOR = ['>=', '<=', '!=', '==', '>', '<'];

  for (const op of OPERATOR) {
    const indeks = expr.indexOf(op);
    if (indeks === -1) continue;

    const kiri = expr.slice(0, indeks).trim();
    const kanan = expr.slice(indeks + op.length).trim();

    const nilaiKiri = resolveNilai(data, kiri) ?? kiri;
    // Kanan bisa berupa path ke data atau literal string/angka
    const nilaiKanan = resolveNilai(data, kanan) ?? kanan;

    // Konversi ke number jika keduanya adalah angka yang valid
    const numKiri = Number(nilaiKiri);
    const numKanan = Number(nilaiKanan);
    const keduaAngka = !isNaN(numKiri) && !isNaN(numKanan);

    const a = keduaAngka ? numKiri : String(nilaiKiri);
    const b = keduaAngka ? numKanan : String(nilaiKanan);

    switch (op) {
      case '==': return a == b;
      case '!=': return a != b;
      case '>':  return a > b;
      case '<':  return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
    }
  }

  // Negasi sederhana: !path
  if (expr.startsWith('!')) {
    return !resolveNilai(data, expr.slice(1).trim());
  }

  // Truthy check: langsung resolve path
  return Boolean(resolveNilai(data, expr));
}
