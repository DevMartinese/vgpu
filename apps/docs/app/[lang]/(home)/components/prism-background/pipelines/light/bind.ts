import { glassUniforms, sceneUniforms } from "../../runtime/uniforms";
import type { PrismRuntime } from "../../runtime/types";
import { lightGlassAccentUniforms } from "./glass-accent";
import { prismShadowUniforms } from "./shadow/tuning";
import {
  lightCausticUniforms,
  lightPresentUniforms,
  lightWallUniforms,
} from "./uniforms";
import type { LightPipelineGraph } from "./types";

export function bindLightGraph(
  graph: LightPipelineGraph,
  runtime: PrismRuntime
): void {
  const backdrop = graph.backdropHDR;
  const scene = graph.sceneHDR;
  const assets = graph.assets;
  const studio = runtime.studioEnvironment;
  const debug = runtime.debugEnvironment;
  if (!backdrop || !scene || !assets) {
    throw new Error(
      "prepare() must create light targets and assets before bind()."
    );
  }
  if (!studio || !debug) {
    throw new Error("prepare() must create prism environments before bind().");
  }
  const glassParams = glassUniforms(runtime, "light");
  graph.wall.set({
    params: lightWallUniforms(runtime),
    wallMaterial: assets.wallMaterial,
    wallLighting: assets.wallLighting,
    materialSampler: graph.materialSampler,
  });
  graph.prismShadow.set({
    shadow: prismShadowUniforms(runtime.view.viewProjection),
  });
  graph.caustic.set({
    scene: sceneUniforms(runtime),
    caustic: lightCausticUniforms(runtime),
    causticProfile: assets.causticProfile,
    causticSampler: graph.materialSampler,
    wallMaterial: assets.wallMaterial,
  });
  graph.glassBack.set({
    params: glassParams,
    studioEnvironment: studio.texture,
    debugEnvironment: debug.texture,
    environmentSampler: runtime.environmentSampler,
  });
  graph.copyBackdrop.set({ sceneTexture: backdrop });
  graph.glassFront.set({
    params: glassParams,
    sceneTexture: backdrop,
    sceneSampler: runtime.sceneSampler,
    studioEnvironment: studio.texture,
    debugEnvironment: debug.texture,
    environmentSampler: runtime.environmentSampler,
  });
  graph.glassAccent.set({
    params: glassParams,
    accent: lightGlassAccentUniforms(),
    studioEnvironment: studio.texture,
    debugEnvironment: debug.texture,
    environmentSampler: runtime.environmentSampler,
  });
  graph.wireframe.set({
    params: { viewProjection: runtime.view.viewProjection },
  });
  graph.lightWireframe.set({ scene: sceneUniforms(runtime) });
  graph.present.set({
    sceneTexture: scene,
    params: lightPresentUniforms(runtime),
  });
}
