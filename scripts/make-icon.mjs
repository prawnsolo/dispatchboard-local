import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src-tauri/icons')
mkdirSync(dir, { recursive: true })

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const t = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

/** Solid Tiger Red square. No wordmark, no animal mark. */
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const i = row + 1 + x * 4
      raw[i] = 0xcc
      raw[i + 1] = 0
      raw[i + 2] = 0
      raw[i + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  const parts = [header, dir]
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const e = i * 16
    dir[e] = img.size >= 256 ? 0 : img.size
    dir[e + 1] = img.size >= 256 ? 0 : img.size
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(img.png.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += img.png.length
    parts.push(img.png)
  }
  return Buffer.concat(parts)
}

const sizes = [32, 128, 256, 512]
const encoded = new Map(sizes.map((size) => [size, png(size)]))
writeFileSync(path.join(dir, '32x32.png'), encoded.get(32))
writeFileSync(path.join(dir, '128x128.png'), encoded.get(128))
writeFileSync(path.join(dir, '128x128@2x.png'), encoded.get(256))
writeFileSync(path.join(dir, 'icon.png'), encoded.get(512))
writeFileSync(
  path.join(dir, 'icon.ico'),
  ico([
    { size: 32, png: encoded.get(32) },
    { size: 256, png: encoded.get(256) },
  ]),
)
console.log('wrote icons in', dir)
