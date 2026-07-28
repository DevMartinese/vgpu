import type { Effect, Frame, Gpu, Surface, Target } from 'vgpu';

import bakeWgsl from './bake.wgsl';
import shadeWgsl from './shade.wgsl';
import compositeWgsl from './composite.wgsl';

/**
 * Disk look, uploaded verbatim as the `disk` uniform (see disk.wgsl `DiskLook`).
 * Field names must match the WGSL struct one to one.
 */
export interface DiskLook {
  /** Overall emission gain of the disk. */
  brightness: number;
  /** Keplerian rotation speed multiplier. */
  speed: number;
  /** Angular noise scale: lower = smoke stretched over a wider arc. */
  stretch: number;
  /** Radial noise frequency: higher = thinner, more numerous filaments. */
  detail: number;
  /** Chaos gain; grows toward the outer rim. */
  turbulence: number;
  /** Opacity of the smoke (how much of the background it hides). */
  density: number;
  /** Relativistic beaming strength. */
  doppler: number;
  /** Free knobs for prototyping without touching the renderer (default 0). */
  spare0: number;
  spare1: number;
  spare2: number;
  spare3: number;
}

/**
 * Star look, uploaded verbatim as the `stars` uniform (see stars.wgsl `StarLook`).
 * Field names must match the WGSL struct one to one.
 */
export interface StarLook {
  /** Global multiplier for all hash-mapped star emission. */
  brightness: number;
  /** Emission assigned to the faintest star before `brightness`. */
  brightnessMin: number;
  /** Emission assigned to the strongest star before `brightness`. */
  brightnessMax: number;
  density: number;
  twinkle: number;
}

export interface HeroSettings {
  // --- Geometry / camera. Changing any of these needs a re-bake. ---
  /** Camera pitch, in radians. Positive = camera above the disk plane. */
  cameraY: number;
  /** Camera orbit distance. Smaller = the black hole fills more of the screen. */
  distance: number;
  /** Outer radius of the accretion disk, from the hole's center. */
  diskRadius: number;
  /** Focal length; higher = narrower field of view (zooms in). */
  fov: number;
  /** Vertical image shift in NDC units; positive moves the hole UP on screen. */
  centerY: number;

  // --- Frame-only settings. No re-bake. ---
  /** 0 = final image, 1..7 = G-buffer debug views. */
  debugView: number;
  /**
   * How many baked disk crossings to composite: 1 = front band only,
   * 2 = also the second, lensed image hidden behind it. A/B knob, not a look
   * setting — 2 is the intended result.
   */
  diskLayers: number;
  /** Owned by disk.wgsl. */
  disk: DiskLook;
  /** Owned by stars.wgsl. */
  stars: StarLook;
}

/**
 * Defaults picked by the user in the panel (via "copy JSON"). Keep them in sync
 * with DEFAULT_SETTINGS in debug-render.mjs, which mirrors this block so the
 * headless harness renders the same image the page does.
 */
export function defaultHeroSettings(): HeroSettings {
  return {
    cameraY: 0.135,
    distance: 16.5,
    diskRadius: 15.5,
    fov: 2.65,
    // Canvas covers the whole hero now, so the hole sits dead center.
    centerY: 0,
    debugView: 0,
    diskLayers: 2,
    disk: {
      brightness: 0.05,
      speed: 0.26,
      stretch: 4.5,
      detail: 3,
      turbulence: 3,
      density: 1,
      doppler: 1,
      spare0: -0.04,
      spare1: -0.77,
      spare2: -0.15,
      spare3: -0.51,
    },
    stars: {
      brightness: 0.79,
      brightnessMin: 0.05,
      brightnessMax: 1.1,
      density: 2.92,
      twinkle: 0,
    },
  };
}

/** Settings that invalidate the baked G-buffer. */
export const BAKE_KEYS = ['cameraY', 'distance', 'diskRadius', 'fov', 'centerY'] as const;

/**
 * Minimum spacing between throttled re-bakes, in milliseconds.
 *
 * Dragging a geometry slider fires onChange on every pointer tick; baking on
 * each one would stall the loop. The renderer instead polls BAKE_KEYS every
 * frame and re-bakes at most this often, with a guaranteed trailing bake once
 * the drag settles (see `resolveBake`).
 */
const BAKE_THROTTLE_MS = 200;

export interface HeroRendererOptions {
  canvas: HTMLCanvasElement;
  /** Mutable object read every frame; tweak its fields to adjust the scene live. */
  settings?: HeroSettings;
  onError?: (error: unknown) => void;
}

export interface HeroRenderer {
  ready: Promise<void>;
  /** Re-runs the one-shot geodesic bake with the current settings. */
  rebake(): void;
  dispose(): void;
}

type RenderSize = { width: number; height: number; dpr: number };

type Output = Surface | Target;

