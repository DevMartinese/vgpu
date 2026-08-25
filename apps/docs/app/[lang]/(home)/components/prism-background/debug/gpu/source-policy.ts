import type { PrismDebugSourceId } from "../sources";

const STATIC_SOURCES = new Set<PrismDebugSourceId>([
  "raw-caustic",
]);

const TARGET_SOURCES = new Set<PrismDebugSourceId>([
  "backdrop-hdr",
  "front-glass",
  "scene-hdr",
  "final-output",
]);

export function isStaticPreview(id: string): boolean {
  return STATIC_SOURCES.has(id as PrismDebugSourceId);
}

export function isTargetPreview(id: string): boolean {
  return TARGET_SOURCES.has(id as PrismDebugSourceId);
}
