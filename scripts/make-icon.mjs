#!/usr/bin/env node
/**
 * Writes the placeholder app icon build/icon.png (1024×1024): an orange rounded square
 * with a white "H", like the logo in the app. No dependencies — plain PNG encoding.
 * electron-builder turns it into icon.icns. Replace build/icon.png with the real icon later.
 *
 *   node scripts/make-icon.mjs
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIZE = 1024
// macOS icon grid: the body is 824×824, centered, corner radius ~185.
const BODY = 824
const OFFSET = (SIZE - BODY) / 2
const RADIUS = 185
const ORANGE = [207, 86, 4]
const WHITE = [255, 255, 255]

/** Coverage (0–1) of the rounded square at pixel (x, y), 4×4 supersampled. */
function bodyCoverage(x, y) {
  let hits = 0
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4 - OFFSET
      const py = y + (sy + 0.5) / 4 - OFFSET
      if (px < 0 || py < 0 || px > BODY || py > BODY) continue
      const cx = Math.min(Math.max(px, RADIUS), BODY - RADIUS)
      const cy = Math.min(Math.max(py, RADIUS), BODY - RADIUS)
      if ((px - cx) ** 2 + (py - cy) ** 2 <= RADIUS ** 2) hits++
    }
  }
  return hits / 16
}

// "H": two stems and a bar (rectangles in canvas coordinates).
const STEM_W = 110
const H_HEIGHT = 440
const H_WIDTH = 380
const top = (SIZE - H_HEIGHT) / 2
const left = (SIZE - H_WIDTH) / 2
const rects = [
  [left, top, STEM_W, H_HEIGHT],
  [left + H_WIDTH - STEM_W, top, STEM_W, H_HEIGHT],
  [left, top + H_HEIGHT / 2 - 50, H_WIDTH, 100]
]
const inH = (x, y) =>
  rects.some(([rx, ry, rw, rh]) => x >= rx && x < rx + rw && y >= ry && y < ry + rh)

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1)
  raw[row] = 0 // filter: none
  for (let x = 0; x < SIZE; x++) {
    const coverage = bodyCoverage(x, y)
    const color = inH(x, y) ? WHITE : ORANGE
    const i = row + 1 + x * 4
    raw[i] = color[0]
    raw[i + 1] = color[1]
    raw[i + 2] = color[2]
    raw[i + 3] = Math.round(coverage * 255)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
const out = path.join(import.meta.dirname, '..', 'build', 'icon.png')
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes)`)
