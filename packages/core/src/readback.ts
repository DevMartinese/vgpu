import { ValidationError } from "./errors.ts";
import { bufferUsageFlags, mapReadMode } from "./gpu-constants.ts";
import { isMockGPUBuffer } from "./mock-gpu-storage.ts";

const stagingUsage = bufferUsageFlags(["copy_dst", "map_read"]);

export class Readback {
  constructor(private readonly device: GPUDevice) {}

  async read(source: GPUBuffer, byteLength: number, offset: number): Promise<ArrayBuffer> {
    if (isMockGPUBuffer(source)) {
      return source.__vgpuMockBytes.slice(offset, offset + byteLength).buffer;
    }

    const staging = this.device.createBuffer({
      size: byteLength,
      usage: stagingUsage,
    });
    // Every exit path destroys the staging buffer: on device loss mapAsync rejects (and unmap can throw),
    // and a skipped destroy would leak one buffer per read for the lifetime of the device.
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(source, offset, staging, 0, byteLength);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(mapReadMode());
      const copy = staging.getMappedRange().slice(0);
      unmapQuietly(staging);
      return copy;
    } finally {
      destroyQuietly(staging);
    }
  }

  async readTexture(texture: GPUTexture, size: readonly [number, number, number?], format: GPUTextureFormat): Promise<Uint8Array> {
    const [width, height] = size;
    const formatInfo = readbackFormatInfo(format);
    const bytesPerPixel = formatInfo.bytesPerPixel;
    const bytesPerRow = align(width * bytesPerPixel, 256);
    const byteLength = bytesPerRow * height;
    const staging = this.device.createBuffer({ size: byteLength, usage: stagingUsage });
    // Same contract as read(): unmap is best-effort, destroy is guaranteed even when the device is lost.
    let pixels: Uint8Array;
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow, rowsPerImage: height }, { width, height });
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(mapReadMode());
      const padded = new Uint8Array(staging.getMappedRange());
      pixels = new Uint8Array(width * height * bytesPerPixel);
      for (let y = 0; y < height; y++) {
        const src = y * bytesPerRow;
        const dst = y * width * bytesPerPixel;
        pixels.set(padded.subarray(src, src + width * bytesPerPixel), dst);
      }
      unmapQuietly(staging);
    } finally {
      destroyQuietly(staging);
    }
    if (formatInfo.swizzle === "bgra-to-rgba") swizzleBgraToRgba(pixels);
    return pixels;
  }

  destroy(): void {}
}

/** Best-effort: a lost device rejects/throws on unmap, and the buffer is destroyed right after anyway. */
function unmapQuietly(buffer: GPUBuffer): void {
  try { buffer.unmap(); }
  catch { /* device lost or already unmapped: destroy still releases the buffer */ }
}

/** Guaranteed release: never let a cleanup failure replace the original error (or the returned data). */
function destroyQuietly(buffer: GPUBuffer): void {
  try { buffer.destroy(); }
  catch { /* device lost: the buffer dies with the device */ }
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

type ReadbackFormatInfo = { readonly bytesPerPixel: number; readonly swizzle?: "bgra-to-rgba" };

function readbackFormatInfo(format: GPUTextureFormat): ReadbackFormatInfo {
  if (format === "rgba8unorm" || format === "rgba8unorm-srgb") return { bytesPerPixel: 4 };
  if (format === "bgra8unorm" || format === "bgra8unorm-srgb") return { bytesPerPixel: 4, swizzle: "bgra-to-rgba" };
  throw new ValidationError({
    code: "VGPU-CORE-UNSUPPORTED-FORMAT",
    message: `Texture.read does not support format ${format}`,
    where: "Readback.readTexture",
  });
}

function swizzleBgraToRgba(pixels: Uint8Array): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const b = pixels[i]!;
    pixels[i] = pixels[i + 2]!;
    pixels[i + 2] = b;
  }
}
