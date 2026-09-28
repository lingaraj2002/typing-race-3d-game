import { readFileSync } from 'fs';
import zlib from 'zlib';

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width, height, bitDepth, colorType, interlace;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNG unsupported');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : throwErr();
  if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth} unsupported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 3);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    let p = y * (stride + 1);
    const f = raw[p];
    raw.copy(cur, 0, p + 1, p + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = cur[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += a <= b && a <= c ? a : b <= c ? b : c;
      }
      cur[x] = v & 255;
    }
    const src = cur, dst = out.subarray(y * width * 3, (y + 1) * width * 3);
    if (channels === 3) src.copy(dst);
    else for (let i = 0; i < width * 3; i += 3) {
      const ia = (i / 3) * 4;
      dst[i] = src[ia]; dst[i + 1] = src[ia + 1]; dst[i + 2] = src[ia + 2];
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

function classifyCell(rgb) {
  const r = rgb[0], g = rgb[1], b = rgb[2];
  const bri = (r + g + b) / 3;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 30) {
    if (bri >= 225) return 'W';
    if (bri >= 165) return '=';
    if (bri >= 105) return ':';
    if (bri >= 55) return '.';
    return ' ';
  }
  if (r >= g && r >= b) return bri >= 120 ? (g > b + 40 ? 'Y' : 'R') : 'r';
  if (g >= r && g >= b) return bri >= 100 ? 'G' : 'g';
  return bri >= 120 ? 'B' : 'b';
}

const cols = 48, rows = 24;
for (const file of process.argv.slice(2)) {
  const { width, height, data } = decodePNG(readFileSync(file));
  console.log(`\n=== ${file.split(/[\\/]/).pop()} (${width}x${height}) ===`);
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      let sr = 0, sg = 0, sb = 0, n = 0;
      const x0 = Math.floor((c / cols) * width), x1 = Math.floor(((c + 1) / cols) * width);
      const y0 = Math.floor((r / rows) * height), y1 = Math.floor(((r + 1) / rows) * height);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 3;
          sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++;
        }
      line += classifyCell([sr / n, sg / n, sb / n]);
    }
    console.log(line);
  }
}