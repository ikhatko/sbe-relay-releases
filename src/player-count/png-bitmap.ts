import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type BinaryBitmap = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function bytesPerPixelForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG color type: ${colorType}`);
  }
}

function decodeScanlines(
  inflated: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number
): Uint8Array {
  const stride = width * bytesPerPixel;
  const expectedLength = height * (stride + 1);
  if (inflated.length < expectedLength) {
    throw new Error("PNG data is truncated.");
  }

  const decoded = new Uint8Array(height * stride);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[sourceOffset] ?? 0;
    sourceOffset += 1;
    const rowOffset = y * stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x] ?? 0;
      const left = x >= bytesPerPixel ? decoded[rowOffset + x - bytesPerPixel] ?? 0 : 0;
      const up = y > 0 ? decoded[rowOffset + x - stride] ?? 0 : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? decoded[rowOffset + x - stride - bytesPerPixel] ?? 0 : 0;

      let value = raw;
      switch (filterType) {
        case 0:
          value = raw;
          break;
        case 1:
          value = (raw + left) & 0xff;
          break;
        case 2:
          value = (raw + up) & 0xff;
          break;
        case 3:
          value = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          value = (raw + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG filter type: ${filterType}`);
      }

      decoded[rowOffset + x] = value;
    }

    sourceOffset += stride;
  }

  return decoded;
}

function toBinaryBitmap(
  width: number,
  height: number,
  colorType: number,
  decoded: Uint8Array
): BinaryBitmap {
  const bytesPerPixel = bytesPerPixelForColorType(colorType);
  const pixels = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (y * width + x) * bytesPerPixel;
      let luminance = 0;
      let alpha = 255;

      switch (colorType) {
        case 0:
          luminance = decoded[pixelOffset] ?? 0;
          break;
        case 2: {
          const r = decoded[pixelOffset] ?? 0;
          const g = decoded[pixelOffset + 1] ?? 0;
          const b = decoded[pixelOffset + 2] ?? 0;
          luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          break;
        }
        case 4:
          luminance = decoded[pixelOffset] ?? 0;
          alpha = decoded[pixelOffset + 1] ?? 255;
          break;
        case 6: {
          const r = decoded[pixelOffset] ?? 0;
          const g = decoded[pixelOffset + 1] ?? 0;
          const b = decoded[pixelOffset + 2] ?? 0;
          alpha = decoded[pixelOffset + 3] ?? 255;
          luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          break;
        }
        default:
          throw new Error(`Unsupported PNG color type: ${colorType}`);
      }

      const binary = alpha < 8 ? 0 : luminance >= 128 ? 1 : 0;
      pixels[y * width + x] = binary;
    }
  }

  return { width, height, pixels };
}

export function decodePngBinaryFromBuffer(buffer: Buffer): BinaryBitmap {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Unsupported PNG signature.");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlaceMethod = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    offset += 4;
    const chunkData = buffer.subarray(offset, offset + length);
    offset += length;
    offset += 4;

    if (chunkType === "IHDR") {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8] ?? 0;
      colorType = chunkData[9] ?? 0;
      interlaceMethod = chunkData[12] ?? 0;
    } else if (chunkType === "IDAT") {
      idatChunks.push(chunkData);
    } else if (chunkType === "IEND") {
      break;
    }
  }

  if (width <= 0 || height <= 0) {
    throw new Error("PNG is missing a valid IHDR chunk.");
  }
  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  }
  if (interlaceMethod !== 0) {
    throw new Error("Interlaced PNGs are not supported.");
  }

  const bytesPerPixel = bytesPerPixelForColorType(colorType);
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const decoded = decodeScanlines(inflated, width, height, bytesPerPixel);
  return toBinaryBitmap(width, height, colorType, decoded);
}

export function decodePngBinaryFromBase64(base64: string): BinaryBitmap {
  return decodePngBinaryFromBuffer(Buffer.from(base64, "base64"));
}
