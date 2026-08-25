import type { Texture } from "vgpu/core";

export type LightAssetId =
  | "wall-material"
  | "wall-lighting"
  | "caustic-profile";

export interface LightAssetSpec {
  readonly id: LightAssetId;
  readonly url: string;
  readonly size: readonly [number, number];
  readonly colorSpace: "linear";
}

export interface GeneratedLightAsset {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array<ArrayBuffer>;
}

export interface LightAssetTextures {
  readonly wallMaterial: Texture;
  readonly wallLighting: Texture;
  readonly causticProfile: Texture;
}
