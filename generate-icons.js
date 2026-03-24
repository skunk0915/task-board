// PWA アイコン生成スクリプト (Node.js 組み込みモジュールのみ使用)
const zlib = require('zlib');
const fs = require('fs');

function makeCRCTable() {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const crcTable = makeCRCTable();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createPNG(size, drawFn) {
  const pixels = new Uint8Array(size * size * 4);
  drawFn(pixels, size);
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (1 + size * 4) + 1 + x * 4;
      raw[dst] = pixels[src]; raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2]; raw[dst+3] = pixels[src+3];
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function set(px, size, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a;
}

function fillRounded(px, size, x, y, w, h, rad, r, g, b, a = 255) {
  for (let py = y; py < y + h; py++) {
    for (let px2 = x; px2 < x + w; px2++) {
      const lx = px2 - x, ly = py - y;
      let skip = false;
      if (lx < rad && ly < rad) { const dx = lx-rad+.5, dy = ly-rad+.5; if (dx*dx+dy*dy > rad*rad) skip = true; }
      if (lx >= w-rad && ly < rad) { const dx = lx-(w-rad)+.5, dy = ly-rad+.5; if (dx*dx+dy*dy > rad*rad) skip = true; }
      if (lx < rad && ly >= h-rad) { const dx = lx-rad+.5, dy = ly-(h-rad)+.5; if (dx*dx+dy*dy > rad*rad) skip = true; }
      if (lx >= w-rad && ly >= h-rad) { const dx = lx-(w-rad)+.5, dy = ly-(h-rad)+.5; if (dx*dx+dy*dy > rad*rad) skip = true; }
      if (!skip) set(px, size, px2, py, r, g, b, a);
    }
  }
}

function drawIcon(pixels, s) {
  // 背景: #4A90D9 角丸
  const bgR=74, bgG=144, bgB=217;
  const bgRad = Math.round(s * 0.18);
  fillRounded(pixels, s, 0, 0, s, s, bgRad, bgR, bgG, bgB);

  // 3カラム
  const colW = Math.round(s * 0.23);
  const colH = Math.round(s * 0.62);
  const colY = Math.round(s * 0.19);
  const gap = Math.round(s * 0.055);
  const totalW = colW * 3 + gap * 2;
  const startX = Math.round((s - totalW) / 2);
  const colRad = Math.round(s * 0.04);

  for (let i = 0; i < 3; i++) {
    fillRounded(pixels, s, startX + i*(colW+gap), colY, colW, colH, colRad, 255, 255, 255, 235);
  }

  // タスクカード
  const cardH = Math.round(s * 0.072);
  const padX = Math.round(s * 0.026);
  const cardMargin = Math.round(s * 0.026);
  const cardW = colW - padX * 2;
  const cardRad = Math.round(s * 0.025);
  const numCards = [3, 2, 1];
  const colors = [[bgR,bgG,bgB],[bgR+62,bgG+52,bgB+32],[bgR+105,bgG+95,bgB+68]];

  for (let col = 0; col < 3; col++) {
    const cx = startX + col*(colW+gap) + padX;
    for (let card = 0; card < numCards[col]; card++) {
      const cy = colY + cardMargin + card*(cardH+cardMargin);
      const [cr,cg,cb] = colors[card % colors.length];
      fillRounded(pixels, s, cx, cy, cardW, cardH, cardRad,
        Math.min(255,cr), Math.min(255,cg), Math.min(255,cb));
    }
  }
}

[192, 512].forEach(size => {
  const buf = createPNG(size, drawIcon);
  fs.writeFileSync(`icon-${size}.png`, buf);
  console.log(`icon-${size}.png を生成しました`);
});

const atBuf = createPNG(180, drawIcon);
fs.writeFileSync('apple-touch-icon.png', atBuf);
console.log('apple-touch-icon.png を生成しました');
