import type { Frame } from "vgpu";

import { BLOOM_VISIBLE_LEVELS, PARTICLE_LIGHT_FIRST_LEVEL } from "../../bloom";
import {
  LIGHT_INTERNAL_FIRST_VERTEX,
  LIGHT_INTERNAL_VERTICES,
  LIGHT_OUTGOING_FIRST_VERTEX,
  LIGHT_OUTGOING_VERTICES,
  LIGHT_WHITE_VERTICES,
} from "../../light-mesh";
import type { PrismRuntime } from "../../runtime/types";
import type { PrismOutput, PrismPipelineRenderOptions } from "../types";
import { DUST_PARTICLE_COUNT } from "./create-graph";
import type { DarkPipelineGraph } from "./types";

export function renderDarkGraph(
  current: Frame,
  graph: DarkPipelineGraph,
  runtime: PrismRuntime,
  output: PrismOutput,
  options: PrismPipelineRenderOptions = {}
): void {
  const background = graph.backgroundTarget;
  const scene = graph.sceneTarget;
  const bloom = graph.bloomTargets;
  if (!background || !scene || !bloom) {
    throw new Error("prepare() must run before rendering the dark pipeline.");
  }

  if (options.updateScene ?? true) {
    renderBackdrop(current, graph, runtime);
    current.pass({ target: scene, clear: [0, 0, 0, 1] }, (pass) => {
      pass.draw(graph.copyBackground);
      if (runtime.controls.view === "glass") {
        pass.draw(graph.glassFront);
        if (runtime.controls.wireframe) pass.draw(graph.wireframe);
      }
    });
    current.pass({ target: bloom[0].vertical, clear: [0, 0, 0, 1] }, (pass) => {
      pass.draw(graph.bloomExtract);
    });
    bloom.slice(0, BLOOM_VISIBLE_LEVELS).forEach((level, index) => {
      current.pass(
        { target: level.horizontal, clear: [0, 0, 0, 1] },
        (pass) => {
          pass.draw(graph.bloomBlur[index]!.horizontal);
        }
      );
      current.pass({ target: level.vertical, clear: [0, 0, 0, 1] }, (pass) => {
        pass.draw(graph.bloomBlur[index]!.vertical);
      });
    });
    current.pass(
      {
        target: bloom[PARTICLE_LIGHT_FIRST_LEVEL].vertical,
        clear: [0, 0, 0, 1],
      },
      (pass) => pass.draw(graph.particleLightDownsample)
    );
    bloom.slice(PARTICLE_LIGHT_FIRST_LEVEL).forEach((level, offset) => {
      const index = PARTICLE_LIGHT_FIRST_LEVEL + offset;
      current.pass(
        { target: level.horizontal, clear: [0, 0, 0, 1] },
        (pass) => {
          pass.draw(graph.bloomBlur[index]!.horizontal);
        }
      );
      current.pass({ target: level.vertical, clear: [0, 0, 0, 1] }, (pass) => {
        pass.draw(graph.bloomBlur[index]!.vertical);
      });
    });
    current.pass(
      { target: bloom[0].horizontal, clear: [0, 0, 0, 1] },
      (pass) => {
        pass.draw(graph.bloomComposite);
      }
    );
  }

  current.pass({ target: output }, (pass) => {
    pass.draw(graph.present);
    if (runtime.controls.view === "glass") {
      pass.draw(graph.dust, { instances: DUST_PARTICLE_COUNT });
    }
  });
}

function renderBackdrop(
  current: Frame,
  graph: DarkPipelineGraph,
  runtime: PrismRuntime
): void {
  const target = graph.backgroundTarget!;
  const showBack =
    runtime.controls.view === "glass" || runtime.controls.view === "back";
  const showLight = runtime.controls.view !== "wall";
  current.pass({ target, clear: [0, 0, 0, 1] }, (pass) => {
    if (
      runtime.controls.view === "glass" &&
      !runtime.controls.lightWireframe &&
      graph.backdropBundle
    ) {
      pass.bundles(graph.backdropBundle);
      return;
    }
    pass.draw(graph.wall);
    if (showLight) {
      pass.draw(graph.light, {
        firstVertex: 0,
        vertices: LIGHT_WHITE_VERTICES,
      });
      pass.draw(graph.light, {
        firstVertex: LIGHT_OUTGOING_FIRST_VERTEX,
        vertices: LIGHT_OUTGOING_VERTICES,
      });
      if (runtime.controls.lightWireframe) {
        pass.draw(graph.lightWireframe, {
          firstVertex: 0,
          vertices: LIGHT_WHITE_VERTICES,
        });
        pass.draw(graph.lightWireframe, {
          firstVertex: LIGHT_OUTGOING_FIRST_VERTEX,
          vertices: LIGHT_OUTGOING_VERTICES,
        });
      }
    }
    if (showBack) pass.draw(graph.glassBack);
    if (showLight) {
      pass.draw(graph.light, {
        firstVertex: LIGHT_INTERNAL_FIRST_VERTEX,
        vertices: LIGHT_INTERNAL_VERTICES,
      });
      if (runtime.controls.lightWireframe) {
        pass.draw(graph.lightWireframe, {
          firstVertex: LIGHT_INTERNAL_FIRST_VERTEX,
          vertices: LIGHT_INTERNAL_VERTICES,
        });
      }
    }
  });
}
