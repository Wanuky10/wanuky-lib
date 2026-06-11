/**
 * Filter library untuk interpolasi template.
 *
 * Sintaks penggunaan di template:
 *   <{ variabel | namaFilter }>
 *   <{ variabel | namaFilter: arg1, arg2 }>
 *   <{ variabel | filter1 | filter2: arg }>  (berantai)
 *
 * Setiap fungsi filter menerima nilai sebagai argumen pertama,
 * diikuti argumen tambahan sebagai string (perlu dikonversi jika perlu).
 */

// ─────────────────────────────────────────────────────────────
// Engine komposisi filter
// ─────────────────────────────────────────────────────────────

/**
 * Mengomposisikan serangkaian filter secara berurutan terhadap suatu nilai.
 *
 * @param {unknown} nilai  - Nilai awal sebelum filter
 * @param {Array<{name: string, args: string[]}>} filters - Daftar filter
 * @param {string} template - Template source untuk error context
 * @returns {unknown} Nilai setelah semua filter diterapkan
 */
export function applyFilters(nilai, filters, template = '') {
  return filters.reduce((v, { name, args }) => {
    const fn = FILTER_LIBRARY[name];
    if (!fn) {
      throw new Error(
        `[template-engine] Filter tidak dikenal: "${name}". ` +
        `Filter yang tersedia: ${Object.keys(FILTER_LIBRARY).join(', ')}.`,
      );
    }
    try {
      return fn(v, ...args);
    } catch (err) {
      throw new Error(`[template-engine] Filter "${name}" gagal: ${err.message}`);
    }
  }, nilai);
}

/**
 * Mem-parse ekspresi filter dari string mentah.
 * Contoh: "nama | uppercase" → { path: 'nama', isRaw: false, filters: [{name: 'uppercase', args: []}] }
 * Contoh: "!konten | truncate: 100, ..." → { path: 'konten', isRaw: true, filters: [{...}] }
 *
 * @param {string} expr - Ekspresi mentah dari interpolasi
 * @returns {{ isRaw: boolean, path: string, filters: Array<{name: string, args: string[]}> }}
 */
export function parseFilterExpression(expr) {
  // Pisahkan dengan '|' tapi hati-hati dengan string yang mengandung '|' dalam argumen
  const parts = splitPipes(expr.trim());

  const rawPart  = parts[0].trim();
  const isRaw    = rawPart.startsWith('!');
  const path     = isRaw ? rawPart.slice(1).trim() : rawPart;

  const filters  = parts.slice(1).map((f) => {
    const colonIdx = f.indexOf(':');
    if (colonIdx === -1) {
      return { name: f.trim(), args: [] };
    }
    const name = f.slice(0, colonIdx).trim();
    const args = f.slice(colonIdx + 1)
      .split(',')
      .map((a) => {
        const t = a.trim();
        // Strip surrounding kutip ganda atau tunggal dari argumen string
        if (t.length >= 2) {
          if ((t.startsWith('"') && t.endsWith('"')) ||
              (t.startsWith("'") && t.endsWith("'"))) {
            return t.slice(1, -1);
          }
        }
        return t;
      })
      .filter((a) => a !== '');
    return { name, args };
  });

  return { isRaw, path, filters };
}

/**
 * Memecah ekspresi berdasarkan '|' sebagai separator pipe.
 * Mengabaikan '|' yang berada di dalam string literal.
 *
 * @param {string} expr
 * @returns {string[]}
 */
