import type { Bundle, Draw, Effect, Geometry, Target } from "vgpu";

import type { LightAssetTextures } from "../../assets/light/types";

export interface LightPipelineGraph {
  readonly wall: Draw;
  readonly prismShadow: Draw;
  readonly prismShadowGeometry: Geometry;
  readonly caustic: Draw;
  readonly glassBack: Draw;
  readonly copyBackdrop: Effect;
  readonly glassFront: Draw;
  readonly glassAccent: Draw;
  wireframe?: Draw;
  lightWireframe?: Draw;
  readonly present: Effect;
  readonly materialSampler: GPUSampler;
  assets?: LightAssetTextures;
  backdropBundle?: Bundle;
  backdropHDR?: Target;
  sceneHDR?: Target;
}
