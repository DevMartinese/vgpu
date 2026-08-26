import { draw, effect } from "vgpu";

import bloomBlurPairedWgsl from "../../bloom-blur-paired.wgsl";
import bloomBlurWgsl from "../../bloom-blur.wgsl";
import bloomCompositeWgsl from "../../bloom-composite.wgsl";
import bloomExtractWgsl from "../../bloom-extract.wgsl";
import { BLOOM_BLUR_SAMPLING } from "../../bloom-pairing";
import { BLOOM_LEVELS } from "../../bloom";
import copyLinearWgsl from "../../copy-linear.wgsl";
import dustWgsl from "../../dust.wgsl";
import glassBackWgsl from "../../glass-back.wgsl";
import glassWgsl from "../../glass.wgsl";
import lightWgsl from "../../light.wgsl";
import lightWireframeWgsl from "../../light-wireframe.wgsl";
import particleLightDownsampleWgsl from "../../particle-light-downsample.wgsl";
import presentWgsl from "../../present.wgsl";
import { ensurePrismWireframeGeometry } from "../../runtime/resources";
import type { PrismRuntime } from "../../runtime/types";
import wireframeWgsl from "../../wireframe.wgsl";
import copyPresentationWgsl from "./copy-presentation.wgsl";
import type { BloomBlurEffects, DarkPipelineGraph } from "./types";

export const DUST_PARTICLE_COUNT = 2200;

export function createDarkGraph(runtime: PrismRuntime): DarkPipelineGraph {
  const { gpu, label } = runtime;
  // Keep construction order stable: renderer lifecycle tests also assert this
  // inventory, making accidental dark graph changes explicit.
  const light = draw(gpu, {
    shader: lightWgsl,
    geometry: runtime.lightGeometry,
    blend: "additive",
    cull: "none",
    depth: false,
    label: `${label}.light`,
  });
  const copyBackground = effect(gpu, copyLinearWgsl, {
    label: `${label}.pass-b-copy-a`,
  });
  const bloomExtract = effect(gpu, bloomExtractWgsl, {
    label: `${label}.bloom-extract`,
  });
  const bloomBlur = Array.from({ length: BLOOM_LEVELS }, (_, level) => {
    const sampling = BLOOM_BLUR_SAMPLING[level]!;
    return {
      horizontal: effect(
        gpu,
        sampling.horizontal === "bilinear-pairs"
          ? bloomBlurPairedWgsl
          : bloomBlurWgsl,
        { label: `${label}.bloom-${level}-horizontal` }
      ),
      vertical: effect(
        gpu,
        sampling.vertical === "bilinear-pairs"
          ? bloomBlurPairedWgsl
          : bloomBlurWgsl,
        { label: `${label}.bloom-${level}-vertical` }
      ),
    };
  }) as unknown as BloomBlurEffects;
  const bloomComposite = effect(gpu, bloomCompositeWgsl, {
    label: `${label}.bloom-composite`,
  });
  const particleLightDownsample = effect(gpu, particleLightDownsampleWgsl, {
    label: `${label}.particle-light-downsample`,
  });
  const present = effect(gpu, presentWgsl, { label: `${label}.present` });
  const copyPresentation = effect(gpu, copyPresentationWgsl, {
    label: `${label}.copy-presentation`,
  });
  const glassBack = draw(gpu, {
    shader: glassBackWgsl,
    geometry: runtime.prism,
    cull: "front",
    depth: false,
    blend: "premultiplied",
    label: `${label}.glass-back`,
  });
  const glassFront = draw(gpu, {
    shader: glassWgsl,
    geometry: runtime.prism,
    cull: "back",
    depth: false,
    label: `${label}.glass-front`,
  });
  const dust = draw(gpu, {
    shader: dustWgsl,
    vertices: 6,
    instances: DUST_PARTICLE_COUNT,
    cull: "none",
    depth: false,
    blend: "additive",
    label: `${label}.dust`,
  });

  return {
    light,
    copyBackground,
    bloomExtract,
    bloomBlur,
    bloomComposite,
    particleLightDownsample,
    present,
    copyPresentation,
    glassBack,
    glassFront,
    dust,
  };
}

/** Creates debug-only draws when their controls are first enabled. */
export function ensureDarkWireframeDraws(
  graph: DarkPipelineGraph,
  runtime: PrismRuntime
): void {
  const { gpu, label } = runtime;
  if (runtime.controls.wireframe && !graph.wireframe) {
    graph.wireframe = draw(gpu, {
      shader: wireframeWgsl,
      geometry: ensurePrismWireframeGeometry(runtime),
      cull: "none",
      depth: false,
      blend: "premultiplied",
      label: `${label}.wireframe`,
    });
  }
  if (runtime.controls.lightWireframe && !graph.lightWireframe) {
    graph.lightWireframe = draw(gpu, {
      shader: lightWireframeWgsl,
      geometry: runtime.lightGeometry,
      cull: "none",
      depth: false,
      blend: "premultiplied",
      label: `${label}.light-wireframe`,
    });
  }
}
