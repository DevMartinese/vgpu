import type { Gpu, Surface, Target } from 'vgpu';

import type { BrowserRendererOptions, ExampleRenderer, RenderSize, ThumbnailOptions } from '../../lib/example-renderer';
import { fixedStepCount } from './math';
import { installStirInput } from './pointer-input';
import { createFluid, prepareFluid, renderFluid, stepFluid, type Fluid } from './simulation';
import { renderThumb, type FluidValidationStats } from './validation';

export interface FluidThumbnailOptions extends ThumbnailOptions {
  scriptedDrag?: boolean;
  soak?: boolean;
  onStateValidated?: (stats: FluidValidationStats) => void;
}

export function createRenderer(options: BrowserRendererOptions): ExampleRenderer {
  let disposed = false;
  let reportedError = false;
  let gpu: Gpu | undefined;
  let surface: Surface | undefined;
  let fluid: Fluid | undefined;
  let input: ReturnType<typeof installStirInput> | undefined;
  let observer: ResizeObserver | undefined;
  let unsubscribeResize: (() => void) | undefined;
  let animationFrame = 0;
  let resizeFrame = 0;
  let prepareGeneration = 0;
  let accumulator = 0;
  let previous = typeof performance === 'undefined' ? 0 : performance.now();

  const reportFailure = (error: unknown) => {
    if (disposed) return;
    if (!reportedError) {
      reportedError = true;
      options.onError?.(error);
    }
    dispose();
  };

  const prepareCurrentOutput = () => {
    resizeFrame = 0;
    if (disposed || !fluid || !surface) return;
    const generation = ++prepareGeneration;
    void prepareFluid(fluid, surface).then(() => {
      if (disposed || generation !== prepareGeneration) return;
    }, reportFailure);
  };

  const resize = (size: RenderSize) => {
    if (disposed || size.width <= 0 || size.height <= 0) return;
    if (!resizeFrame) resizeFrame = requestAnimationFrame(prepareCurrentOutput);
  };

  const measure = () => {
    const rect = options.canvas.getBoundingClientRect();
    resize({
      width: rect.width,
      height: rect.height,
      dpr: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
    });
  };

  const tick = (now: number) => {
    if (disposed) return;
    if (!document.hidden && fluid && input && surface) {
      const fixed = fixedStepCount(accumulator, (now - previous) / 1000);
      accumulator = fixed.accumulator;
      for (let i = 0; i < fixed.steps; i++) stepFluid(fluid, input);
      renderFluid(fluid, surface);
    }
    // Always reset the clock while hidden so visibility changes never catch up.
    previous = now;
    animationFrame = requestAnimationFrame(tick);
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    prepareGeneration++;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    observer?.disconnect();
    observer = undefined;
    unsubscribeResize?.();
    unsubscribeResize = undefined;
    input?.dispose();
    input = undefined;
    surface?.dispose();
    surface = undefined;
    gpu?.dispose();
    gpu = undefined;
    fluid = undefined;
  }

  const initialize = async () => {
    const { init } = await import('vgpu');
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) { nextGpu.dispose(); return; }
    gpu = nextGpu;
    surface = gpu.surface(options.canvas, { dpr: [1, 2] });
    fluid = createFluid(gpu);
    input = installStirInput(options.canvas);
    await prepareFluid(fluid, surface);
    if (disposed) return;
    unsubscribeResize = surface.onResize(prepareCurrentOutput);
    observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(options.canvas);
    previous = performance.now();
    animationFrame = requestAnimationFrame(tick);
  };

  const ready = initialize().catch((error: unknown) => {
    if (disposed) return;
    reportFailure(error);
    throw error;
  });

  return { ready, invalidate() {}, resize, dispose };
}

export async function renderThumbnail(
  gpu: Gpu,
  target: Target,
  options: FluidThumbnailOptions = {},
): Promise<void> {
  await renderThumb(gpu, target, options);
}