interface Effects {
  bake: Effect;
  shade: Effect;
  composite: Effect;
  sampler: GPUSampler;
}

interface Targets {
  /** G-buffer written once by the bake pass (MRT: hit1 / hit2 / sky / view). */
  gbuffer: Target;
  /** HDR scene assembled every frame from the G-buffer. */
  scene: Target;
}

const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
/**
 * G-buffer attachments, in @location order (hit1, hit2, sky, view).
 *
 * Byte cost per sample: 8 + 8 + 8 + 8 = 32, which is exactly the WebGPU
 * guaranteed minimum for maxColorAttachmentBytesPerSample — and exactly what the
 * previous single-hit layout already cost. That budget is why bake.wgsl packs
 * the second hit instead of adding attachments; see the layout comment there.
 *
 * Hit positions stay f32: half floats quantize to ~0.6 px at r ~ 15 and visibly
 * contour the disk noise. Directions and the sky ride in f16, where they are
 * stored as (y, azimuth) pairs and lose nothing.
 */
const GBUFFER_FORMATS: readonly GPUTextureFormat[] = ['rg32float', 'rg32float', 'rgba16float', 'rgba16float'];
const CLEAR: readonly [number, number, number, number] = [0, 0, 0, 1];

export function createRenderer(options: HeroRendererOptions): HeroRenderer {
  const settings = options.settings ?? defaultHeroSettings();
  let disposed = false;
  let gpu: Gpu | undefined;
  let surface: Surface | undefined;
  let effects: Effects | undefined;
  let targets: Targets | undefined;
  let loop: { stop(): void } | undefined;
  let observer: ResizeObserver | undefined;
  let resizeFrame = 0;
  let pendingSize: RenderSize | undefined;
  let lastDpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio;
  let reportedError = false;
  // The bake is one-shot: it only re-runs on init, resize, geometry edits, or an
  // explicit rebake(). `forceBake` bypasses the throttle (init / resize / button),
  // while geometry edits are detected by polling BAKE_KEYS and are throttled.
  let forceBake = true;
  let bakedGeometry: number[] | undefined;
  let lastBakeAt = Number.NEGATIVE_INFINITY;

  const rebake = () => { forceBake = true; };

  /** Geometry settings can be mutated from anywhere (panel, console, pasted JSON). */
  const geometryDirty = () =>
    bakedGeometry === undefined || BAKE_KEYS.some((key, index) => settings[key] !== bakedGeometry![index]);

  /**
   * Decides whether this frame runs the bake, and rearms the throttle.
   *
   * Throttle with a guaranteed trailing edge: while a slider is being dragged we
   * bake at most every BAKE_THROTTLE_MS, and because `bakedGeometry` keeps
   * differing from `settings` until a bake actually runs, the render loop is
   * certain to catch the final value one frame after the window elapses.
   */
  const resolveBake = (now: number): boolean => {
    const dirty = geometryDirty();
    if (!forceBake && !dirty) return false;
    if (!forceBake && now - lastBakeAt < BAKE_THROTTLE_MS) return false;
    forceBake = false;
    lastBakeAt = now;
    bakedGeometry = BAKE_KEYS.map((key) => settings[key]);
    return true;
  };

  const applyResize = () => {
    resizeFrame = 0;
    const size = pendingSize;
    pendingSize = undefined;
    if (disposed || !size || !gpu || !effects || !targets || !surface) return;
    try {
      const previousTargets = targets;
      const nextTargets = createTargets(gpu, [
        Math.max(1, Math.round(size.width * size.dpr)),
        Math.max(1, Math.round(size.height * size.dpr)),
      ], 'black-hole-live');
      try {
        setBindings(effects, nextTargets);
      } catch (error) {
        destroyTargets(nextTargets);
        throw error;
      }
      targets = nextTargets;
      destroyTargets(previousTargets);
      rebake();
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
    resize({ width: rect.width, height: rect.height, dpr: Math.min(1.6, Math.max(1, window.devicePixelRatio || 1)) });
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
    if (targets) destroyTargets(targets);
    targets = undefined;
    surface?.dispose();
    surface = undefined;
    gpu?.dispose();
    gpu = undefined;
    effects = undefined;
  };

  const initialize = async () => {
    const { init } = await import('vgpu');
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) { nextGpu.dispose(); return; }
    gpu = nextGpu;
    surface = gpu.surface(options.canvas, { dpr: [1, 1.6] });
    effects = createEffects(gpu, 'black-hole-live');
    targets = createTargets(gpu, surface.size, 'black-hole-live');
    setConstants(effects, settings);
    setBindings(effects, targets);
    await prewarm(effects, targets, surface);
    if (disposed) return;
    observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(options.canvas);
    window.addEventListener('resize', onWindowResize);
    measure();
    loop = gpu.frame.loop((frame) => {
      if (disposed || !effects || !targets || !surface) return;
      // Polling the geometry here (instead of trusting the panel to call
      // rebake()) means NO geometry setting can ever be applied without a bake:
      // fov, cameraY & friends are pure bake inputs and the shade pass ignores
      // them, so a missed invalidation would silently do nothing.
      const runBake = resolveBake(clockMs());
      if (runBake) setBakeUniforms(effects, targets, settings);
      setShadeUniforms(effects, targets, settings, gpu!.time);
      renderChain(frame, effects, targets, surface, runBake);
    });
  };

  function handleFailure(error: unknown): void {
    if (disposed) return;
    if (!reportedError) {
      reportedError = true;
      try { options.onError?.(error); } catch { /* error reporting must not block teardown */ }
    }
    dispose();
  }

  const ready = initialize().catch((error: unknown) => {
    if (disposed) return;
    handleFailure(error);
    throw error;
  });

  return { ready, rebake, dispose };
}

