import type { Edge, Node } from "@xyflow/react";

import type {
  PrismDebugSource,
  PrismPipelineMode,
} from "../../pipelines/types";
import type { PrismDebugPreviewBridge } from "../preview-bridge";
import { controlGroupsForSource } from "./control-schema";

export type PrismDebugNodeData = {
  readonly bridge: PrismDebugPreviewBridge;
  readonly mode: PrismPipelineMode;
  readonly source: PrismDebugSource;
};

export type PrismDebugFlowNode = Node<PrismDebugNodeData, "prismDebug">;
export type PrismDebugFlowEdge = Edge<Record<string, never>, "smoothstep">;

export type PrismDebugGraphModel = {
  readonly nodes: PrismDebugFlowNode[];
  readonly edges: PrismDebugFlowEdge[];
};

const COLUMN_GAP = 340;
const CONTROL_COLUMNS = 2;
const NODE_GAP = 24;
const PREVIEW_NODE_HEIGHT = 190;
const CONTROL_ROW_HEIGHT = 46;
const CONTROL_GROUP_HEIGHT = 28;
const CONTROL_NODE_BASE_HEIGHT = 58;

/** Builds a deterministic left-to-right layout without React-owned graph state. */
export function createDebugGraphModel(
  sources: readonly PrismDebugSource[],
  bridge: PrismDebugPreviewBridge,
  mode: PrismPipelineMode
): PrismDebugGraphModel {
  const knownIds = new Set(sources.map(({ id }) => id));
  const depthOf = createDepthResolver(sources);
  const controlPositions = layoutControlNodes(sources, mode);
  const nextYByDepth = new Map<number, number>();

  const nodes = sources.map<PrismDebugFlowNode>((source) => {
    const depth = depthOf(source.id);
    const controlPosition = controlPositions.get(source.id);
    const y = controlPosition?.y ?? nextYByDepth.get(depth) ?? 0;
    if (!controlPosition)
      nextYByDepth.set(depth, y + estimatedNodeHeight(source, mode) + NODE_GAP);
    return {
      id: source.id,
      type: "prismDebug",
      position: controlPosition ?? {
        x: (depth + CONTROL_COLUMNS) * COLUMN_GAP,
        y,
      },
      data: { bridge, mode, source },
      draggable: false,
      selectable: false,
      // XYFlow disables pointer hit-testing when a node is neither draggable
      // nor selectable. Keep the node interactive so its `nopan` controls can
      // receive the gesture without making the node itself draggable.
      style: { pointerEvents: "all" },
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

function layoutControlNodes(
  sources: readonly PrismDebugSource[],
  mode: PrismPipelineMode
): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  const controls = sources.filter(({ kind }) => kind === "control");
  const positions = new Map<
    string,
    { readonly x: number; readonly y: number }
  >();
  let y = 0;
  for (let index = 0; index < controls.length; index += CONTROL_COLUMNS) {
    const row = controls.slice(index, index + CONTROL_COLUMNS);
    row.forEach((source, column) => {
      positions.set(source.id, { x: column * COLUMN_GAP, y });
    });
    y +=
      Math.max(...row.map((source) => estimatedNodeHeight(source, mode))) +
      NODE_GAP;
  }
  return positions;
}

function estimatedNodeHeight(
  source: PrismDebugSource,
  mode: PrismPipelineMode
): number {
  const groups = controlGroupsForSource(source.id, mode);
  const controlCount = groups.reduce(
    (count, group) => count + group.controls.length,
    0
  );
  return (
    (source.visualization === "none"
      ? CONTROL_NODE_BASE_HEIGHT
      : PREVIEW_NODE_HEIGHT) +
    groups.length * CONTROL_GROUP_HEIGHT +
    controlCount * CONTROL_ROW_HEIGHT
  );
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
