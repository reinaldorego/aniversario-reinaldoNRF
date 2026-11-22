import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_PIXELS = 4_000_000;
export const SYNTHETIC_MARK = 'Description\0LEVEL XVIII SYNTHETIC TEST ONLY';
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function chunk(type, bytes) {
  const name = Buffer.from(type, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([size, name, bytes, crc]);
}

function requireValid(condition, code = 'INVALID_PNG') {
  if (!condition) throw new Error(code);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
}

// Deliberately narrow decoder for synthetic fixtures, not a general photo decoder.
export function decodePng(bytes, { requireSynthetic = false } = {}) {
  requireValid(bytes.length <= MAX_BYTES, 'BYTE_LIMIT');
  requireValid(bytes.subarray(0, 8).equals(SIGNATURE), 'PNG_SIGNATURE');
  let offset = 8, width, height, channels, ended = false, idatEnded = false;
  const chunks = [], compressed = [];
  let synthetic = false;
  while (offset < bytes.length) {
    requireValid(offset + 12 <= bytes.length);
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    requireValid(/^[A-Za-z]{4}$/.test(type) && offset + 12 + size <= bytes.length);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    requireValid(crc32(bytes.subarray(offset + 4, offset + 8 + size)) === bytes.readUInt32BE(offset + 8 + size), 'PNG_CRC');
    requireValid(chunks.length < 256, 'CHUNK_LIMIT');
    if (chunks.length === 0) requireValid(type === 'IHDR' && size === 13);
    if (type === 'IHDR') {
      requireValid(chunks.length === 0 && size === 13);
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      requireValid(width > 0 && height > 0 && width * height <= MAX_PIXELS, 'PIXEL_LIMIT');
      requireValid(data[8] === 8 && [2, 6].includes(data[9]) && data[10] === 0 && data[11] === 0 && data[12] === 0, 'PNG_PROFILE');
      channels = data[9] === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      requireValid(!idatEnded);
      compressed.push(data);
    } else if (type === 'IEND') {
      requireValid(size === 0 && compressed.length > 0);
      ended = true;
    } else {
      // Only a few known metadata chunks are accepted; all are discarded on output.
      requireValid(['tEXt', 'eXIf', 'pHYs'].includes(type), 'PROHIBITED_CHUNK');
      if (type === 'tEXt' && data.equals(Buffer.from(SYNTHETIC_MARK))) synthetic = true;
      if (compressed.length) idatEnded = true;
    }
    chunks.push(type);
    offset += 12 + size;
    if (ended) break;
  }
  requireValid(ended && offset === bytes.length);
  requireValid(!requireSynthetic || synthetic, 'SYNTHETIC_ONLY');
  const stride = width * channels, expected = (stride + 1) * height;
  const input = Buffer.concat(compressed);
  const result = inflateSync(input, { maxOutputLength: expected, info: true });
  requireValid(result.buffer.length === expected && result.engine.bytesWritten === input.length, 'PNG_INTEGRITY');
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    const filter = result.buffer[y * (stride + 1)];
    requireValid(filter <= 4, 'PNG_FILTER');
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
      pixels[y * stride + x] = (result.buffer[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, channels, pixels, chunks };
}

export function encodePng({ width, height, channels = 3, pixels }, metadata = []) {
  requireValid(width > 0 && height > 0 && width * height <= MAX_PIXELS && [3, 4].includes(channels));
  requireValid(pixels.length === width * height * channels);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 6;
  const raw = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * channels + 1) + 1, y * width * channels, (y + 1) * width * channels);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), ...metadata, chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function resize(image, maxSide) {
  const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.floor(image.width * ratio));
  const height = Math.max(1, Math.floor(image.height * ratio));
  const pixels = Buffer.alloc(width * height * image.channels);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(image.width - 1, Math.floor(x / ratio));
    const sy = Math.min(image.height - 1, Math.floor(y / ratio));
    image.pixels.copy(pixels, (y * width + x) * image.channels, (sy * image.width + sx) * image.channels, (sy * image.width + sx + 1) * image.channels);
  }
  return { width, height, channels: image.channels, pixels };
}

export async function processSyntheticPng(bytes) {
  const image = decodePng(bytes, { requireSynthetic: true });
  const variants = {};
  for (const [variant, side] of [['thumbnail', 160], ['display', 640]]) {
    const resized = resize(image, side);
    const data = encodePng(resized);
    const verified = decodePng(data);
    requireValid(verified.chunks.join(',') === 'IHDR,IDAT,IEND', 'METADATA_REMAINED');
    variants[variant] = { data, sha256: sha256(data), width: resized.width, height: resized.height };
  }
  return variants;
}