function splitPipes(expr) {
  const parts  = [];
  let current  = '';
  let inStr    = false;
  let strChar  = '';

  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) {
      current += c;
      if (c === strChar && expr[i - 1] !== '\\') inStr = false;
    } else if (c === '"' || c === "'") {
      inStr   = true;
      strChar = c;
      current += c;
    } else if (c === '|') {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

// ─────────────────────────────────────────────────────────────
// Library filter bawaan
// ─────────────────────────────────────────────────────────────

export const FILTER_LIBRARY = {

  // ── String ────────────────────────────────────────────────────

  /** Mengubah ke huruf besar semua. */
  uppercase: (v) => String(v ?? '').toUpperCase(),

  /** Mengubah ke huruf kecil semua. */
  lowercase: (v) => String(v ?? '').toLowerCase(),

  /** Kapital hanya huruf pertama, sisanya huruf kecil. */
  capitalize: (v) => {
    const s = String(v ?? '');
    return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '';
  },

  /** Kapital setiap kata (Title Case). */
  titlecase: (v) =>
    String(v ?? '').replace(
      /\b\w/g,
      (c) => c.toUpperCase(),
    ),

  /** Hapus spasi di awal dan akhir. */
  trim: (v) => String(v ?? '').trim(),

  /**
   * Ganti semua kemunculan `from` dengan `to`.
   * @param {string} v
   * @param {string} from - String yang dicari
   * @param {string} to   - String pengganti (default: '')
   */
  replace: (v, from = '', to = '') =>
    String(v ?? '').split(from).join(to),

  /**
   * Potong string jika melebihi panjang tertentu, tambah suffix.
   * @param {string} v
   * @param {string} len    - Panjang maks (default: '100')
   * @param {string} suffix - Suffix jika dipotong (default: '…')
   */
  truncate: (v, len = '100', suffix = '…') => {
    const s = String(v ?? '');
    const l = Number(len);
    // trimEnd() menghapus spasi trailing sebelum suffix agar hasil lebih rapi
    // Contoh: 'halo dunia'.slice(0,5) = 'halo ' → trimEnd → 'halo' + '…' = 'halo…'
    return s.length > l ? s.slice(0, l).trimEnd() + suffix : s;
  },

  /**
   * Pad string dari kiri hingga mencapai panjang tertentu.
   * @param {string} v
   * @param {string} len  - Panjang target
   * @param {string} char - Karakter pengisi (default: ' ')
   */
  padStart: (v, len = '0', char = ' ') =>
    String(v ?? '').padStart(Number(len), char),

  /**
   * Pad string dari kanan hingga mencapai panjang tertentu.
   */
  padEnd: (v, len = '0', char = ' ') =>
    String(v ?? '').padEnd(Number(len), char),

  /**
   * Konversi string ke format URL slug.
   * Contoh: "Halo Dunia!" → "halo-dunia"
   */
  slug: (v) =>
    String(v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s-]+/g, '-'),

  // ── Default / Logika ──────────────────────────────────────────

  /**
   * Kembalikan `def` jika nilai null, undefined, atau string kosong.
   * @param {unknown} v
   * @param {string} def - Nilai default (default: '')
   */
  default: (v, def = '') => (v == null || v === '') ? def : v,

  /** Konversi ke boolean. */
  bool: (v) => Boolean(v),

  // ── Number ───────────────────────────────────────────────────

  /**
   * Format angka dengan pemisah ribuan sesuai locale.
   * @param {unknown} v
   * @param {string} locale - Locale BCP 47 (default: 'id-ID')
   */
  number: (v, locale = 'id-ID') => {
    const n = Number(v);
    return isNaN(n) ? String(v ?? '') : n.toLocaleString(locale);
  },

  /**
   * Bulatkan ke N desimal.
   * @param {unknown} v
   * @param {string} dec - Jumlah desimal (default: '0')
   */
  round: (v, dec = '0') => Number(Number(v).toFixed(Number(dec))),

  /** Bulatkan ke bawah. */
  floor: (v) => Math.floor(Number(v)),

  /** Bulatkan ke atas. */
  ceil: (v) => Math.ceil(Number(v)),

  /** Nilai absolut. */
  abs: (v) => Math.abs(Number(v)),

  /**
   * Format sebagai mata uang.
   * @param {unknown} v
   * @param {string} curr   - Kode mata uang (default: 'IDR')
   * @param {string} locale - Locale BCP 47 (default: 'id-ID')
   */
  currency: (v, curr = 'IDR', locale = 'id-ID') => {
    const n = Number(v);
    if (isNaN(n)) return String(v ?? '');
    return new Intl.NumberFormat(locale, {
      style:                 'currency',
      currency:              curr,
      minimumFractionDigits: 0,
    }).format(n);
  },

  /**
   * Format sebagai persentase.
   * @param {unknown} v   - Nilai desimal (0.75 → 75%)
   * @param {string} dec  - Jumlah desimal (default: '0')
   */
  percent: (v, dec = '0') =>
    `${Number(Number(v) * 100).toFixed(Number(dec))}%`,

  // ── Date ──────────────────────────────────────────────────────

  /**
   * Format tanggal dengan pola tertentu.
   * Token: yyyy, MM, dd, HH, mm, ss, M, d
   * @param {unknown} v   - Nilai tanggal (Date, string, atau timestamp)
   * @param {string} fmt  - Pola format (default: 'dd/MM/yyyy')
   */
  dateFormat: (v, fmt = 'dd/MM/yyyy') => {
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v ?? '');
    const pad = (n) => String(n).padStart(2, '0');
    const MAP = {
      yyyy: d.getFullYear(),
      MM:   pad(d.getMonth() + 1),
      dd:   pad(d.getDate()),
      HH:   pad(d.getHours()),
      mm:   pad(d.getMinutes()),
      ss:   pad(d.getSeconds()),
      M:    d.getMonth() + 1,
      d:    d.getDate(),
    };
    return fmt.replace(/yyyy|MM|dd|HH|mm|ss|M|d/g, (k) => MAP[k] ?? k);
  },

  /**
   * Menampilkan waktu relatif dari sekarang.
   * Contoh: "2 hari lalu", "5 menit lalu", "baru saja"
   */
  timeAgo: (v) => {
    const diff = Date.now() - new Date(v).getTime();
    if (isNaN(diff)) return String(v ?? '');
    const UNITS = [
      [31_536_000_000, 'tahun'],
      [2_592_000_000,  'bulan'],
      [86_400_000,     'hari'],
      [3_600_000,      'jam'],
      [60_000,         'menit'],
      [1_000,          'detik'],
    ];
    for (const [ms, label] of UNITS) {
      const n = Math.floor(Math.abs(diff) / ms);
      if (n >= 1) return `${n} ${label} lalu`;
    }
    return 'baru saja';
  },

  // ── Array ─────────────────────────────────────────────────────

  /** Jumlah elemen array atau panjang string. */
  length: (v) => Array.isArray(v) ? v.length : String(v ?? '').length,

  /**
   * Gabungkan array menjadi string.
   * @param {unknown} v
   * @param {string} sep - Separator (default: ', ')
   */
  join: (v, sep = ', ') =>
    Array.isArray(v) ? v.join(sep) : String(v ?? ''),

  /** Ambil elemen pertama. */
  first: (v) => Array.isArray(v) ? v[0] : String(v ?? '')[0],

  /** Ambil elemen terakhir. */
  last: (v) =>
    Array.isArray(v) ? v[v.length - 1] : String(v ?? '').slice(-1),

  /** Balik urutan array atau karakter string. */
  reverse: (v) =>
    Array.isArray(v)
      ? [...v].reverse()
      : String(v ?? '').split('').reverse().join(''),

  /** Hapus duplikat dari array. */
  unique: (v) => Array.isArray(v) ? [...new Set(v)] : v,

  /**
   * Urutkan array. Jika array berisi objek, gunakan `key` sebagai kunci sorting.
   * @param {unknown} v
   * @param {string} key - Kunci sorting pada objek (default: '' = sort langsung)
   */
  sort: (v, key = '') => {
    if (!Array.isArray(v)) return v;
    return [...v].sort((a, b) => {
      const x = key ? a[key] : a;
      const y = key ? b[key] : b;
      return x < y ? -1 : x > y ? 1 : 0;
    });
  },

  /**
   * Ambil subset array atau substring.
   * @param {unknown} v
   * @param {string} start - Indeks awal (default: '0')
   * @param {string} end   - Indeks akhir eksklusif (default: ambil semua)
   */
  slice: (v, start = '0', end = '') => {
    const src = Array.isArray(v) ? v : String(v ?? '');
    return end ? src.slice(Number(start), Number(end)) : src.slice(Number(start));
  },

  // ── Serialisasi ───────────────────────────────────────────────

  /**
   * Konversi ke JSON string.
   * @param {unknown} v
   * @param {string} indent - Indentasi (default: '0' = compact)
   */
  json: (v, indent = '0') => {
    try { return JSON.stringify(v, null, Number(indent)); }
    catch { return '{}'; }
  },

  /** Ambil daftar kunci objek. */
  keys: (v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v)
      : [],

  /** Ambil daftar nilai objek. */
  values: (v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.values(v)
      : [],

  /**
   * Konversi objek ke array {key, value}.
   * Berguna untuk iterasi objek di template: <each entry in obj | entries>
   */
  /**
   * Konversi objek ke array {key, value}.
   * Berguna untuk iterasi objek di template: <each entry in obj | entries>
   */
  entries: (v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.entries(v).map(([key, value]) => ({ key, value }))
      : [],
};
