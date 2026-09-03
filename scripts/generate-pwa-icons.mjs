import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const outputDirectory = new URL("../public/icons/", import.meta.url);
mkdirSync(outputDirectory, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, name, data, checksum]);
}

function distanceToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
  const closestX = ax + projection * dx;
  const closestY = ay + projection * dy;
  return Math.hypot(x - closestX, y - closestY);
}

function makePng(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4);
  const background = maskable ? [49, 92, 43] : [223, 234, 213];
  const disk = maskable ? [246, 245, 235] : [49, 92, 43];
  const ink = maskable ? [21, 36, 19] : [246, 245, 235];
  const gold = [233, 188, 61];
  const center = size / 2;
  const diskRadius = size * (maskable ? 0.34 : 0.42);
  function setPixel(x, y, color) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const index = (y * size + x) * 4;
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = 255;
  }

  function line(x, y, ax, ay, bx, by, width, color) {
    if (distanceToSegment(x, y, ax, ay, bx, by) <= width) setPixel(x, y, color);
  }

  function circle(x, y, radius, color) {
    if (Math.hypot(x - center, y - center) <= radius) setPixel(x, y, color);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(x, y, background);
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      circle(x + 0.5, y + 0.5, diskRadius, disk);
    }
  }

  const stemX = center;
  const stemTop = size * 0.28;
  const stemBottom = size * 0.73;
  const lineWidth = Math.max(1.8, size * 0.018);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      line(x + 0.5, y + 0.5, stemX, stemBottom, stemX - size * 0.015, stemTop, lineWidth, gold);
      line(x + 0.5, y + 0.5, stemX, size * 0.52, size * 0.30, size * 0.42, lineWidth * 0.82, gold);
      line(x + 0.5, y + 0.5, stemX, size * 0.61, size * 0.70, size * 0.53, lineWidth * 0.82, gold);
      line(x + 0.5, y + 0.5, stemX, size * 0.67, size * 0.31, size * 0.64, lineWidth * 0.82, gold);
      line(x + 0.5, y + 0.5, stemX, size * 0.74, size * 0.69, size * 0.72, lineWidth * 0.82, gold);
    }
  }

  const grainRadius = size * 0.038;
  [
    [0.39, 0.36], [0.47, 0.30], [0.56, 0.32], [0.64, 0.39],
    [0.43, 0.47], [0.58, 0.51], [0.40, 0.60], [0.63, 0.65],
  ].forEach(([x, y]) => {
    for (let py = 0; py < size; py += 1) {
      for (let px = 0; px < size; px += 1) {
        if (Math.hypot(px + 0.5 - x * size, py + 0.5 - y * size) <= grainRadius) setPixel(px, py, gold);
      }
    }
  });

  // A small dark base keeps the mark legible when the icon is placed on a
  // light launcher background.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      line(x + 0.5, y + 0.5, center - size * 0.13, size * 0.77, center + size * 0.13, size * 0.77, lineWidth * 0.55, ink);
    }
  }

  const rawRows = [];
  for (let y = 0; y < size; y += 1) {
    rawRows.push(Buffer.from([0]));
    rawRows.push(pixels.subarray(y * size * 4, (y + 1) * size * 4));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const body = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rawRows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return body;
}

for (const size of [192, 512]) {
  for (const maskable of [false, true]) {
    const suffix = maskable ? "-maskable" : "";
    writeFileSync(new URL(`icon-${size}${suffix}.png`, outputDirectory), makePng(size, maskable));
  }
}
