import type { Surface, Target } from "vgpu";

import type {
  PrismDebugSource,
  PrismPipeline,
  PrismPipelineMode,
} from "./pipelines/types";
import { resizeRuntime } from "./runtime/state";
import type { PrismRuntime } from "./runtime/types";

type PrismOutput = Surface | Target;

export type PrismPipelineFactory = (
  mode: PrismPipelineMode,
  runtime: PrismRuntime
) => PrismPipeline | Promise<PrismPipeline>;

export interface PrismPipelineControllerOptions {
  readonly runtime: PrismRuntime;
  readonly output: PrismOutput;
  readonly initialMode: PrismPipelineMode;
  readonly createPipeline?: PrismPipelineFactory;
  readonly onActivate?: (mode: PrismPipelineMode) => void;
}

export interface PrismPipelineController {
  readonly ready: Promise<void>;
  readonly pipeline: PrismPipeline | undefined;
  readonly requestedMode: PrismPipelineMode;
  setMode(mode: PrismPipelineMode): Promise<void>;
  resize(size: readonly [number, number]): void;
  debugSources(): readonly PrismDebugSource[];
  /** Returns a promise while module loading or prepare still needs the runtime. */
  destroy(): Promise<void> | undefined;
}

let lightPipelineModule:
  | Promise<typeof import("./pipelines/light")>
  | undefined;
let darkPipelineModule: Promise<typeof import("./pipelines/dark")> | undefined;

function loadLightPipelineModule() {
  lightPipelineModule ??= import("./pipelines/light").catch(
    (error: unknown) => {
      lightPipelineModule = undefined;
      throw error;
    }
  );
  return lightPipelineModule;
}

function loadDarkPipelineModule() {
  darkPipelineModule ??= import("./pipelines/dark").catch((error: unknown) => {
    darkPipelineModule = undefined;
    throw error;
  });
  return darkPipelineModule;
}

/** Starts fetching the selected theme pipeline before the GPU is initialized. */
export function preloadPrismPipeline(mode: PrismPipelineMode): void {
  const pending =
    mode === "light" ? loadLightPipelineModule() : loadDarkPipelineModule();
  void pending.catch(() => {
    // The controller reports a retry failure through the renderer's onError.
  });
}

const defaultFactory: PrismPipelineFactory = (mode, runtime) =>
  mode === "light"
    ? loadLightPipelineModule().then(({ createLightPipeline }) =>
        createLightPipeline(runtime)
      )
    : loadDarkPipelineModule().then(({ createDarkPipeline }) =>
        createDarkPipeline(runtime)
      );

/**
 * Serializes theme preparation while retaining the current image. A completed
 * candidate is activated only when it still matches the latest requested mode.
 */
export function createPrismPipelineController({
  runtime,
  output,
  initialMode,
  createPipeline = defaultFactory,
  onActivate,
}: PrismPipelineControllerOptions): PrismPipelineController {
  let requestedMode = initialMode;
  let active: PrismPipeline | undefined;
  let preparing: PrismPipeline | undefined;
  let running: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let disposed = false;

  const run = async () => {
    while (!disposed && active?.mode !== requestedMode) {
      const candidateMode = requestedMode;
      let candidate: PrismPipeline;
      try {
        candidate = await createPipeline(candidateMode, runtime);
      } catch (error) {
        if (disposed) return;
        if (candidateMode !== requestedMode) continue;
        throw error;
      }
      if (disposed || candidateMode !== requestedMode) {
        candidate.destroy();
        continue;
      }
      preparing = candidate;
      try {
        await candidate.prepare(output);
      } catch (error) {
        candidate.destroy();
        if (preparing === candidate) preparing = undefined;
        if (disposed) return;
        if (candidateMode !== requestedMode) continue;
        throw error;
      }

      if (preparing === candidate) preparing = undefined;
      if (disposed || candidateMode !== requestedMode) {
        candidate.destroy();
        continue;
      }

      candidate.resize(runtime.outputSize);
      const previous = active;
      active = candidate;
      previous?.destroy();
      onActivate?.(candidateMode);
    }
  };

  const ensureRunning = (): Promise<void> => {
    if (running) return running;
    const task = run();
    running = task;
    void task.then(
      () => {
        if (running === task) running = undefined;
      },
      () => {
        if (running === task) running = undefined;
      }
    );
    return task;
  };

  const ready = ensureRunning();

  return {
    ready,
    get pipeline() {
      return active;
    },
    get requestedMode() {
      return requestedMode;
    },
    setMode(mode) {
      if (disposed) return Promise.resolve();
      requestedMode = mode;
      return active?.mode === mode && !preparing
        ? Promise.resolve()
        : ensureRunning();
    },
    resize(size) {
      if (disposed) return;
      resizeRuntime(runtime, size);
      active?.resize(size);
      preparing?.resize(size);
    },
    debugSources() {
      return active?.debugSources?.() ?? [];
    },
    destroy() {
      if (cleanup) return cleanup;
      if (disposed) return undefined;
      disposed = true;
      active?.destroy();
      active = undefined;
      if (!running) return undefined;
      cleanup = running.then(
        () => undefined,
        () => undefined
      );
      return cleanup;
    },
  };
}
