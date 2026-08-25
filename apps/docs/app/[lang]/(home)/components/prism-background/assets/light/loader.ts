import type { Gpu } from "vgpu";
import type { Texture } from "vgpu/core";

import { parseKtx2, type Ktx2Level } from "./ktx2";
import { LIGHT_ASSET_IDS, LIGHT_ASSET_MANIFEST } from "./manifest";
import { generateMipChain } from "./mips";
import type {
  GeneratedLightAsset,
  LightAssetId,
  LightAssetSpec,
  LightAssetTextures,
} from "./types";

export interface LightTextureLoader {
  load(gpu: Gpu, spec: LightAssetSpec): Promise<Texture>;
}

export interface LightTextureLoaderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly fallback?: (
    id: LightAssetId
  ) => GeneratedLightAsset | Promise<GeneratedLightAsset>;
}

export function createLightTextureLoader(
  options: LightTextureLoaderOptions = {}
): LightTextureLoader {
  const fetchAsset = options.fetch ?? globalThis.fetch?.bind(globalThis);
  return {
    async load(gpu, spec) {
      let encoded: ReturnType<typeof parseKtx2> | undefined;
      if (fetchAsset) {
        try {
          const response = await fetchAsset(spec.url);
          if (!response.ok)
            throw new Error(`${response.status} ${response.statusText}`);
          encoded = parseKtx2(await response.arrayBuffer());
          const base = encoded.levels[0]!;
          if (base.width !== spec.size[0] || base.height !== spec.size[1]) {
            throw new Error(
              `${spec.id} is ${base.width}x${
                base.height
              }; expected ${spec.size.join("x")}`
            );
          }
        } catch {
          // The procedural source remains a deterministic recovery path. The
          // art-directed global wall mask is packed into the committed KTX.
        }
      }
      // Keep GPU failures outside the fetch/decode fallback. If upload fails,
      // retrying the same bytes would only allocate another doomed texture.
      if (encoded) return upload(gpu, spec.id, encoded.format, encoded.levels);
      // The generator pulls in CPU noise and spectral math. Keep that code in
      // a recovery-only chunk when the committed KTX2 asset serves normally.
      const generated = options.fallback
        ? await options.fallback(spec.id)
        : (await import("./generate")).generateLightAsset(spec.id);
      const levels = generateMipChain(generated).map((level) => ({
        width: level.width,
        height: level.height,
        data: level.pixels,
      }));
      return upload(gpu, spec.id, "rgba8unorm", levels);
    },
  };
}

export async function loadLightAssetTextures(
  gpu: Gpu,
  loader: LightTextureLoader = createLightTextureLoader()
): Promise<LightAssetTextures> {
  const settled = await Promise.allSettled(
    LIGHT_ASSET_IDS.map((id) => loader.load(gpu, LIGHT_ASSET_MANIFEST[id]))
  );
  const failure = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (failure) {
    for (const result of settled) {
      if (result.status === "fulfilled") result.value.destroy();
    }
    throw failure.reason;
  }
  const loaded = settled.map(
    (result) => (result as PromiseFulfilledResult<Texture>).value
  );
  return {
    wallMaterial: loaded[0]!,
    wallLighting: loaded[1]!,
    causticProfile: loaded[2]!,
  };
}

function upload(
  gpu: Gpu,
  id: LightAssetId,
  format: GPUTextureFormat,
  levels: readonly Pick<Ktx2Level, "width" | "height" | "data">[]
): Texture {
  const base = levels[0]!;
  const texture = gpu.device.createTexture({
    size: [base.width, base.height],
    format,
    mipLevelCount: levels.length,
    usage: ["texture_binding", "copy_dst"],
    label: `prism.light.${id}`,
  });
  try {
    levels.forEach((level, mipLevel) => {
      gpu.gpu.queue.writeTexture(
        { texture: texture.gpu, mipLevel },
        level.data,
        { bytesPerRow: level.width * 4, rowsPerImage: level.height },
        [level.width, level.height, 1]
      );
    });
  } catch (error) {
    texture.destroy();
    throw error;
  }
  return texture;
}

export function destroyLightAssetTextures(
  textures: LightAssetTextures | undefined
): void {
  if (!textures) return;
  textures.wallMaterial.destroy();
  textures.wallLighting.destroy();
  textures.causticProfile.destroy();
}
