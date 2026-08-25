import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { PrismDebugFlowNode } from "./model";
import { PreviewCanvas } from "./preview-canvas";

export const SourceNode = memo(function SourceNode({
  data,
}: NodeProps<PrismDebugFlowNode>) {
  const { bridge, source } = data;
  return (
    <article className="prism-debug-node" data-kind={source.kind}>
      <Handle
        className="prism-debug-node__handle"
        isConnectable={false}
        position={Position.Left}
        type="target"
      />
      <header>
        <strong>{source.label}</strong>
        <span>{source.kind}</span>
      </header>
      <PreviewCanvas bridge={bridge} source={source} />
      <footer>{source.visualization}</footer>
      <Handle
        className="prism-debug-node__handle"
        isConnectable={false}
        position={Position.Right}
        type="source"
      />
    </article>
  );
});
