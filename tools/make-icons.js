// Generates the app icons as PNGs with no dependencies: node tools/make-icons.js
// Pink-to-purple square (the app's accent gradient) with a dark ticket stub in the middle.
const fs = require("fs"), path = require("path"), zlib = require("zlib");

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const mix = (a, b, t) => a + (b - a) * t;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const A = hex("#d96ae0"), B = hex("#8f4fd8"), INK = hex("#07080d"), PINK = hex("#e26ee6");

// Is point (x,y) in unit coords [-0.5,0.5] inside the ticket? Returns 0 outside, 1 body, 2 perforation.
function ticket(x, y) {
  const w = 0.31, h = 0.2, r = 0.045;
  const qx = Math.abs(x) - (w - r), qy = Math.abs(y) - (h - r);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  if (out > 0) return 0;
  if (Math.hypot(Math.abs(x) - w, y) < 0.065) return 0;          // side notches
  const px = 0.12;                                                 // perforation line
  if (Math.abs(x - px) < 0.012 && (Math.floor((y + h) / 0.045) % 2 === 0) && Math.abs(y) < h - 0.03) return 2;
  return 1;
}

function png(size) {
  const SS = 4, rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4); // filter byte 0
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = (px + (sx + 0.5) / SS) / size, v = (py + (sy + 0.5) / SS) / size;
        const t = (u + v) / 2;
        let c = [mix(A[0], B[0], t), mix(A[1], B[1], t), mix(A[2], B[2], t)];
        const k = ticket(u - 0.5, v - 0.5);
        if (k === 1) c = INK; else if (k === 2) c = PINK;
        acc = acc.map((a, i) => a + c[i]);
      }
      const o = 1 + px * 4;
      row[o] = Math.round(acc[0] / SS / SS); row[o + 1] = Math.round(acc[1] / SS / SS);
      row[o + 2] = Math.round(acc[2] / SS / SS); row[o + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const dir = path.join(__dirname, "..", "icons");
fs.mkdirSync(dir, { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  fs.writeFileSync(path.join(dir, name), png(size));
  console.log("wrote icons/" + name);
}
