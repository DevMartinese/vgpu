import type { Frame } from "vgpu";

import {
  LIGHT_INTERNAL_FIRST_VERTEX,
  LIGHT_INTERNAL_VERTICES,
  LIGHT_OUTGOING_FIRST_VERTEX,
  LIGHT_OUTGOING_VERTICES,
  LIGHT_WHITE_VERTICES,
} from "../../light-mesh";
import type { PrismRuntime } from "../../runtime/types";
import type { PrismOutput, PrismPipelineRenderOptions } from "../types";
import type { LightPipelineGraph } from "./types";

export function renderLightGraph(
  current: Frame,
  graph: LightPipelineGraph,
  runtime: PrismRuntime,
  output: PrismOutput,
  options: PrismPipelineRenderOptions = {}
): void {
  const backdrop = graph.backdropHDR;
  const scene = graph.sceneHDR;
  if (!backdrop || !scene) {
    throw new Error("prepare() must run before rendering the light pipeline.");
  }
  if (options.updateScene ?? true) {
    renderBackdrop(current, graph, runtime);
    current.pass({ target: scene, clear: [0, 0, 0, 1] }, (pass) => {
      pass.draw(graph.copyBackdrop);
      if (runtime.controls.view === "glass") {
        pass.draw(graph.glassFront);
        pass.draw(graph.glassAccent);
        if (runtime.controls.wireframe) pass.draw(graph.wireframe);
      }
    });
  }
  current.pass({ target: output }, (pass) => pass.draw(graph.present));
}

function renderBackdrop(
  current: Frame,
  graph: LightPipelineGraph,
  runtime: PrismRuntime
): void {
  const target = graph.backdropHDR!;
  const showWall = runtime.controls.view !== "caustic";
  const showLight = runtime.controls.view !== "wall";
  const showGlass =
    runtime.controls.view === "glass" || runtime.controls.view === "back";
  current.pass({ target, clear: [0, 0, 0, 1] }, (pass) => {
    if (
      runtime.controls.view === "glass" &&
      !runtime.controls.lightWireframe &&
      graph.backdropBundle
    ) {
      pass.bundles(graph.backdropBundle);
      return;
    }
    if (showWall) {
      pass.draw(graph.wall);
      pass.draw(graph.prismShadow);
    }
    if (showLight) {
      pass.draw(graph.caustic, {
        firstVertex: 0,
        vertices: LIGHT_WHITE_VERTICES,
      });
      pass.draw(graph.caustic, {
        firstVertex: LIGHT_OUTGOING_FIRST_VERTEX,
        vertices: LIGHT_OUTGOING_VERTICES,
      });
    }
    if (showGlass) pass.draw(graph.glassBack);
    if (showLight) {
      pass.draw(graph.caustic, {
        firstVertex: LIGHT_INTERNAL_FIRST_VERTEX,
        vertices: LIGHT_INTERNAL_VERTICES,
      });
    }
    if (runtime.controls.lightWireframe) {
      pass.draw(graph.lightWireframe);
    }
  });
}
