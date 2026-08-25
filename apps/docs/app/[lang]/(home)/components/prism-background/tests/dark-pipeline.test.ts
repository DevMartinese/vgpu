import { describe, expect, test } from "vitest";
import { init, target } from "vgpu/mock";

import { PRISM_DARK_DEBUG_SOURCE_IDS } from "../debug/sources";
import type { EnvironmentTexture } from "../environment-texture";
import { createDarkPipeline } from "../pipelines/dark";
import { createPrismRuntime, destroyPrismRuntime } from "../runtime/resources";

describe("dark pipeline debug targets", () => {
  test("resolves retained production targets without changing the render graph", async () => {
    const gpu = await init();
    const runtime = createPrismRuntime(gpu, [24, 16], "dark-debug-test");
    const environment = () =>
      ({
        texture: gpu.device.createTexture({
          size: [2, 1],
          format: "rgba16float",
          usage: ["texture_binding", "copy_dst"],
        }),
        prepared: true,
      } as EnvironmentTexture);
    runtime.studioEnvironment = environment();
    runtime.debugEnvironment = environment();
    runtime.environmentReady = Promise.resolve();
    const output = target(gpu, { size: [24, 16], format: "rgba8unorm" });
    const pipeline = createDarkPipeline(runtime);

    try {
      expect(pipeline.debugSources?.().map(({ id }) => id)).toEqual(
        PRISM_DARK_DEBUG_SOURCE_IDS
      );
      expect(pipeline.debugTarget("dark-backdrop-hdr")).toBeUndefined();
      await pipeline.prepare(output);

      expect(pipeline.debugTarget("dark-backdrop-hdr")?.primary).toBe(
        pipeline.targets.backdropHDR
      );
      expect(pipeline.debugTarget("dark-scene-hdr")?.primary).toBe(
        pipeline.targets.sceneHDR
      );
      expect(pipeline.debugTarget("dark-front-glass")).toEqual({
        primary: pipeline.targets.sceneHDR,
        secondary: pipeline.targets.backdropHDR,
        mode: "difference",
        differenceGain: 5,
      });

      const bloom0 = pipeline.debugTarget("dark-bloom-0")?.primary;
      const bloom1 = pipeline.debugTarget("dark-bloom-1")?.primary;
      const bloom2 = pipeline.debugTarget("dark-bloom-2")?.primary;
      const composite = pipeline.debugTarget("dark-bloom-composite")?.primary;
      const particle = pipeline.debugTarget("dark-particle-light")?.primary;
      expect(bloom0?.size).toEqual([12, 8]);
      expect(bloom1?.size).toEqual([6, 4]);
      expect(bloom2?.size).toEqual([3, 2]);
      expect(composite?.size).toEqual([12, 8]);
      expect(composite).not.toBe(bloom0);
      expect(particle?.size).toEqual([2, 1]);
      expect(pipeline.debugTarget("dark-bloom-3")).toBeUndefined();
      expect(pipeline.debugTarget("missing")).toBeUndefined();
    } finally {
      pipeline.destroy();
      destroyPrismRuntime(runtime);
      gpu.dispose();
    }
  });
});
