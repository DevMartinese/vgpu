import {
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

import type { PrismDebugFlowEdge } from "./model";

export function ElkEdge(props: EdgeProps<PrismDebugFlowEdge>) {
  const fallback = getSmoothStepPath(props);
  return (
    <BaseEdge
      id={props.id}
      interactionWidth={props.interactionWidth}
      label={props.label}
      labelBgBorderRadius={props.labelBgBorderRadius}
      labelBgPadding={props.labelBgPadding}
      labelBgStyle={props.labelBgStyle}
      labelShowBg={props.labelShowBg}
      labelStyle={props.labelStyle}
      labelX={props.data?.labelX ?? fallback[1]}
      labelY={props.data?.labelY ?? fallback[2]}
      markerEnd={props.markerEnd}
      markerStart={props.markerStart}
      path={props.data?.path ?? fallback[0]}
      style={props.style}
    />
  );
}
