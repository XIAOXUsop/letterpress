/**
 * 最小 PNG 编码器。
 *
 * ── 为什么要自己写 ──────────────────────────────────────────────────
 *
 * 社交平台（微信、Twitter/X、Telegram、Slack）**不支持 SVG 作为 og:image**，
 * 所以分享卡片必须是 PNG 或 JPG。而把 SVG 光栅化成 PNG 的现成方案
 * （Satori + resvg、sharp）都是几十 MB 的原生依赖——
 * 对一个主张「依赖面小、十年后还能构建」的博客模板来说代价太大。
 *
 * 但我们要画的只是**矩形和圆**，不需要字体光栅化、不需要抗锯齿之外
 * 的任何东西。这种情况下手写一个编码器是划算的：约一百行，零依赖，
 * 压缩交给 Node 内置的 zlib。
 *
 * ── PNG 的最小结构 ──────────────────────────────────────────────────
 *
 *   签名(8 字节) → IHDR → IDAT → IEND
 *
 * 每个块都是「长度(4) + 类型(4) + 数据 + CRC32(4)」。
 * 像素数据按行存储，每行前面加一个滤波字节（0 = 不滤波），
 * 整体 zlib 压缩后放进 IDAT。
 */

import { deflateSync } from 'node:zlib';

/** PNG 文件签名，固定 8 字节。 */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC32 查表，惰性构建一次。 */
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(buf: Buffer): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (table[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** 组装一个 PNG 块：长度 + 类型 + 数据 + CRC。 */
function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  // CRC 覆盖类型和数据，不含长度字段
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([length, typeBuf, data, crc]);
}

/**
 * 把 RGBA 像素缓冲编码成 PNG。
 *
 * `rgba` 长度必须是 `width * height * 4`，顺序为 R,G,B,A。
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(
      `像素缓冲长度不对：期望 ${width * height * 4}，实际 ${rgba.length}`,
    );
  }

  // IHDR：宽、高、位深 8、颜色类型 6（RGBA）、压缩 0、滤波 0、隔行 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  // 每行前面加一个滤波字节 0（None）。
  // 用自适应滤波能把体积再压小一些，但那需要逐行试算五种滤波并比较结果，
  // 对一个封面图不值得——几何图形的 zlib 压缩率本来就高。
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 一块可绘制的画布。所有坐标是像素，原点在左上角。 */
export class Canvas {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8Array;

  constructor(width: number, height: number, background: readonly [number, number, number]) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
    this.fillRect(0, 0, width, height, background);
  }

  /** 用一个颜色填满一块矩形。会自动裁剪到画布范围内。 */
  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: readonly [number, number, number],
  ): void {
    const [r, g, b] = color;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));

    for (let py = y0; py < y1; py++) {
      let idx = (py * this.width + x0) * 4;
      for (let px = x0; px < x1; px++) {
        this.pixels[idx] = r;
        this.pixels[idx + 1] = g;
        this.pixels[idx + 2] = b;
        this.pixels[idx + 3] = 255;
        idx += 4;
      }
    }
  }

  /**
   * 画一个实心圆。
   *
   * 边缘做一次极简的抗锯齿：落在半径外一个像素内的点按距离做线性混合。
   * 不做的话圆边会有明显锯齿，而封面图里圆是主要元素之一。
   */
  fillCircle(
    cx: number,
    cy: number,
    radius: number,
    color: readonly [number, number, number],
  ): void {
    const [r, g, b] = color;
    const x0 = Math.max(0, Math.floor(cx - radius - 1));
    const y0 = Math.max(0, Math.floor(cy - radius - 1));
    const x1 = Math.min(this.width, Math.ceil(cx + radius + 1));
    const y1 = Math.min(this.height, Math.ceil(cy + radius + 1));

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius + 1) continue;

        // 距边缘 1px 内做线性过渡
        const alpha = dist <= radius ? 1 : 1 - (dist - radius);
        if (alpha <= 0) continue;

        const idx = (py * this.width + px) * 4;
        this.pixels[idx] = Math.round(r * alpha + this.pixels[idx]! * (1 - alpha));
        this.pixels[idx + 1] = Math.round(g * alpha + this.pixels[idx + 1]! * (1 - alpha));
        this.pixels[idx + 2] = Math.round(b * alpha + this.pixels[idx + 2]! * (1 - alpha));
        this.pixels[idx + 3] = 255;
      }
    }
  }

  /** 画一个圆环（描边圆）。 */
  strokeCircle(
    cx: number,
    cy: number,
    radius: number,
    lineWidth: number,
    color: readonly [number, number, number],
  ): void {
    const outer = radius + lineWidth / 2;
    const inner = radius - lineWidth / 2;

    const x0 = Math.max(0, Math.floor(cx - outer - 1));
    const y0 = Math.max(0, Math.floor(cy - outer - 1));
    const x1 = Math.min(this.width, Math.ceil(cx + outer + 1));
    const y1 = Math.min(this.height, Math.ceil(cy + outer + 1));

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > outer + 1 || dist < inner - 1) continue;

        // 内外各留 1px 过渡
        let alpha = 1;
        if (dist > outer) alpha = 1 - (dist - outer);
        else if (dist < inner) alpha = 1 - (inner - dist);
        if (alpha <= 0) continue;

        const idx = (py * this.width + px) * 4;
        this.pixels[idx] = Math.round(color[0] * alpha + this.pixels[idx]! * (1 - alpha));
        this.pixels[idx + 1] = Math.round(color[1] * alpha + this.pixels[idx + 1]! * (1 - alpha));
        this.pixels[idx + 2] = Math.round(color[2] * alpha + this.pixels[idx + 2]! * (1 - alpha));
        this.pixels[idx + 3] = 255;
      }
    }
  }

  /** 编码成 PNG 字节。 */
  toPng(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}
