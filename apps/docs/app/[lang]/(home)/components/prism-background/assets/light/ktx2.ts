const IDENTIFIER = [
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
];
const HEADER_BYTES = 80;
const LEVEL_BYTES = 24;
const VK_RGBA8_UNORM = 37;
const VK_RGBA8_SRGB = 43;

export interface Ktx2Level {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array<ArrayBuffer>;
}

export interface ParsedKtx2 {
  readonly format: "rgba8unorm" | "rgba8unorm-srgb";
  readonly levels: readonly Ktx2Level[];
}

function fail(reason: string): never {
  throw new Error(`Unsupported prism light KTX2: ${reason}`);
}

export function parseKtx2(source: ArrayBuffer): ParsedKtx2 {
  const bytes = new Uint8Array(source);
  if (bytes.byteLength < HEADER_BYTES) fail("truncated header");
  if (!IDENTIFIER.every((byte, index) => bytes[index] === byte)) {
    fail("invalid identifier");
  }
  const view = new DataView(source);
  const vkFormat = view.getUint32(12, true);
  const format =
    vkFormat === VK_RGBA8_UNORM
      ? "rgba8unorm"
      : vkFormat === VK_RGBA8_SRGB
      ? "rgba8unorm-srgb"
      : fail(`vkFormat ${vkFormat}; expected RGBA8`);
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const levelCount = view.getUint32(40, true);
  if (!width || !height || !levelCount) fail("zero-sized image or mip chain");
  if (view.getUint32(28, true) > 1) fail("3D texture");
  if (view.getUint32(32, true) > 1) fail("array texture");
  if (view.getUint32(36, true) !== 1) fail("non-2D face count");
  if (view.getUint32(44, true) !== 0)
    fail("supercompression requires a decoder");
  if (source.byteLength < HEADER_BYTES + levelCount * LEVEL_BYTES) {
    fail("truncated level index");
  }
  const levels = Array.from({ length: levelCount }, (_, level): Ktx2Level => {
    const entry = HEADER_BYTES + level * LEVEL_BYTES;
    const offset = Number(view.getBigUint64(entry, true));
    const length = Number(view.getBigUint64(entry + 8, true));
    const levelWidth = Math.max(1, width >> level);
    const levelHeight = Math.max(1, height >> level);
    if (
      length < levelWidth * levelHeight * 4 ||
      offset + length > source.byteLength
    ) {
      fail(`invalid mip ${level}`);
    }
    return {
      width: levelWidth,
      height: levelHeight,
      data: bytes.subarray(offset, offset + levelWidth * levelHeight * 4),
    };
  });
  return { format, levels };
}
