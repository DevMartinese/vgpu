import type { Target } from "vgpu";

import { BLOOM_VISIBLE_LEVELS, PARTICLE_LIGHT_FIRST_LEVEL } from "../../bloom";
import { prepareRuntimeEnvironment } from "../../runtime/resources";
import { settleAllOrThrow } from "../../runtime/settle";
import { resizeRuntime } from "../../runtime/state";
import type { PrismRuntime } from "../../runtime/types";
import type { PrismDebugSource, PrismOutput, PrismPipeline } from "../types";
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
    debugSources,
    destroy() {
      destroyDarkTargets(graph);
    },
  };
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

const debugSources = (): readonly PrismDebugSource[] => [
  {
    id: "dark-backdrop-hdr",
    label: "Dark backdrop HDR",
    kind: "target",
    inputs: [],
    visualization: "hdr",
  },
  {
    id: "dark-scene-hdr",
    label: "Dark scene HDR",
    kind: "target",
    inputs: [{ source: "dark-backdrop-hdr", operation: "front transmission" }],
    visualization: "hdr",
  },
  ...Array.from({ length: BLOOM_VISIBLE_LEVELS }, (_, level) => ({
    id: `dark-bloom-${level}`,
    label: `Dark bloom ${level}`,
    kind: "pass" as const,
    inputs: [{ source: "dark-scene-hdr", operation: "threshold + blur" }],
    visualization: "hdr" as const,
  })),
];
