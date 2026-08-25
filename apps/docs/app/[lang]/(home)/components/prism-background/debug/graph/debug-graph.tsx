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
import type { PrismPipelineMode } from "../../pipelines/types";
import type { PrismControls } from "../../types";
import {
  NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
  type PrismDebugPreviewBridge,
} from "../preview-bridge";
import { debugSourcesForMode } from "../sources";
import {
  DebugControlProvider,
  type PrismControlsUpdater,
} from "./control-context";
import { createDebugGraphModel, type PrismDebugFlowNode } from "./model";
import { SourceNode } from "./source-node";

const NODE_TYPES: NodeTypes = { prismDebug: SourceNode };

export interface PrismDebugGraphProps {
  readonly bridge?: PrismDebugPreviewBridge;
  readonly controls: PrismControls;
  readonly mode: PrismPipelineMode;
  onControlsChange(updater: PrismControlsUpdater): void;
  readonly sources?: readonly PrismDebugSource[];
}

/** Interactive observer UI. Import this module only from the `?debug` branch. */
export function PrismDebugGraph({
  bridge = NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
  controls,
  mode,
  onControlsChange,
  sources = debugSourcesForMode(mode),
}: PrismDebugGraphProps) {
  const model = useMemo(
    () => createDebugGraphModel(sources, bridge, mode),
    [bridge, mode, sources]
  );
  return (
    <DebugControlProvider controls={controls} updateControls={onControlsChange}>
      <section
        aria-label="Prism render pipeline debug graph"
        className="prism-debug-graph"
        data-prism-debug-graph
      >
        <div className="prism-debug-graph__title">
          <strong>{mode === "light" ? "Light" : "Dark"} pipeline</strong>
          <span>live controls + GPU observer</span>
        </div>
        <ReactFlow<PrismDebugFlowNode>
          colorMode="dark"
          defaultViewport={DEFAULT_VIEWPORT}
          edges={model.edges}
          elementsSelectable={false}
          minZoom={0.12}
          nodeTypes={NODE_TYPES}
          nodes={model.nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          nodesFocusable={false}
          onlyRenderVisibleElements
          panOnDrag
          proOptions={PRO_OPTIONS}
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
    </DebugControlProvider>
  );
}

const DEFAULT_VIEWPORT = { x: 28, y: 52, zoom: 0.72 };
const PRO_OPTIONS = { hideAttribution: true };
