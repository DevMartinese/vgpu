import type { Target } from "vgpu";

import { BLOOM_VISIBLE_LEVELS, PARTICLE_LIGHT_FIRST_LEVEL } from "../../bloom";
import { PRISM_DARK_DEBUG_SOURCES } from "../../debug/sources";
import { prepareRuntimeEnvironment } from "../../runtime/resources";
import { settleAllOrThrow } from "../../runtime/settle";
import { resizeRuntime } from "../../runtime/state";
import type { PrismRuntime } from "../../runtime/types";
import type {
  PrismDebugTargetPreview,
  PrismOutput,
  PrismPipeline,
} from "../types";
import { bindDarkGraph } from "./bind";
import { recordDarkBackdropBundle } from "./bundles";
import { createDarkGraph } from "./create-graph";
import { renderDarkGraph } from "./render";
import {
  destroyDarkTargets,
  ensureDarkTargets,
  resizeDarkTargets,
} from "./targets";
import type { DarkPipelineGraph } from "./types";

export interface DarkPrismPipeline extends PrismPipeline {
  readonly mode: "dark";
  readonly targets: {
    readonly backdropHDR?: Target;
    readonly sceneHDR?: Target;
  };
  debugTarget(sourceId: string): PrismDebugTargetPreview | undefined;
}

export function createDarkPipeline(runtime: PrismRuntime): DarkPrismPipeline {
  const graph = createDarkGraph(runtime);
  return {
    mode: "dark",
    get targets() {
      return {
        backdropHDR: graph.backgroundTarget,
        sceneHDR: graph.sceneTarget,
      };
    },
    async prepare(output) {
      resizeRuntime(runtime, output.size);
      ensureDarkTargets(graph, runtime, output.size);
      const environmentReady = prepareRuntimeEnvironment(runtime);
      bindDarkGraph(graph, runtime, 0);
      // A cold shader failure must not release the shared runtime while either
      // environment bake is still compiling or submitting work.
      await settleAllOrThrow([
        environmentReady,
        ...compileGraph(graph, output),
      ]);
      recordDarkBackdropBundle(graph, runtime);
    },
    resize(size) {
      resizeDarkTargets(graph, size);
    },
    bind(time) {
      bindDarkGraph(graph, runtime, time);
    },
    render(currentFrame, output, options) {
      renderDarkGraph(currentFrame, graph, runtime, output, options);
    },
    debugSources: () => PRISM_DARK_DEBUG_SOURCES,
    debugTarget(sourceId) {
      return resolveDarkDebugTarget(graph, sourceId);
    },
    destroy() {
      destroyDarkTargets(graph);
    },
  };
}

function resolveDarkDebugTarget(
  graph: DarkPipelineGraph,
  sourceId: string
): PrismDebugTargetPreview | undefined {
  const backdrop = graph.backgroundTarget;
  const scene = graph.sceneTarget;
  const bloom = graph.bloomTargets;
  if (sourceId === "dark-backdrop-hdr" && backdrop)
    return { primary: backdrop };
  if (sourceId === "dark-scene-hdr" && scene) return { primary: scene };
  if (sourceId === "dark-front-glass" && scene && backdrop) {
    return {
      primary: scene,
      secondary: backdrop,
      mode: "difference",
      differenceGain: 5,
    };
  }
  if (sourceId === "dark-bloom-composite" && bloom)
    return { primary: bloom[0].horizontal };
  if (sourceId === "dark-particle-light" && bloom)
    return { primary: bloom[PARTICLE_LIGHT_FIRST_LEVEL].vertical };

  const level = /^dark-bloom-(\d+)$/.exec(sourceId)?.[1];
  const index = level === undefined ? -1 : Number.parseInt(level, 10);
  if (bloom && index >= 0 && index < BLOOM_VISIBLE_LEVELS)
    return { primary: bloom[index]!.vertical };
  return undefined;
}

function compileGraph(
  graph: DarkPipelineGraph,
  output: PrismOutput
): Promise<unknown>[] {
  const background = graph.backgroundTarget!;
  const scene = graph.sceneTarget!;
  const bloom = graph.bloomTargets!;
  const outputSignature = { colors: [output.format] } as const;
  return [
    graph.light.compile(background),
    graph.wall.compile(background),
    graph.glassBack.compile(background),
    graph.lightWireframe.compile(background),
    graph.copyBackground.compile(scene),
    graph.glassFront.compile(scene),
    graph.wireframe.compile(scene),
    graph.dust.compile(outputSignature),
    graph.bloomExtract.compile(bloom[0].vertical),
    ...graph.bloomBlur.flatMap((level, index) => [
      level.horizontal.compile(bloom[index]!.horizontal),
      level.vertical.compile(bloom[index]!.vertical),
    ]),
    graph.bloomComposite.compile(bloom[0].horizontal),
    graph.particleLightDownsample.compile(
      bloom[PARTICLE_LIGHT_FIRST_LEVEL].vertical
    ),
    graph.present.compile(outputSignature),
  ];
}
