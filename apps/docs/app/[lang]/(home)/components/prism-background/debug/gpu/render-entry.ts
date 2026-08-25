import type { Frame } from "vgpu";

import {
  LIGHT_OUTGOING_FIRST_VERTEX,
  LIGHT_OUTGOING_VERTICES,
} from "../../light-mesh";
import type { PrismDebugSourceId } from "../sources";
import type { PreviewRegistration } from "./registrations";
import { isTargetPreview } from "./source-policy";
import type { TargetPreviewRenderer } from "./target-preview";
import type {
  DebuggableLightPipeline,
  PrismDebugDrawable,
  PrismDebugDrawSet,
} from "./types";

export function renderPreviewEntry(
  current: Frame,
  entry: PreviewRegistration,
  pipeline: DebuggableLightPipeline,
  draws: PrismDebugDrawSet | undefined,
  targetPreview: TargetPreviewRenderer,
  compiled: (
    drawable: PrismDebugDrawable,
    output: PreviewRegistration["output"]
  ) => boolean,
  reportError: (error: unknown) => void
): boolean {
  try {
    const id = entry.source.id as PrismDebugSourceId;
    if (isTargetPreview(id)) {
      if (!compiled(targetPreview.drawableFor(id), entry.output)) return false;
      return targetPreview.render(current, entry.output, id, pipeline);
    }
    const drawable = draws?.sources[id];
    if (!drawable || !compiled(drawable, entry.output)) return false;
    current.pass({ target: entry.output, clear: [0, 0, 0, 1] }, (pass) => {
      if (id === "projected-caustic") {
        pass.draw(drawable, {
          firstVertex: LIGHT_OUTGOING_FIRST_VERTEX,
          vertices: LIGHT_OUTGOING_VERTICES,
        });
      } else {
        pass.draw(drawable);
      }
    });
    return true;
  } catch (error) {
    reportError(error);
    return true;
  }
}

export function clearDarkPreviews(
  current: Frame,
  entries: IterableIterator<PreviewRegistration>
): void {
  for (const entry of entries) {
    if (entry.darkCleared) continue;
    current.pass({ target: entry.output, clear: [0, 0, 0, 0] }, () => {});
    entry.darkCleared = true;
  }
}

export function hasDirectRegistration(
  entries: IterableIterator<PreviewRegistration>
): boolean {
  for (const entry of entries) {
    if (!isTargetPreview(entry.source.id)) return true;
  }
  return false;
}

