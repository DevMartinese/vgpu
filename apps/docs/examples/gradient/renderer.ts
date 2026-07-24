import type { Gpu, Surface, Target } from 'vgpu';
import type { BrowserRendererOptions, ExampleRenderer, RenderSize, ThumbnailOptions } from '../../lib/example-renderer';
import fragment from './shader.wgsl';

export function createRenderer(options: BrowserRendererOptions): ExampleRenderer {
  let disposed = false;
  let gpu: Gpu | undefined;
  let surface: Surface | undefined;
  let loop: { stop(): void } | undefined;
  let observer: ResizeObserver | undefined;
  let resizeFrame = 0;
  let pendingSize: RenderSize | undefined;
  let lastDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  let reportedError = false;

  const applyResize = () => {
    resizeFrame = 0;
    if (disposed || !pendingSize) return;
    pendingSize = undefined;
    // The surface owns canvas measurement; this coalesced route keeps DPR and
    // ResizeObserver notifications from introducing a second render loop.
  };
  const resize = (size: RenderSize) => {
    if (disposed || size.width <= 0 || size.height <= 0) return;
    pendingSize = size;
    if (!resizeFrame) resizeFrame = requestAnimationFrame(applyResize);
  };
  const measure = () => {
    const rect = options.canvas.getBoundingClientRect();
    resize({
      width: rect.width,
      height: rect.height,
      dpr: Math.min(2, Math.max(1, window.devicePixelRatio || 1)),
    });
  };
  const onWindowResize = () => {
    if (window.devicePixelRatio === lastDpr) return;
    lastDpr = window.devicePixelRatio;
    measure();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    loop?.stop();
    loop = undefined;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    pendingSize = undefined;
    observer?.disconnect();
    observer = undefined;
    if (typeof window !== 'undefined') window.removeEventListener('resize', onWindowResize);
    surface?.dispose();
    surface = undefined;
    gpu?.dispose();
    gpu = undefined;
  };

  const initialize = async () => {
    const { init } = await import('vgpu');
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) {
      nextGpu.dispose();
      return;
    }
    gpu = nextGpu;
    surface = gpu.surface(options.canvas, { dpr: [1, 2] });
    const effect = gpu.effect(fragment);
    observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(options.canvas);
    window.addEventListener('resize', onWindowResize);
    measure();
    loop = gpu.frame.loop((frame) => {
      if (disposed || !surface) return;
      effect.set({ uniforms: { time: gpu!.time, resolution: surface.size } });
      frame.pass({ target: surface }, (pass) => pass.draw(effect));
    });
  };

  const ready = initialize().catch((error: unknown) => {
    if (disposed) return;
    if (!reportedError) {
      reportedError = true;
      options.onError?.(error);
    }
    dispose();
    throw error;
  });

  return { ready, invalidate() {}, resize, dispose };
}

export async function renderThumbnail(
  gpu: Gpu,
  target: Target,
  options: ThumbnailOptions = {},
): Promise<void> {
  const effect = gpu.effect(fragment);
  effect.set({
    uniforms: {
      time: options.time ?? Math.PI / 4,
      resolution: target.size,
    },
  });
  gpu.frame((frame) => frame.pass({ target }, (pass) => pass.draw(effect)));
}
