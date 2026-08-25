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
  readonly kind: "asset" | "view" | "target" | "pass";
  readonly inputs: readonly {
    readonly source: string;
    readonly operation: string;
  }[];
  readonly visualization: "srgb" | "linear" | "hdr" | "scalar" | "normal";
};

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
  destroy(): void;
}
