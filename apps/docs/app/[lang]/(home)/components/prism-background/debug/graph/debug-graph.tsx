"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls as FlowControls,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type OnMove,
  type Viewport,
} from "@xyflow/react";
import { SquareArrowOutUpRight } from "lucide-react";
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
  useDebugControls,
} from "./control-context";
import { formatPrismControlChanges, writeClipboardText } from "./copy-controls";
import { createDebugGraphModel, type PrismDebugFlowNode } from "./model";
import { layoutDebugGraphModel } from "./elk-layout";
import { ElkEdge } from "./elk-edge";
import { DebugPopoutPortal, useDebugPopout } from "./popout";
import { SourceNode } from "./source-node";

const NODE_TYPES: NodeTypes = { prismDebug: SourceNode };
const EDGE_TYPES: EdgeTypes = { prismDebug: ElkEdge };

export interface PrismDebugGraphProps {
  readonly baselineControls: PrismControls;
  readonly bridge?: PrismDebugPreviewBridge;
  readonly controls: PrismControls;
  readonly mode: PrismPipelineMode;
  onControlsChange(updater: PrismControlsUpdater): void;
  readonly sources?: readonly PrismDebugSource[];
}

/** Interactive observer UI. Import this module only from the `?debug` branch. */
export function PrismDebugGraph({
  baselineControls,
  bridge = NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
  controls,
  mode,
  onControlsChange,
  sources = debugSourcesForMode(mode),
}: PrismDebugGraphProps) {
  const baseModel = useMemo(
    () => createDebugGraphModel(sources, bridge, mode),
    [bridge, mode, sources]
  );
  const [model, setModel] = useState(baseModel);
  useEffect(() => {
    let active = true;
    setModel(baseModel);
    void layoutDebugGraphModel(baseModel)
      .then((layout) => {
        if (active) setModel(layout);
      })
      .catch((error: unknown) => {
        console.error("Unable to auto-layout the Prism debug graph", error);
      });
    return () => {
      active = false;
    };
  }, [baseModel]);
  const popout = useDebugPopout();
  const viewportRef = useRef<Viewport>(DEFAULT_VIEWPORT);
  const rememberViewport: OnMove = useCallback((_, viewport) => {
    viewportRef.current = viewport;
  }, []);
  useEffect(() => {
    if (popout.document)
      popout.document.title = `vgpu · ${
        mode === "light" ? "Light" : "Dark"
      } prism pipeline`;
  }, [mode, popout.document]);

  return (
    <DebugControlProvider controls={controls} updateControls={onControlsChange}>
      {popout.document ? (
        <DebugPopoutPortal document={popout.document}>
          <GraphSurface
            baselineControls={baselineControls}
            detached
            dock={popout.dock}
            mode={mode}
            model={model}
            rememberViewport={rememberViewport}
            viewportRef={viewportRef}
          />
        </DebugPopoutPortal>
      ) : (
        <GraphSurface
          baselineControls={baselineControls}
          blocked={popout.blocked}
          mode={mode}
          model={model}
          open={popout.open}
          rememberViewport={rememberViewport}
          viewportRef={viewportRef}
        />
      )}
    </DebugControlProvider>
  );
}

interface GraphSurfaceProps {
  readonly baselineControls: PrismControls;
  readonly blocked?: boolean;
  readonly detached?: boolean;
  dock?(): void;
  readonly mode: PrismPipelineMode;
  readonly model: ReturnType<typeof createDebugGraphModel>;
  open?(): void;
  readonly rememberViewport: OnMove;
  readonly viewportRef: RefObject<Viewport>;
}

function GraphSurface({
  baselineControls,
  blocked = false,
  detached = false,
  dock,
  mode,
  model,
  open,
  rememberViewport,
  viewportRef,
}: GraphSurfaceProps) {
  return (
    <section
      aria-label="Prism render pipeline debug graph"
      className="prism-debug-graph"
      data-mode={mode}
      data-popout={detached || undefined}
      data-prism-debug-graph
    >
      <div className="prism-debug-graph__title">
        <strong tabIndex={detached ? -1 : undefined}>
          {mode === "light" ? "Light" : "Dark"} pipeline
        </strong>
        <span>live controls + GPU observer</span>
      </div>
      <div className="prism-debug-graph__actions">
        <CopyChangesButton baseline={baselineControls} mode={mode} />
        {detached ? (
          <button onClick={dock} type="button">
            Dock back
          </button>
        ) : (
          <button
            aria-label="Open Prism debugger in a separate window"
            className="prism-debug-graph__icon-button"
            onClick={open}
            title="Open debugger in a separate window"
            type="button"
          >
            <SquareArrowOutUpRight aria-hidden="true" size={16} />
          </button>
        )}
        {blocked ? (
          <span aria-live="polite" role="status">
            Pop-up blocked. Allow pop-ups, then try again.
          </span>
        ) : null}
      </div>
      <ReactFlow<PrismDebugFlowNode>
        colorMode="dark"
        defaultViewport={viewportRef.current}
        deleteKeyCode={null}
        edges={model.edges}
        edgeTypes={EDGE_TYPES}
        elementsSelectable={false}
        minZoom={0.12}
        nodeTypes={NODE_TYPES}
        nodes={model.nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodesFocusable={false}
        onMoveEnd={rememberViewport}
        onlyRenderVisibleElements
        panOnDrag
        panOnScroll
        panOnScrollSpeed={1}
        panActivationKeyCode={null}
        proOptions={PRO_OPTIONS}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomActivationKeyCode={null}
        zoomOnDoubleClick={false}
        zoomOnPinch
        zoomOnScroll={false}
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

function CopyChangesButton({
  baseline,
  mode,
}: {
  readonly baseline: PrismControls;
  readonly mode: PrismPipelineMode;
}) {
  const { controls } = useDebugControls();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef(0);
  const changes = useMemo(
    () => formatPrismControlChanges(controls, baseline, mode),
    [baseline, controls, mode]
  );

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copyChanges = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (!changes) return;
      window.clearTimeout(resetTimer.current);
      try {
        await writeClipboardText(event.currentTarget.ownerDocument, changes);
        setStatus("copied");
      } catch {
        setStatus("failed");
      }
      resetTimer.current = window.setTimeout(() => setStatus("idle"), 1600);
    },
    [changes]
  );

  return (
    <button disabled={!changes} onClick={copyChanges} type="button">
      {!changes
        ? "No changes"
        : status === "copied"
          ? "Copied"
          : status === "failed"
            ? "Copy failed"
            : "Copy changes"}
    </button>
  );
}

const DEFAULT_VIEWPORT = { x: 28, y: 52, zoom: 0.72 };
const PRO_OPTIONS = { hideAttribution: true };
