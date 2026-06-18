/**
 * Baca orientasi EXIF dari File JPEG.
 * Hanya baca minimal byte yang dibutuhkan — tidak parse seluruh file.
 *
 * Nilai orientasi EXIF:
 *   1 = normal, 3 = 180°, 6 = 90° CW, 8 = 90° CCW
 *   2, 4, 5, 7 = mirror variants (jarang di foto kamera biasa)
 *
 * @param {File|Blob} file
 * @returns {Promise<1|2|3|4|5|6|7|8>} Default 1 jika tidak ada EXIF atau bukan JPEG.
 */
export async function bacaOrientasiExif(file) {
  // Baca 64KB pertama — cukup untuk EXIF header di hampir semua kamera
  const buffer = await file.slice(0, 65536).arrayBuffer();
  const view   = new DataView(buffer);

  // Validasi JPEG SOI marker
  if (view.getUint16(0, false) !== 0xFFD8) return 1;

  let offset = 2;

  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    // APP1 marker = 0xFFE1 (EXIF ada di sini)
    if (marker === 0xFFE1) {
      // Pastikan ada 'Exif\0\0' header
      const exifHeader = view.getUint32(offset + 2, false);
      if (exifHeader !== 0x45786966) return 1; // bukan 'Exif'

      const tiffOffset = offset + 8; // skip 'Exif\0\0'

      // Deteksi byte order
      const byteOrder   = view.getUint16(tiffOffset, false);
      const littleEndian = byteOrder === 0x4949; // 'II' = little endian

      // Offset ke IFD0 dari awal TIFF header
      const ifd0Offset = tiffOffset + view.getUint32(tiffOffset + 4, littleEndian);

      // Jumlah entry di IFD0
      const jumlahEntry = view.getUint16(ifd0Offset, littleEndian);

      for (let i = 0; i < jumlahEntry; i++) {
        const entryOffset = ifd0Offset + 2 + (i * 12);
        const tag = view.getUint16(entryOffset, littleEndian);

        // Tag 0x0112 = Orientation
        if (tag === 0x0112) {
          const orientasi = view.getUint16(entryOffset + 8, littleEndian);
          return (orientasi >= 1 && orientasi <= 8) ? orientasi : 1;
        }
      }
    } else if ((marker & 0xFF00) !== 0xFF00) {
      break; // bukan marker yang valid, stop
    }

    // Skip ke marker berikutnya
    if (offset + 2 > view.byteLength) break;
    offset += view.getUint16(offset, false);
  }

  return 1; // tidak ada EXIF orientation
}

/**
 * Hitung rotation angle dan flip dari nilai orientasi EXIF.
 * @param {number} orientasi
 * @returns {{ rotate: number, flipH: boolean, flipV: boolean }}
 */
export function orientasiKeTransform(orientasi) {
  const map = {
    1: { rotate: 0,   flipH: false, flipV: false },
    2: { rotate: 0,   flipH: true,  flipV: false },
    3: { rotate: 180, flipH: false, flipV: false },
    4: { rotate: 0,   flipH: false, flipV: true  },
    5: { rotate: 90,  flipH: true,  flipV: false },
    6: { rotate: 90,  flipH: false, flipV: false },
    7: { rotate: 270, flipH: true,  flipV: false },
    8: { rotate: 270, flipH: false, flipV: false },
  };
  return map[orientasi] ?? map[1];
}
