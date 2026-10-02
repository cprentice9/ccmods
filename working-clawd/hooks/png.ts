// A small PNG encoder for pixel art, since the mod has no zlib. It scales the
// picture up by a whole number with hard edges, so the terminal hardly
// stretches it and nothing blurs, then compresses only runs of one byte. The
// scaled picture is almost all runs, so it shrinks to a few percent.

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]

// One deflate block with the fixed codes: each byte as a literal, and each
// run of it after the first as copies of the byte before.
const deflate = (data: Uint8Array) => {
  const out: number[] = []
  let acc = 0
  let bits = 0
  const put = (value: number, n: number) => {
    acc |= value << bits
    bits += n
    while (bits >= 8) {
      out.push(acc & 0xff)
      acc >>>= 8
      bits -= 8
    }
  }
  // Codes go most significant bit first, the reverse of everything else.
  const code = (value: number, n: number) => {
    let reversed = 0
    for (let k = 0; k < n; k++) reversed |= ((value >> k) & 1) << (n - 1 - k)
    put(reversed, n)
  }
  const symbol = (s: number) => {
    if (s < 144) code(0x30 + s, 8)
    else if (s < 256) code(0x190 + s - 144, 9)
    else if (s < 280) code(s - 256, 7)
    else code(0xc0 + s - 280, 8)
  }
  put(1, 1)
  put(1, 2)
  for (let i = 0; i < data.length; ) {
    const b = data[i]!
    symbol(b)
    let run = 0
    while (data[i + 1 + run] === b) run++
    i += 1
    while (run >= 3) {
      const length = Math.min(run, 258)
      let k = LENGTH_BASE.length - 1
      while (LENGTH_BASE[k]! > length) k--
      symbol(257 + k)
      put(length - LENGTH_BASE[k]!, LENGTH_EXTRA[k]!)
      code(0, 5)
      run -= length
      i += length
    }
  }
  symbol(256)
  if (bits > 0) out.push(acc & 0xff)
  return out
}

const adler32 = (data: Uint8Array) => {
  let a = 1
  let b = 0
  for (const byte of data) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const chunk = (type: string, data: number[]) => {
  const body = new Uint8Array([...type].map(c => c.charCodeAt(0)).concat(data))
  return [...u32(data.length), ...body, ...u32(crc32(body))]
}

// RGBA pixels, `width` by `height`, as a base64 PNG `scale` times larger. Each
// pixel's first column takes its difference from the one before (the Sub
// filter) and the rest of its copies are zeros; each repeated row is all zeros
// against the row above (the Up filter).
export const encodePng = (rgba: Uint8Array, width: number, height: number, scale: number) => {
  const wide = width * scale
  const line = 1 + wide * 3
  const raw = new Uint8Array(line * height * scale)
  for (let y = 0; y < height; y++) {
    const at = y * scale * line
    raw[at] = 1
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const before = x > 0 ? rgba[(y * width + x - 1) * 4 + c]! : 0
        raw[at + 1 + x * scale * 3 + c] = (rgba[(y * width + x) * 4 + c]! - before) & 0xff
      }
    }
    for (let k = 1; k < scale; k++) raw[at + k * line] = 2
  }
  const zlib = [0x78, 0x01, ...deflate(raw), ...u32(adler32(raw))]
  const header = [...u32(wide), ...u32(height * scale), 8, 2, 0, 0, 0]
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', header), ...chunk('IDAT', zlib), ...chunk('IEND', [])]
  return new Uint8Array(png).toBase64()
}
