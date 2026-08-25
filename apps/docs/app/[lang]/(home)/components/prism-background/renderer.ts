import type { Frame, Gpu, Surface, Target } from "vgpu";
import { clock, frameLoop, surface } from "vgpu";

import type {
  BrowserRendererOptions,
  ExampleRenderer,
  RenderSize,
} from "@/lib/example-renderer";
import {
  createPrismDebugPreviewRelay,
  NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
} from "./debug/preview-bridge";
import type { PrismDebugPreviewBridge } from "./debug/preview-bridge";
import type { PrismDebugPreviewHost } from "./debug/gpu";
import { viewportWithinCanvas, type NormalizedViewport } from "./framing";
import { createPrismPipelineController } from "./pipeline-controller";
import type { PrismDebugSource, PrismPipelineMode } from "./pipelines/types";
import { createPrismInteraction } from "./runtime/interaction";
import { createPrismRuntime, destroyPrismRuntime } from "./runtime/resources";
import {
  setRuntimeControls,
  setRuntimeFramingViewport,
  setRuntimeLampAim,
  setRuntimeOrbit,
} from "./runtime/state";
import type { PrismRuntime } from "./runtime/types";
import type { PrismThumbnailOptions } from "./thumbnail";
import { DEFAULT_PRISM_CONTROLS, type PrismControls } from "./types";

export type { PrismThumbnailOptions } from "./thumbnail";

/** Keep thumbnail-only scene code outside the interactive homepage chunk. */
export async function renderThumbnail(
  gpu: Gpu,
  output: Target,
  options: PrismThumbnailOptions = {}
): Promise<void> {
  const thumbnail = await import("./thumbnail");
  return thumbnail.renderThumbnail(gpu, output, options);
}

export interface PrismRenderer extends ExampleRenderer<PrismControls> {
  /** Stable bridge identity; GPU-backed previews can replace its internals. */
  readonly debugBridge: PrismDebugPreviewBridge;
  debugSources(): readonly PrismDebugSource[];
  setMode(mode: PrismPipelineMode): Promise<void>;
}
const DUST_FPS = 30;

export interface PrismBrowserRendererOptions
  extends BrowserRendererOptions<PrismControls> {
  /** DOM slot whose canvas-relative bounds should contain the prism. */
  readonly framingElement?: HTMLElement;
  /** Explicit theme selected by the React integration layer. */
  readonly initialMode: PrismPipelineMode;
  /** Loads preview-only WebGPU code; must only be enabled for `?debug`. */
  readonly debugPreviews?: boolean;
}

