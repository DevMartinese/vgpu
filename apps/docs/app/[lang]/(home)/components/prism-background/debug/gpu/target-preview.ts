import type { Effect, Frame, Gpu, Target } from "vgpu";
import { effect } from "vgpu";

import type { PrismRuntime } from "../../runtime/types";
import type { PrismDebugSourceId } from "../sources";
import previewWgsl from "./preview.wgsl";
import type { DebuggableLightPipeline } from "./types";

export interface TargetPreviewRenderer {
  drawableFor(sourceId: PrismDebugSourceId): Effect;
  render(
    current: Frame,
    output: Target,
    sourceId: PrismDebugSourceId,
    pipeline: DebuggableLightPipeline
  ): boolean;
}

export function createTargetPreviewRenderer(
  gpu: Gpu,
  runtime: PrismRuntime
): TargetPreviewRenderer {
  const tone = effect(gpu, previewWgsl, {
    label: "prism.debug.target-preview.tone",
  });
  const difference = effect(gpu, previewWgsl, {
    label: "prism.debug.target-preview.difference",
  });
  return {
    drawableFor(sourceId) {
      return sourceId === "front-glass" ? difference : tone;
    },
    render(current, output, sourceId, pipeline) {
      const input = targetInputs(sourceId, pipeline);
      if (!input) return false;
      const drawable = input.difference ? difference : tone;
      drawable.set({
        primaryTexture: input.primary,
        secondaryTexture: input.secondary,
        previewSampler: runtime.sceneSampler,
        params: {
          mode: input.difference ? 1 : 0,
          exposure: input.exposure,
          differenceGain: input.difference ? 5 : 1,
          _padding: 0,
        },
      });
      current.pass({ target: output, clear: [0, 0, 0, 1] }, (pass) => {
        pass.draw(drawable);
      });
      return true;
    },
  };
}

function targetInputs(
  sourceId: PrismDebugSourceId,
  pipeline: DebuggableLightPipeline
): {
  readonly primary: Target;
  readonly secondary: Target;
  readonly difference: boolean;
  readonly exposure: number;
} | undefined {
  const backdrop = pipeline.targets.backdropHDR;
  const scene = pipeline.targets.sceneHDR;
  if (sourceId === "backdrop-hdr" && backdrop) {
    return { primary: backdrop, secondary: backdrop, difference: false, exposure: 1 };
  }
  if ((sourceId === "scene-hdr" || sourceId === "final-output") && scene) {
    return { primary: scene, secondary: scene, difference: false, exposure: 1 };
  }
  if (sourceId === "front-glass" && scene && backdrop) {
    return { primary: scene, secondary: backdrop, difference: true, exposure: 1 };
  }
  return undefined;
}
