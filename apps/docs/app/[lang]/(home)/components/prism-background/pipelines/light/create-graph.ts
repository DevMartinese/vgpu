import { draw, effect, sampler } from "vgpu";

import copyLinearWgsl from "../../copy-linear.wgsl";
import glassBackWgsl from "../../glass-back.wgsl";
import glassWgsl from "../../glass.wgsl";
import lightWireframeWgsl from "../../light-wireframe.wgsl";
import causticWgsl from "../../materials/light/caustic.wgsl";
import glassAccentWgsl from "../../materials/light/glass-accent.wgsl";
import presentWgsl from "../../materials/light/present.wgsl";
import shadowWgsl from "../../materials/light/shadow.wgsl";
import wallWgsl from "../../materials/light/wall.wgsl";
import type { PrismRuntime } from "../../runtime/types";
import wireframeWgsl from "../../wireframe.wgsl";
import { createPrismShadowGeometry } from "./shadow/tuning";
import type { LightPipelineGraph } from "./types";

export function createLightGraph(runtime: PrismRuntime): LightPipelineGraph {
  const { gpu, label } = runtime;
  const prismShadowGeometry = createPrismShadowGeometry(
    gpu,
    `${label}.light.prism-shadow-geometry`
  );
  return {
    wall: draw(gpu, {
      shader: wallWgsl,
      vertices: 6,
      cull: "back",
      depth: false,
      label: `${label}.light.wall`,
    }),
    prismShadowGeometry,
    prismShadow: draw(gpu, {
      shader: shadowWgsl,
      geometry: prismShadowGeometry,
      blend: "premultiplied",
      cull: "none",
      depth: false,
      label: `${label}.light.prism-cast-shadow`,
    }),
    caustic: draw(gpu, {
      shader: causticWgsl,
      geometry: runtime.lightGeometry,
      blend: "additive",
      cull: "none",
      depth: false,
      label: `${label}.light.projected-caustic`,
    }),
    glassBack: draw(gpu, {
      shader: glassBackWgsl,
      geometry: runtime.prism,
      cull: "front",
      depth: false,
      blend: "premultiplied",
      label: `${label}.light.glass-back`,
    }),
    copyBackdrop: effect(gpu, copyLinearWgsl, {
      label: `${label}.light.copy-backdrop`,
    }),
    glassFront: draw(gpu, {
      shader: glassWgsl,
      geometry: runtime.prism,
      cull: "back",
      depth: false,
      label: `${label}.light.glass-front`,
    }),
    glassAccent: draw(gpu, {
      shader: glassAccentWgsl,
      geometry: runtime.prism,
      cull: "back",
      depth: false,
      blend: "premultiplied",
      label: `${label}.light.glass-accent`,
    }),
    wireframe: draw(gpu, {
      shader: wireframeWgsl,
      geometry: runtime.prismWireframe,
      cull: "none",
      depth: false,
      blend: "premultiplied",
      label: `${label}.light.wireframe`,
    }),
    lightWireframe: draw(gpu, {
      shader: lightWireframeWgsl,
      geometry: runtime.lightGeometry,
      cull: "none",
      depth: false,
      blend: "premultiplied",
      label: `${label}.light.light-wireframe`,
    }),
    present: effect(gpu, presentWgsl, {
      label: `${label}.light.present`,
    }),
    materialSampler: sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      mipmapFilter: "linear",
      // Material coordinates are world-space and intentionally repeat. Shadow
      // lookups clamp their UVs explicitly before sharing this sampler.
      addressModeU: "repeat",
      addressModeV: "repeat",
    }),
  };
}