export function createRenderer(
  options: PrismBrowserRendererOptions
): PrismRenderer {
  const debugRelay = options.debugPreviews
    ? createPrismDebugPreviewRelay()
    : undefined;
  let disposed = false;
  let reportedError = false;
  let controls: PrismControls =
    options.initialControls ?? DEFAULT_PRISM_CONTROLS;
  let gpu: Gpu | undefined;
  let gpuClock: ReturnType<typeof clock> | undefined;
  let canvasSurface: Surface | undefined;
  let runtime: PrismRuntime | undefined;
  let pipelineController:
    | ReturnType<typeof createPrismPipelineController>
    | undefined;
  let debugHost: PrismDebugPreviewHost | undefined;
  let requestedMode = options.initialMode;
  let loop: { stop(): void } | undefined;
  let observer: ResizeObserver | undefined;
  let resizeFrame = 0;
  let pendingSize: RenderSize | undefined;
  let pendingFraming: NormalizedViewport | undefined;
  let framingPending = false;
  /** Set whenever the picture would differ from the frame already on screen. */
  let pendingPresent = true;
  /** Wakes preview-only passes without forcing the production scene to redraw. */
  let debugPending = false;
  let lastDustTime = -1;
  const interaction = createPrismInteraction(options.canvas, () => {
    pendingPresent = true;
  });

  const handleFailure = (error: unknown) => {
    if (disposed) return;
    if (!reportedError) {
      reportedError = true;
      try {
        options.onError?.(error);
      } catch {
        /* reporting must not block teardown */
      }
    }
    dispose();
  };

  const reportRecoverableFailure = (error: unknown) => {
    if (disposed) return;
    try {
      options.onError?.(error);
    } catch {
      /* reporting a recoverable failure must not affect the active renderer */
    }
  };

  const applyResize = () => {
    resizeFrame = 0;
    const size = pendingSize;
    const framing = pendingFraming;
    const shouldApplyFraming = framingPending;
    pendingSize = undefined;
    pendingFraming = undefined;
    framingPending = false;
    if (disposed || !size || !canvasSurface || !pipelineController || !runtime)
      return;
    try {
      canvasSurface.resize([
        Math.max(1, Math.round(size.width * size.dpr)),
        Math.max(1, Math.round(size.height * size.dpr)),
      ]);
      pipelineController.resize(canvasSurface.size);
      if (shouldApplyFraming) setRuntimeFramingViewport(runtime, framing);
      debugHost?.invalidate();
      pendingPresent = true;
    } catch (error) {
      handleFailure(error);
    }
  };

  const resize = (size: RenderSize) => {
    if (disposed || size.width <= 0 || size.height <= 0) return;
    pendingSize = size;
    if (!resizeFrame) resizeFrame = requestAnimationFrame(applyResize);
  };

  const measure = () => {
    const rect = options.canvas.getBoundingClientRect();
    if (options.framingElement) {
      pendingFraming = viewportWithinCanvas(
        rect,
        options.framingElement.getBoundingClientRect()
      );
      framingPending = true;
    }
    resize({
      width: rect.width,
      height: rect.height,
      dpr: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
    });
  };

  const tick = (currentFrame: Frame) => {
    const pipeline = pipelineController?.pipeline;
    if (disposed || !runtime || !pipeline || !canvasSurface) return;
    const aim = interaction.stepAim();
    const orbit = interaction.stepOrbit();
    const updateScene = !!aim || !!orbit || pendingPresent;
    const dustTime = gpuClock
      ? Math.floor(gpuClock.time * DUST_FPS) / DUST_FPS
      : 0;
    const dustMoved =
      pipeline.mode === "dark" &&
      controls.view === "glass" &&
      dustTime !== lastDustTime;
    if (!updateScene && !dustMoved && !debugPending) return;
    if (updateScene || dustMoved) {
      try {
        if (aim) setRuntimeLampAim(runtime, aim[0], aim[1]);
        if (orbit) setRuntimeOrbit(runtime, orbit[0], orbit[1]);
        if (aim || orbit) debugHost?.invalidate();
        pipeline.bind(dustTime);
        pipeline.render(currentFrame, canvasSurface, { updateScene });
        pendingPresent = false;
        lastDustTime = dustTime;
      } catch (error) {
        handleFailure(error);
        return;
      }
    }
    debugPending = false;
    try {
      debugHost?.render(currentFrame, gpuClock?.time ?? 0);
    } catch (error) {
      reportRecoverableFailure(error);
    }
  };

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    loop?.stop();
    loop = undefined;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    pendingSize = undefined;
    pendingFraming = undefined;
    framingPending = false;
    observer?.disconnect();
    observer = undefined;
    window.removeEventListener(
      "pointermove",
      interaction.onPointerMove as EventListener
    );
    window.removeEventListener("blur", interaction.onPointerLeave);
    if (typeof window !== "undefined")
      window.removeEventListener("resize", measure);

    debugRelay?.setDelegate(NOOP_PRISM_DEBUG_PREVIEW_BRIDGE);
    debugHost?.dispose();
    debugHost = undefined;
    debugRelay?.dispose();

    const controller = pipelineController;
    const ownedRuntime = runtime;
    const ownedSurface = canvasSurface;
    const ownedGpu = gpu;
    pipelineController = undefined;
    runtime = undefined;
    canvasSurface = undefined;
    gpu = undefined;
    gpuClock = undefined;

    const finishResourceCleanup = () => {
      if (ownedRuntime) destroyPrismRuntime(ownedRuntime);
      ownedSurface?.dispose();
      ownedGpu?.dispose();
    };
    const pendingCleanup = controller?.destroy();
    if (pendingCleanup) {
      void pendingCleanup.then(finishResourceCleanup, finishResourceCleanup);
    } else {
      finishResourceCleanup();
    }
  }

  const initialize = async () => {
    const { init } = await import("vgpu");
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) {
      nextGpu.dispose();
      return;
    }
    gpu = nextGpu;
    canvasSurface = surface(gpu, options.canvas, { dpr: [1, 2] });
    runtime = createPrismRuntime(gpu, canvasSurface.size, "prism-rainbow");
    setRuntimeControls(runtime, controls);
    pipelineController = createPrismPipelineController({
      runtime,
      output: canvasSurface,
      initialMode: requestedMode,
      onActivate: () => {
        pendingPresent = true;
        lastDustTime = -1;
        debugHost?.invalidate();
      },
    });
    if (options.debugPreviews) {
      try {
        const { createPrismDebugPreviewHost } = await import("./debug/gpu");
        if (disposed || !gpu || !runtime || !pipelineController) return;
        debugHost = createPrismDebugPreviewHost({
          gpu,
          runtime,
          getPipeline: () => pipelineController?.pipeline,
          invalidate: () => {
            debugPending = true;
          },
          onError: reportRecoverableFailure,
        });
        debugRelay?.setDelegate(debugHost.bridge);
      } catch (error) {
        reportRecoverableFailure(error);
      }
    }
    window.addEventListener(
      "pointermove",
      interaction.onPointerMove as EventListener,
      { passive: true }
    );
    window.addEventListener("blur", interaction.onPointerLeave);
    observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(options.canvas);
    if (options.framingElement) observer?.observe(options.framingElement);
    window.addEventListener("resize", measure);
    measure();
    await pipelineController.ready;
    if (disposed) return;
    gpuClock = clock(gpu);
    loop = frameLoop(gpu, tick);
  };

  const ready = initialize().catch((error: unknown) => {
    if (disposed) return;
    handleFailure(error);
    throw error;
  });

  return {
    ready,
    debugBridge: debugRelay?.bridge ?? NOOP_PRISM_DEBUG_PREVIEW_BRIDGE,
    debugSources() {
      return pipelineController?.debugSources() ?? [];
    },
    async setMode(mode) {
      if (disposed) return;
      requestedMode = mode;
      if (!pipelineController) {
        await ready;
        return;
      }
      try {
        await pipelineController.setMode(mode);
        if (disposed) return;
        pendingPresent = true;
        lastDustTime = -1;
        debugHost?.invalidate();
      } catch (error) {
        if (disposed) return;
        // The controller deliberately retains the previous active pipeline
        // when a candidate module or prepare fails. Report and reject the
        // switch without tearing that valid renderer down.
        reportRecoverableFailure(error);
        throw error;
      }
    },
    setControls(next) {
      if (disposed) return;
      controls = { ...next };
      pendingPresent = true;
      if (runtime) setRuntimeControls(runtime, controls);
      debugHost?.invalidate();
    },
    invalidate() {
      pendingPresent = true;
      debugHost?.invalidate();
    },
    resize,
    dispose,
  };
}
