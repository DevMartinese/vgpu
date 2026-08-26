import { bundle } from "vgpu";

import {
  LIGHT_INTERNAL_FIRST_VERTEX,
  LIGHT_INTERNAL_VERTICES,
  LIGHT_OUTGOING_FIRST_VERTEX,
  LIGHT_OUTGOING_VERTICES,
  LIGHT_WHITE_VERTICES,
} from "../../light-mesh";
import type { PrismRuntime } from "../../runtime/types";
import type { LightPipelineGraph } from "./types";

/** Pass L0 has stable draw/bind identities and is replayed as one bundle. */
export function recordLightBackdropBundle(
  graph: LightPipelineGraph,
  runtime: PrismRuntime
): void {
  if (graph.backdropBundle || !graph.backdropHDR) return;
  graph.backdropBundle = bundle(
    runtime.gpu,
    {
      target: graph.backdropHDR,
      label: `${runtime.label}.light.backdrop-bundle`,
    },
    (recorded) => {
      recorded.draw(graph.wall);
      recorded.draw(graph.prismShadow);
      recorded.draw(graph.caustic, {
        firstVertex: 0,
        vertices: LIGHT_WHITE_VERTICES,
      });
      recorded.draw(graph.caustic, {
        firstVertex: LIGHT_OUTGOING_FIRST_VERTEX,
        vertices: LIGHT_OUTGOING_VERTICES,
      });
      recorded.draw(graph.glassBack);
      recorded.draw(graph.caustic, {
        firstVertex: LIGHT_INTERNAL_FIRST_VERTEX,
        vertices: LIGHT_INTERNAL_VERTICES,
      });
    }
  );
}
