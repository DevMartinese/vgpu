import type { LightAssetId, LightAssetSpec } from "./types";

export const LIGHT_ASSET_MANIFEST = {
  "wall-material": {
    id: "wall-material",
    url: "/hero/prism-light/wall-material.ktx2",
    size: [512, 512],
    colorSpace: "linear",
  },
  "wall-lighting": {
    id: "wall-lighting",
    url: "/hero/prism-light/wall-lighting.ktx2",
    size: [512, 512],
    colorSpace: "linear",
  },
  "caustic-profile": {
    id: "caustic-profile",
    url: "/hero/prism-light/caustic-profile.ktx2",
    size: [1024, 256],
    colorSpace: "linear",
  },
} as const satisfies Record<LightAssetId, LightAssetSpec>;

export const LIGHT_ASSET_IDS = Object.freeze(
  Object.keys(LIGHT_ASSET_MANIFEST) as LightAssetId[]
);
