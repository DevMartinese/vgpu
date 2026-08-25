import type { Target } from "vgpu";

import {
  createLightTextureLoader,
  destroyLightAssetTextures,
  loadLightAssetTextures,
  type LightTextureLoader,
} from "../../assets/light/loader";
import { PRISM_DEBUG_SOURCES } from "../../debug/sources";
import { prepareRuntimeEnvironment } from "../../runtime/resources";
import { resizeRuntime } from "../../runtime/state";
import type { PrismRuntime } from "../../runtime/types";
import type {
  PrismDebugTargetPreview,
  PrismOutput,
  PrismPipeline,
} from "../types";
import { bindLightGraph } from "./bind";
import { recordLightBackdropBundle } from "./bundles";
import { createLightGraph } from "./create-graph";
import { renderLightGraph } from "./render";
import {
  destroyLightTargets,
  ensureLightTargets,
  resizeLightTargets,
} from "./targets";
import type { LightPipelineGraph } from "./types";
import type { LightDebugDraws } from "./debug-draws";

export interface LightPipelineOptions {
  readonly assetLoader?: LightTextureLoader;
}

export interface LightPrismPipeline extends PrismPipeline {
  readonly mode: "light";
  readonly targets: {
    readonly backdropHDR?: Target;
    readonly sceneHDR?: Target;
  };
  debugTarget(sourceId: string): PrismDebugTargetPreview | undefined;
  /** Dynamically imports preview shaders; never called by the production path. */
  createDebugDraws(): Promise<LightDebugDraws>;
}

export function createLightPipeline(
  runtime: PrismRuntime,
  options: LightPipelineOptions = {}
): LightPrismPipeline {
  const graph = createLightGraph(runtime);
  const loader = options.assetLoader ?? createLightTextureLoader();
  let destroyed = false;
  let debugDraws: LightDebugDraws | undefined;
  let debugDrawsPromise: Promise<LightDebugDraws> | undefined;
  return {
    mode: "light",
    get targets() {
      return { backdropHDR: graph.backdropHDR, sceneHDR: graph.sceneHDR };
    },
    async prepare(output) {
      if (destroyed)
        throw new Error("Cannot prepare a destroyed light pipeline.");
      resizeRuntime(runtime, output.size);
      ensureLightTargets(graph, runtime, output.size);
      const environmentReady = prepareRuntimeEnvironment(runtime);
      const ownedAssets = graph.assets;
      const assetsReady = ownedAssets
        ? Promise.resolve(ownedAssets)
        : loadLightAssetTextures(runtime.gpu, loader);
      // Both branches continue touching the shared GPU after their first
      // await. Do not let one rejection release the runtime underneath its
      // still-running sibling. Asset failure keeps the old sequential error
      // precedence, while an environment failure releases newly-loaded files
      // before it escapes.
      const [assetsResult, environmentResult] = await Promise.allSettled([
        assetsReady,
        environmentReady,
      ]);
      const loaded =
        assetsResult.status === "fulfilled" ? assetsResult.value : undefined;
      if (destroyed) {
        if (!ownedAssets) destroyLightAssetTextures(loaded);
        return;
      }
      if (assetsResult.status === "rejected") throw assetsResult.reason;
      if (environmentResult.status === "rejected") {
        if (!ownedAssets) destroyLightAssetTextures(loaded);
        throw environmentResult.reason;
      }
      graph.assets = loaded;
      bindLightGraph(graph, runtime);
      await Promise.all(compileGraph(graph, output));
      if (destroyed) return;
      recordLightBackdropBundle(graph, runtime);
    },
    resize(size) {
      if (destroyed) return;
      resizeLightTargets(graph, size);
    },
    bind() {
      if (destroyed) return;
      bindLightGraph(graph, runtime);
      debugDraws?.bind();
    },
    render(currentFrame, output, renderOptions) {
      renderLightGraph(currentFrame, graph, runtime, output, renderOptions);
    },
    debugSources: () => PRISM_DEBUG_SOURCES,
    debugTarget(sourceId) {
      return resolveLightDebugTarget(graph, sourceId);
    },
    async createDebugDraws() {
      if (destroyed)
        throw new Error(
          "Cannot create previews for a destroyed light pipeline."
        );
      if (!graph.assets)
        throw new Error(
          "prepare() must load light assets before debug previews."
        );
      debugDrawsPromise ??= import("./debug-draws").then(
        ({ createLightDebugDraws }) => {
          if (destroyed)
            throw new Error(
              "Cannot create previews for a destroyed light pipeline."
            );
          debugDraws = createLightDebugDraws(runtime, graph);
          return debugDraws;
        }
      );
      try {
        return await debugDrawsPromise;
      } catch (error) {
        debugDrawsPromise = undefined;
        throw error;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      debugDraws = undefined;
      debugDrawsPromise = undefined;
      destroyLightTargets(graph);
      graph.prismShadowGeometry.destroy();
      destroyLightAssetTextures(graph.assets);
      graph.assets = undefined;
    },
  };
}

function resolveLightDebugTarget(
  graph: LightPipelineGraph,
  sourceId: string
): PrismDebugTargetPreview | undefined {
  const backdrop = graph.backdropHDR;
  const scene = graph.sceneHDR;
  if (sourceId === "backdrop-hdr" && backdrop) return { primary: backdrop };
  if ((sourceId === "scene-hdr" || sourceId === "final-output") && scene)
    return { primary: scene };
  if (sourceId === "front-glass" && scene && backdrop) {
    return {
      primary: scene,
      secondary: backdrop,
      mode: "difference",
      differenceGain: 5,
    };
  }
  return undefined;
}

function compileGraph(
  graph: LightPipelineGraph,
  output: PrismOutput
): Promise<unknown>[] {
  const backdrop = graph.backdropHDR!;
  const scene = graph.sceneHDR!;
  const outputSignature = { colors: [output.format] } as const;
  return [
    graph.wall.compile(backdrop),
    graph.prismShadow.compile(backdrop),
    graph.caustic.compile(backdrop),
    graph.glassBack.compile(backdrop),
    graph.lightWireframe.compile(backdrop),
    graph.copyBackdrop.compile(scene),
    graph.glassFront.compile(scene),
    graph.glassAccent.compile(scene),
    graph.wireframe.compile(scene),
    graph.present.compile(outputSignature),
  ];
}

export { LIGHT_TARGET_COUNT } from "./targets";
export {
  LIGHT_CAUSTIC_DEBUG_ENTRY,
  LIGHT_WALL_DEBUG_ENTRIES,
} from "./debug-entries";
