"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls as FlowControls,
  ReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./debug-graph.css";

import type { PrismDebugSource } from "../../pipelines/types";
import {
  NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
  type PrismDebugPreviewBridge,
} from "../preview-bridge";
import { PRISM_DEBUG_SOURCES } from "../sources";
import { createDebugGraphModel, type PrismDebugFlowNode } from "./model";
import { SourceNode } from "./source-node";

const NODE_TYPES: NodeTypes = { prismDebug: SourceNode };

export interface PrismDebugGraphProps {
  readonly bridge?: PrismDebugPreviewBridge;
  readonly sources?: readonly PrismDebugSource[];
}

/** Read-only observer UI. Import this module only from the `?debug` branch. */
export function PrismDebugGraph({
  bridge = NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
  sources = PRISM_DEBUG_SOURCES,
}: PrismDebugGraphProps) {
  const model = useMemo(
    () => createDebugGraphModel(sources, bridge),
    [bridge, sources]
  );

  return (
    <section
      aria-label="Prism render pipeline debug graph"
      className="prism-debug-graph"
      data-prism-debug-graph
    >
      <div className="prism-debug-graph__title">
        <strong>Light pipeline</strong>
        <span>read-only GPU observer</span>
      </div>
      <ReactFlow<PrismDebugFlowNode>
        colorMode="dark"
        edges={model.edges}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ maxZoom: 0.82, minZoom: 0.18, padding: 0.12 }}
        minZoom={0.12}
        nodeTypes={NODE_TYPES}
        nodes={model.nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        onlyRenderVisibleElements
        panOnDrag
        proOptions={{ hideAttribution: true }}
        zoomOnDoubleClick={false}
      >
        <Background
          color="rgba(255, 255, 255, 0.09)"
          gap={18}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <FlowControls position="bottom-left" showInteractive={false} />
      </ReactFlow>
    </section>
  );
}
