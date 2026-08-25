import type { PrismDebugSource } from "../pipelines/types";

/** Stable source ids shared by graph descriptors and the future GPU bridge. */
export const PRISM_DEBUG_SOURCE_IDS = [
  "wall-material",
  "wall-normal",
  "wall-roughness",
  "global-shadow",
  "prism-shadow",
  "prism-ao",
  "raw-caustic",
  "projected-caustic",
  "composed-wall",
  "backdrop-hdr",
  "front-glass",
  "scene-hdr",
  "final-output",
] as const;

export type PrismDebugSourceId = (typeof PRISM_DEBUG_SOURCE_IDS)[number];

export const PRISM_DEBUG_SOURCES = [
  source("wall-material", "Wall material / albedo", "asset", "srgb"),
  source("wall-normal", "Wall normal", "view", "normal", [
    input("wall-material", "unpack GB"),
  ]),
  source("wall-roughness", "Wall roughness", "view", "scalar", [
    input("wall-material", "unpack A"),
  ]),
  source("global-shadow", "Ambient light blobs", "asset", "scalar"),
  source("prism-shadow", "Prism cast shadow (analytic)", "view", "scalar"),
  source("prism-ao", "Prism contact AO", "asset", "scalar"),
  source("raw-caustic", "Raw spectral caustic", "asset", "hdr"),
  source("projected-caustic", "Projected caustic", "view", "hdr", [
    input("raw-caustic", "project onto wall"),
  ]),
  source("composed-wall", "Composed wall", "pass", "hdr", [
    input("wall-material", "base color"),
    input("wall-normal", "shade normal"),
    input("wall-roughness", "rough response"),
    input("global-shadow", "multiply"),
    input("prism-shadow", "draw core + penumbra"),
    input("prism-ao", "multiply diffuse"),
    input("projected-caustic", "add after AO"),
  ]),
  source("backdrop-hdr", "Backdrop HDR", "target", "hdr", [
    input("composed-wall", "Pass L0"),
  ]),
  source("front-glass", "Front glass", "pass", "hdr", [
    input("backdrop-hdr", "transmit / reflect"),
  ]),
  source("scene-hdr", "Scene HDR", "target", "hdr", [
    input("backdrop-hdr", "copy background"),
    input("front-glass", "composite"),
  ]),
  source("final-output", "Final output", "target", "srgb", [
    input("scene-hdr", "tone map + sRGB"),
  ]),
] as const satisfies readonly PrismDebugSource[];

function input(
  sourceId: PrismDebugSourceId,
  operation: string
): { readonly source: PrismDebugSourceId; readonly operation: string } {
  return { source: sourceId, operation };
}

function source(
  id: PrismDebugSourceId,
  label: string,
  kind: PrismDebugSource["kind"],
  visualization: PrismDebugSource["visualization"],
  inputs: readonly ReturnType<typeof input>[] = []
): PrismDebugSource {
  return { id, label, kind, inputs, visualization };
}
