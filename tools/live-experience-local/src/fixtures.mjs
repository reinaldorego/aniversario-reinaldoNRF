import { chunk, encodePng, SYNTHETIC_MARK } from './png.mjs';

// Geometric pixels only. No people, private photos, real coordinates or guest data.
export function syntheticPng(seed = 1, width = 800, height = 500) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const band = (Math.floor(x / 40) + Math.floor(y / 40) + seed) % 2;
    const i = (y * width + x) * 3;
    pixels[i] = band ? 205 : 15; pixels[i + 1] = band ? 166 : 15; pixels[i + 2] = (seed * 37) % 256;
  }
  // Valid little-endian TIFF with GPS IFD and synthetic zero-degree coordinates.
  const exif = Buffer.alloc(88);
  exif.write('II'); exif.writeUInt16LE(42, 2); exif.writeUInt32LE(8, 4);
  exif.writeUInt16LE(1, 8); exif.writeUInt16LE(0x8825, 10);
  exif.writeUInt16LE(4, 12); exif.writeUInt32LE(1, 14); exif.writeUInt32LE(26, 18);
  exif.writeUInt16LE(2, 26);
  exif.writeUInt16LE(1, 28); exif.writeUInt16LE(2, 30); exif.writeUInt32LE(2, 32); exif.write('N\0', 36);
  exif.writeUInt16LE(2, 40); exif.writeUInt16LE(5, 42); exif.writeUInt32LE(3, 44); exif.writeUInt32LE(56, 48);
  for (const offset of [60, 68, 76]) exif.writeUInt32LE(1, offset);
  return encodePng({ width, height, channels: 3, pixels }, [
    chunk('tEXt', Buffer.from(SYNTHETIC_MARK)),
    chunk('eXIf', exif),
    chunk('tEXt', Buffer.from('Comment\0GPS SYNTHETIC ZERO - NOT AN EVENT PHOTO'))
  ]);
}
