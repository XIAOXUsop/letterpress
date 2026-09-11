import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { Canvas, encodePng } from './png.js';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 解析 PNG 的块结构。用来验证产物真的符合规范，而不只是「看起来像」。 */
function readChunks(buf: Buffer): { type: string; data: Buffer; crcOk: boolean }[] {
  const chunks: { type: string; data: Buffer; crcOk: boolean }[] = [];
  let offset = 8; // 跳过签名

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    const storedCrc = buf.readUInt32BE(offset + 8 + length);

    // 自己算一遍 CRC，验证写进去的是对的（写错了浏览器直接拒绝加载）
    let c = 0xffffffff;
    const crcInput = buf.subarray(offset + 4, offset + 8 + length);
    for (let i = 0; i < crcInput.length; i++) {
      c ^= crcInput[i]!;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    const crcOk = ((c ^ 0xffffffff) >>> 0) === storedCrc;

    chunks.push({ type, data: Buffer.from(data), crcOk });
    offset += 12 + length;
    if (type === 'IEND') break;
  }

  return chunks;
}

describe('encodePng', () => {
  const pixels = new Uint8Array(4 * 4 * 4); // 4×4 RGBA
  pixels.fill(200);

  it('以 PNG 签名开头', () => {
    const png = encodePng(4, 4, pixels);
    expect(png.subarray(0, 8).equals(SIGNATURE)).toBe(true);
  });

  it('块结构完整：IHDR → IDAT → IEND', () => {
    const chunks = readChunks(encodePng(4, 4, pixels));
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  /**
   * CRC 写错的话浏览器会直接拒绝加载整张图，而且报错信息
   * （「图片损坏」）完全指不出是 CRC 的问题。自己验一遍。
   */
  it('每个块的 CRC 都正确', () => {
    for (const chunk of readChunks(encodePng(4, 4, pixels))) {
      expect(chunk.crcOk, `${chunk.type} 的 CRC 不对`).toBe(true);
    }
  });

  it('IHDR 里的宽高与位深正确', () => {
    const [ihdr] = readChunks(encodePng(4, 7, new Uint8Array(4 * 7 * 4)));
    expect(ihdr).toBeDefined();
    const data = ihdr!.data;
    expect(data.readUInt32BE(0)).toBe(4); // 宽
    expect(data.readUInt32BE(4)).toBe(7); // 高
    expect(data.readUInt8(8)).toBe(8); // 位深
    expect(data.readUInt8(9)).toBe(6); // 颜色类型 6 = RGBA
    expect(data.readUInt8(12)).toBe(0); // 非隔行
  });

  it('像素数据经 zlib 压缩后可还原，且含每行的滤波字节', () => {
    const w = 3;
    const h = 2;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < px.length; i++) px[i] = i % 256;

    const chunks = readChunks(encodePng(w, h, px));
    const idat = chunks.find((c) => c.type === 'IDAT');
    expect(idat).toBeDefined();

    const raw = inflateSync(idat!.data);
    // 每行 = 1 字节滤波标志 + w*4 字节像素
    expect(raw.length).toBe((w * 4 + 1) * h);
    expect(raw[0]).toBe(0); // 第一行滤波标志
    expect(raw[w * 4 + 1]).toBe(0); // 第二行滤波标志
    // 第一行像素应与输入一致
    expect([...raw.subarray(1, 1 + w * 4)]).toEqual([...px.subarray(0, w * 4)]);
  });

  it('缓冲长度不符时抛错，而不是产出损坏的图', () => {
    expect(() => encodePng(4, 4, new Uint8Array(10))).toThrow(/长度不对/);
  });

  it('1×1 的极小图也能编码', () => {
    const png = encodePng(1, 1, new Uint8Array([1, 2, 3, 255]));
    expect(readChunks(png).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });
});

describe('Canvas', () => {
  it('构造时用背景色填满', () => {
    const canvas = new Canvas(2, 2, [10, 20, 30]);
    const png = canvas.toPng();
    const raw = inflateSync(readChunks(png).find((c) => c.type === 'IDAT')!.data);

    // 第一个像素
    expect([raw[1], raw[2], raw[3], raw[4]]).toEqual([10, 20, 30, 255]);
  });

  it('fillRect 会裁剪到画布范围内，不越界', () => {
    const canvas = new Canvas(4, 4, [0, 0, 0]);
    expect(() => canvas.fillRect(-10, -10, 100, 100, [255, 255, 255])).not.toThrow();
    expect(() => canvas.fillRect(3, 3, 50, 50, [255, 0, 0])).not.toThrow();
  });

  it('fillCircle 不越界', () => {
    const canvas = new Canvas(10, 10, [0, 0, 0]);
    expect(() => canvas.fillCircle(0, 0, 20, [255, 255, 255])).not.toThrow();
    expect(() => canvas.fillCircle(9, 9, 5, [255, 255, 255])).not.toThrow();
  });

  it('strokeCircle 不越界', () => {
    const canvas = new Canvas(10, 10, [0, 0, 0]);
    expect(() => canvas.strokeCircle(5, 5, 50, 4, [255, 255, 255])).not.toThrow();
  });

  it('画的图形真的改变了像素', () => {
    const canvas = new Canvas(8, 8, [0, 0, 0]);
    canvas.fillRect(2, 2, 4, 4, [255, 255, 255]);
    const raw = inflateSync(readChunks(canvas.toPng()).find((c) => c.type === 'IDAT')!.data);

    // 定位到 (3,3) 这个像素：跳过 3 行，再跳过 3 个像素
    const stride = 8 * 4 + 1;
    const idx = 3 * stride + 1 + 3 * 4;
    expect([raw[idx], raw[idx + 1], raw[idx + 2]]).toEqual([255, 255, 255]);

    // (0,0) 应保持背景色
    expect([raw[1], raw[2], raw[3]]).toEqual([0, 0, 0]);
  });
});
