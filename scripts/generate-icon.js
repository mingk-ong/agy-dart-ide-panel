"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 判断点 (px, py) 到线段 (ax, ay)-(bx, by) 的最短距离。
 */
function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

/**
 * 判断点 (px, py) 是否在三角形 (ax, ay), (bx, by), (cx, cy) 内部。
 */
function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function blendPixel(buf, idx, r, g, b, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  buf[idx] = Math.round(buf[idx] * (1 - a) + r * a);
  buf[idx + 1] = Math.round(buf[idx + 1] * (1 - a) + g * a);
  buf[idx + 2] = Math.round(buf[idx + 2] * (1 - a) + b * a);
  buf[idx + 3] = Math.min(255, Math.round(buf[idx + 3] + 255 * a * (1 - buf[idx + 3] / 255)));
}

/**
 * 生成 128x128 标准 RGBA PNG 扩展图标（深蓝圆角矩形 + 亮蓝盾牌轮廓 + 白色飞镖）。
 * @param {string} outPath
 */
function generateIconPng(outPath) {
  const size = 128;
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cornerR = 26;
  const margin = 8;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type 0

    for (let x = 0; x < size; x++) {
      const idx = rowStart + 1 + x * 4;
      const cx = x + 0.5;
      const cy = y + 0.5;

      // 1. 圆角矩形背景距离场
      const rx = Math.max(margin + cornerR - cx, 0, cx - (size - margin - cornerR));
      const ry = Math.max(margin + cornerR - cy, 0, cy - (size - margin - cornerR));
      const bgDist = Math.hypot(rx, ry) - cornerR;

      if (bgDist > 1) {
        continue;
      }

      const bgAlpha = bgDist <= 0 ? 1 : 1 - bgDist;
      const gradT = (cx + cy) / (2 * size);
      const bgR = Math.round(18 + gradT * 18);
      const bgG = Math.round(40 + gradT * 42);
      const bgB = Math.round(98 + gradT * 88);
      blendPixel(raw, idx, bgR, bgG, bgB, bgAlpha);

      // 2. 盾牌外框线段
      const shieldPts = [
        [64, 24],
        [32, 37],
        [32, 65],
        [38, 86],
        [64, 104],
        [90, 86],
        [96, 65],
        [96, 37],
        [64, 24]
      ];
      let minShieldDist = 999;
      for (let s = 0; s < shieldPts.length - 1; s++) {
        const d = distToSegment(cx, cy, shieldPts[s][0], shieldPts[s][1], shieldPts[s + 1][0], shieldPts[s + 1][1]);
        if (d < minShieldDist) minShieldDist = d;
      }
      if (minShieldDist < 3.4) {
        const strokeAlpha = minShieldDist <= 2.2 ? 0.95 : (3.4 - minShieldDist) / 1.2;
        blendPixel(raw, idx, 125, 211, 252, strokeAlpha);
      }

      // 3. 中心白色飞镖箭头（双三角拼接）
      const inDartTop = pointInTriangle(cx, cy, 82, 46, 44, 64, 60, 69);
      const inDartBot = pointInTriangle(cx, cy, 82, 46, 60, 69, 65, 86);
      if (inDartTop || inDartBot) {
        blendPixel(raw, idx, 255, 255, 255, 0.98);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0))
  ]);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, png);
  return outPath;
}

if (require.main === module) {
  const out = path.resolve(__dirname, "..", "assets", "icon.png");
  generateIconPng(out);
  console.log(`Generated ${out}`);
}

module.exports = {
  generateIconPng
};