function createEffects(gpu: Gpu, label: string): Effects {
  return {
    bake: gpu.effect(bakeWgsl, { label: `${label}-bake` }),
    shade: gpu.effect(shadeWgsl, { label: `${label}-shade` }),
    composite: gpu.effect(compositeWgsl, { label: `${label}-composite` }),
    sampler: gpu.sampler({ minFilter: 'linear', magFilter: 'linear' }),
  };
}

function createTargets(gpu: Gpu, size: readonly [number, number], label: string): Targets {
  const full = normalizeSize(size);
  return {
    gbuffer: gpu.target({
      size: full,
      colors: GBUFFER_FORMATS.map((format) => ({ format })),
      label: `${label}-gbuffer`,
    }),
    scene: gpu.target({ size: full, format: HDR_FORMAT, label: `${label}-scene` }),
  };
}

function destroyTargets(targets: Targets): void {
  destroyTarget(targets.gbuffer);
  destroyTarget(targets.scene);
}

function destroyTarget(target: Target | undefined): void {
  (target as { destroy?: () => void } | undefined)?.destroy?.();
}

function setConstants(effects: Effects, settings: HeroSettings): void {
  void settings;
  effects.composite.set({ samp: effects.sampler, composite: { exposure: 1.15, debug: 0 } });
}

function setBindings(effects: Effects, targets: Targets): void {
  const [hit1, hit2, sky, view] = targets.gbuffer.colors;
  effects.bake.set({ bake: { resolution: targets.gbuffer.size } });
  effects.shade.set({
    gHit1: hit1,
    gHit2: hit2,
    gSky: sky,
    gView: view,
    shade: { resolution: targets.scene.size },
  });
  effects.composite.set({ scene: targets.scene });
}

function setBakeUniforms(effects: Effects, targets: Targets, settings: HeroSettings): void {
  effects.bake.set({ bake: {
    resolution: targets.gbuffer.size,
    yaw: 0,
    pitch: settings.cameraY,
    orbitRadius: settings.distance,
    diskOuter: settings.diskRadius,
    fov: settings.fov,
    centerY: settings.centerY,
  } });
}

function setShadeUniforms(
  effects: Effects,
  targets: Targets,
  settings: HeroSettings,
  time: number,
): void {
  effects.shade.set({
    shade: {
      resolution: targets.scene.size,
      time,
      diskOuter: settings.diskRadius,
      debugView: settings.debugView,
      diskLayers: settings.diskLayers,
    },
    // Look uniforms are passed straight through: the WGSL structs in disk.wgsl /
    // stars.wgsl are the source of truth for their fields.
    disk: settings.disk,
    stars: settings.stars,
  });
  // Debug views carry raw channel data: skip tone mapping and desaturation.
  effects.composite.set({ composite: { exposure: 1.15, debug: settings.debugView > 0 ? 1 : 0 } });
}

async function prewarm(effects: Effects, targets: Targets, output: Output): Promise<void> {
  await Promise.all([
    effects.bake.compile(targets.gbuffer),
    effects.shade.compile(targets.scene),
    effects.composite.compile({ colors: [output.format] }),
  ]);
}

function renderChain(frame: Frame, effects: Effects, targets: Targets, output: Output, bake: boolean): void {
  if (bake) frame.pass({ target: targets.gbuffer, clear: CLEAR }, (pass) => pass.draw(effects.bake));
  frame.pass({ target: targets.scene, clear: CLEAR }, (pass) => pass.draw(effects.shade));
  frame.pass({ target: output, clear: CLEAR }, (pass) => pass.draw(effects.composite));
}

/** Wall clock for the bake throttle; independent of the animation clock. */
function clockMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function normalizeSize(size: readonly [number, number]): [number, number] {
  return [Math.max(1, Math.floor(size[0])), Math.max(1, Math.floor(size[1]))];
}
