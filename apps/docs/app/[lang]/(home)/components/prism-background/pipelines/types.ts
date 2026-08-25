import type { Frame, Surface, Target } from "vgpu";

import type { PrismTheme } from "../types";

export type PrismOutput = Surface | Target;

export type PrismPipelineMode = PrismTheme;

export interface PrismPipelineRenderOptions {
  /** Skip retained scene/postprocess passes when only an overlay animates. */
  readonly updateScene?: boolean;
}

export type PrismDebugSource = {
  readonly id: string;
  readonly label: string;
  readonly kind: "asset" | "view" | "target" | "pass" | "control";
  readonly inputs: readonly {
    readonly source: string;
    readonly operation: string;
  }[];
  readonly visualization:
    | "srgb"
    | "linear"
    | "hdr"
    | "scalar"
    | "normal"
    | "none";
};

/** Existing pipeline texture(s) exposed read-only to the opt-in preview host. */
export interface PrismDebugTargetPreview {
  readonly primary: Target;
  readonly secondary?: Target;
  readonly mode?: "tone" | "difference";
  readonly exposure?: number;
  readonly differenceGain?: number;
}

/** Retained theme renderer. It observes, but never owns, shared runtime state. */
export interface PrismPipeline {
  readonly mode: PrismPipelineMode;
  prepare(output: PrismOutput): Promise<void>;
  resize(size: readonly [number, number]): void;
  bind(time: number): void;
  render(
    currentFrame: Frame,
    output: PrismOutput,
    options?: PrismPipelineRenderOptions
  ): void;
  debugSources?(): readonly PrismDebugSource[];
  /** Resolves retained production targets without allocating or re-rendering them. */
  debugTarget?(sourceId: string): PrismDebugTargetPreview | undefined;
  destroy(): void;
}
