import type { Edge, Node } from "@xyflow/react";

import type { PrismDebugSource } from "../../pipelines/types";
import type { PrismDebugPreviewBridge } from "../preview-bridge";

export type PrismDebugNodeData = {
  readonly bridge: PrismDebugPreviewBridge;
  readonly source: PrismDebugSource;
};

export type PrismDebugFlowNode = Node<PrismDebugNodeData, "prismDebug">;
export type PrismDebugFlowEdge = Edge<Record<string, never>, "smoothstep">;

export type PrismDebugGraphModel = {
  readonly nodes: PrismDebugFlowNode[];
  readonly edges: PrismDebugFlowEdge[];
};

const COLUMN_GAP = 300;
const ROW_GAP = 190;

/** Builds a deterministic left-to-right layout without React-owned graph state. */
export function createDebugGraphModel(
  sources: readonly PrismDebugSource[],
  bridge: PrismDebugPreviewBridge
): PrismDebugGraphModel {
  const knownIds = new Set(sources.map(({ id }) => id));
  const depthOf = createDepthResolver(sources);
  const rowsByDepth = new Map<number, number>();

  const nodes = sources.map<PrismDebugFlowNode>((source) => {
    const depth = depthOf(source.id);
    const row = rowsByDepth.get(depth) ?? 0;
    rowsByDepth.set(depth, row + 1);
    return {
      id: source.id,
      type: "prismDebug",
      position: { x: depth * COLUMN_GAP, y: row * ROW_GAP },
      data: { bridge, source },
      draggable: false,
      selectable: false,
    };
  });

  const edges = sources.flatMap<PrismDebugFlowEdge>((target) =>
    target.inputs.flatMap((dependency, index) =>
      knownIds.has(dependency.source)
        ? [
            {
              id: `${dependency.source}:${target.id}:${index}`,
              source: dependency.source,
              target: target.id,
              type: "smoothstep",
              label: dependency.operation,
              selectable: false,
            },
          ]
        : []
    )
  );

  return { nodes, edges };
}

function createDepthResolver(sources: readonly PrismDebugSource[]) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const depths = new Map<string, number>();
  const resolving = new Set<string>();

  const depthOf = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (resolving.has(id)) return 0;

    const source = sourceById.get(id);
    if (!source || source.inputs.length === 0) return 0;

    resolving.add(id);
    let depth = 0;
    for (const input of source.inputs) {
      if (!sourceById.has(input.source)) continue;
      depth = Math.max(depth, depthOf(input.source) + 1);
    }
    resolving.delete(id);
    depths.set(id, depth);
    return depth;
  };

  return depthOf;
}
