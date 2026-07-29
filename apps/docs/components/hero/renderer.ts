import type { Effect, Frame, Gpu, Surface, Target } from 'vgpu';

import bakeWgsl from './bake.wgsl';
import { createNoiseVolume, NOISE_VOLUME_SIZE, noiseVolumeSampler } from './noise-volume.mjs';
import shadeWgsl from './shade.wgsl';

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
  /**
   * Maximum scene rotation the mouse can reach, in radians (0 disables it).
   *
   * The pointer turns the SCENE around the Y axis, not the camera: the baked
   * G-buffer stays valid because the geometry is axisymmetric, so this is a
   * per-frame uniform and never triggers a bake. See `Shade.sceneYaw` in
   * shade.wgsl for the sign convention and the symmetry precondition.
   */
  mouseYaw: number;
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
    cameraY: 0.085,
    distance: 13.5,
    diskRadius: 10.8,
    fov: 2.67,
    // Canvas covers the whole hero now, so the hole sits dead center.
    centerY: 0,
    debugView: 0,
    diskLayers: 2,
    // ~8.6 degrees each way: enough to read as a living, turnable scene without
    // ever swinging the disk far enough to look like a camera cut.
    mouseYaw: 0.15,
    disk: {
      brightness: 0.098,
      speed: 0.75,
      stretch: 5.75,
      detail: 3.44,
      turbulence: 4.46,
      density: 1.38,
      doppler: 1.21,
      spare0: 0.43,
      spare1: -0.25,
      spare2: -0.67,
      spare3: 0.69,
    },
    stars: {
      brightness: 0.82,
      brightnessMin: 1,
      brightnessMax: 2.93,
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

/**
 * Smoothing time constant for the mouse-driven scene rotation, in seconds.
 *
 * Applied as `k = 1 - exp(-dt / tau)` so the response is frame-rate independent
 * (a plain `lerp(current, target, 0.05)` would rotate twice as fast on a 120 Hz
 * display). 0.325 s reproduces exactly that historical 0.05-per-frame feel at
 * 60 fps.
 */
const SCENE_YAW_TAU_S = 0.325;

/** Upper bound on the smoothing timestep, so a backgrounded tab cannot snap. */
const MAX_FRAME_DT_S = 0.1;

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
  /**
   * Tiled 3D value-noise lattice for disk.wgsl, plus its sampler.
   *
   * Immutable and resolution-independent, so unlike the G-buffer it is created
   * ONCE and survives every resize — `setBindings` re-binds the same handle.
   * Lives on `Effects` rather than `Targets` for exactly that reason: `Targets`
   * is the set of things a resize throws away.
   */
  noiseVolume: NoiseVolume;
  noiseSampler: GPUSampler;
}

/** What `createNoiseVolume` hands back: a core `Texture` we have to destroy. */
type NoiseVolume = ReturnType<typeof createNoiseVolume>;

interface Targets {
  /** G-buffer written once by the bake pass (MRT: hit1 / hit2 / sky / view). */
  gbuffer: Target;
}

/**
 * Upper bound on `devicePixelRatio`.
 *
 * Every buffer in the chain is allocated at CSS size x this, so it is the single
 * biggest lever on fill cost: the bake is a geodesic raymarch per pixel and the
 * G-buffer is 32 bytes per sample. 1.5 keeps the hero crisp on Retina while
 * costing ~12% fewer fragments than the 1.6 it replaced, and ~44% fewer than an
 * uncapped 2.
 *
 * Used in BOTH places that can size the swap chain — `gpu.surface({ dpr })` and
 * `measure()` — which must agree or a resize would fight the surface clamp.
 */
const MAX_DPR = 1.5;

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
  let intersection: IntersectionObserver | undefined;
  // --- Visibility state machine (see `reconcileLoop`) -------------------------
  // Two independent reasons to be off screen, one derived answer. Both default
  // to "visible" so a browser without IntersectionObserver, or an SSR-ish
  // environment, still renders.
  let documentVisible = typeof document === 'undefined' ? true : !document.hidden;
  let canvasIntersecting = true;
  /** Set once the GPU objects exist: before that there is nothing to run. */
  let started = false;
  // --- Animation clock --------------------------------------------------------
  // NOT `gpu.time`: that one accumulates the whole wall-clock interval since the
  // last frame (gpu.ts `#advanceTime`), so resuming after a minute in a hidden
  // tab would teleport the disk a minute forward — a visible jump in the
  // Keplerian shear and the sawtooth crossfades in disk.wgsl. This clock only
  // ever advances while the loop is actually running.
  let animationTime = 0;
  let lastFrameAt: number | undefined;
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
  // Mouse-driven scene rotation. Pure per-frame state: the listener only writes
  // a number, the render loop turns it into one uniform, and NOTHING here can
  // ever schedule a bake (the G-buffer is rotation-invariant by construction).
  let pointerXNormalized = 0;
  let currentSceneYaw = 0;
  let lastYawAt: number | undefined;

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

  /**
   * Pointer -> scene rotation target. The canvas is `pointer-events-none`, so
   * this listens on `window`: events over the hero copy bubble up all the same.
   *
   * Touch and pen are ignored on purpose — a tap would slam the scene to a
   * corner value and leave it there.
   */
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const width = Math.max(window.innerWidth, 1);
    pointerXNormalized = Math.min(1, Math.max(-1, (event.clientX / width) * 2 - 1));
  };
  /** Pointer gone (left the window, tab hidden, window blurred): drift back to center. */
  const recenterPointer = () => { pointerXNormalized = 0; };
  const onPointerOut = (event: PointerEvent) => {
    // relatedTarget === null means the pointer left the window, not just one element.
    if (event.relatedTarget === null) recenterPointer();
  };
  const onVisibilityChange = () => {
    if (document.hidden) recenterPointer();
    documentVisible = !document.hidden;
    reconcileLoop();
  };

  /**
   * The one place a render loop is started or stopped.
   *
   * Everything else (visibilitychange, IntersectionObserver, init, dispose)
   * only writes a boolean and calls this. The `loop` handle IS the "am I
   * running" flag, so the function is idempotent: calling it twice for the same
   * state cannot start a second `gpu.frame.loop`, which would double the frame
   * rate and the GPU cost permanently.
   *
   * Resuming resets both timestamp bases. `lastFrameAt` keeps the animation
   * clock from swallowing the paused interval in one frame, and `lastYawAt`
   * keeps the exponential pointer smoothing from snapping the scene to its
   * target (`1 - exp(-dt/tau)` is ~1 for a large dt).
   */
  function reconcileLoop(): void {
    if (!started || !gpu) return;
    const shouldRun = !disposed && documentVisible && canvasIntersecting;
    if (shouldRun === Boolean(loop)) return;
    if (shouldRun) {
      lastFrameAt = undefined;
      lastYawAt = undefined;
      loop = gpu.frame.loop(renderFrame);
    } else {
      loop?.stop();
      loop = undefined;
    }
  }

  /**
   * Advances the animation clock by this frame's ACTIVE delta and returns it.
   *
   * Unclamped on purpose: while the loop runs this reproduces `gpu.time`
   * exactly (both are wall-clock sums), so nothing about the animation changes
   * on a page that is never hidden. The only intervals it drops are the ones
   * spent paused, because `reconcileLoop` clears `lastFrameAt` on resume and
   * the first frame back therefore contributes dt = 0.
   */
  const advanceAnimationTime = (now: number): number => {
    animationTime += lastFrameAt === undefined ? 0 : Math.max(0, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    return animationTime;
  };

  const renderFrame = (frame: Frame): void => {
    if (disposed || !effects || !targets || !surface) return;
    // Polling the geometry here (instead of trusting the panel to call
    // rebake()) means NO geometry setting can ever be applied without a bake:
    // fov, cameraY & friends are pure bake inputs and the shade pass ignores
    // them, so a missed invalidation would silently do nothing. A rebake
    // requested while paused just leaves `forceBake` set and runs on resume.
    const now = clockMs();
    const runBake = resolveBake(now);
    if (runBake) setBakeUniforms(effects, targets, settings);
    // The mouse rotation is a uniform, never a bake: the scene is axisymmetric
    // so the baked G-buffer is still exact in the rotated frame.
    setShadeUniforms(effects, targets, settings, advanceAnimationTime(now), advanceSceneYaw(now));
    renderChain(frame, effects, targets, surface, runBake);
  };

  /**
   * Advances the smoothed scene rotation and returns the value for this frame.
   *
   * Frame-rate independent: `k = 1 - exp(-dt / tau)`. The first frame has no
   * previous timestamp, so `dt = 0` and the scene starts at exactly 0 — it can
   * never pop into place on load.
   */
  const advanceSceneYaw = (now: number): number => {
    const dt = lastYawAt === undefined ? 0 : Math.min(Math.max((now - lastYawAt) / 1000, 0), MAX_FRAME_DT_S);
    lastYawAt = now;
    const target = pointerXNormalized * Math.max(0, settings.mouseYaw);
    currentSceneYaw += (target - currentSceneYaw) * (1 - Math.exp(-dt / SCENE_YAW_TAU_S));
    return currentSceneYaw;
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
    resize({ width: rect.width, height: rect.height, dpr: Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1)) });
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
    // Disconnect before anything is torn down: a queued IntersectionObserver
    // callback firing after dispose would call reconcileLoop() on a disposed
    // gpu. `started`/`disposed` already guard it, but not leaking the observer
    // (and its reference to the canvas) is the actual fix.
    intersection?.disconnect();
    intersection = undefined;
    started = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerout', onPointerOut);
      window.removeEventListener('blur', recenterPointer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    if (targets) destroyTargets(targets);
    targets = undefined;
    // Not a Target, so `destroyTargets` never sees it; 256 KiB of device memory
    // that would otherwise outlive a remount.
    effects?.noiseVolume.destroy();
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
    surface = gpu.surface(options.canvas, { dpr: [1, MAX_DPR] });
    effects = createEffects(gpu, 'black-hole-live');
    targets = createTargets(gpu, surface.size, 'black-hole-live');
    setBindings(effects, targets);
    await prewarm(effects, targets, surface);
    if (disposed) return;
    observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(options.canvas);
    window.addEventListener('resize', onWindowResize);
    // Passive: the handler only stores a number, it never reads layout, touches
    // the GPU or cancels the event.
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerout', onPointerOut, { passive: true });
    window.addEventListener('blur', recenterPointer);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // A hero scrolled past is 100% wasted GPU: this is a per-pixel geodesic
    // shade at up to 1.5x dpr, running behind whatever the reader is actually
    // looking at. threshold 0 = "any part of the canvas is on screen".
    if (typeof IntersectionObserver !== 'undefined') {
      intersection = new IntersectionObserver((entries) => {
        // Last entry wins: a batch is ordered oldest-first, so it is the
        // current state.
        canvasIntersecting = entries[entries.length - 1]?.isIntersecting ?? canvasIntersecting;
        reconcileLoop();
      }, { threshold: 0 });
      intersection.observe(options.canvas);
    }
    measure();
    // From here on the loop is owned by the state machine, never started
    // directly — see `reconcileLoop`.
    started = true;
    documentVisible = !document.hidden;
    reconcileLoop();
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
    // Built and uploaded here, synchronously, before the first bind: the
    // lattice is a pure function of its size, so there is nothing to await and
    // nothing that can change later.
    noiseVolume: createNoiseVolume(gpu, NOISE_VOLUME_SIZE, `${label}-noise-volume`),
    noiseSampler: noiseVolumeSampler(gpu),
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
  };
}

function destroyTargets(targets: Targets): void {
  destroyTarget(targets.gbuffer);
}

function destroyTarget(target: Target | undefined): void {
  (target as { destroy?: () => void } | undefined)?.destroy?.();
}

function setBindings(effects: Effects, targets: Targets): void {
  const [hit1, hit2, sky, view] = targets.gbuffer.colors;
  effects.bake.set({ bake: { resolution: targets.gbuffer.size } });
  effects.shade.set({
    gHit1: hit1,
    gHit2: hit2,
    gSky: sky,
    gView: view,
    // Resize-invariant, but re-bound with the rest: `setBindings` rebuilds the
    // whole shade bind group when the G-buffer is recreated, and a bind group
    // is all-or-nothing.
    noiseVolume: effects.noiseVolume,
    noiseSampler: effects.noiseSampler,
    // The shade pass draws at G-buffer resolution: it is a 1:1 textureLoad, and
    // the swap chain is created from the same clamped physical size.
    shade: { resolution: targets.gbuffer.size },
  });
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
  sceneYaw: number,
): void {
  effects.shade.set({
    shade: {
      resolution: targets.gbuffer.size,
      time,
      diskOuter: settings.diskRadius,
      debugView: settings.debugView,
      diskLayers: settings.diskLayers,
      // Active rotation of the SCENE (camera yaw would be -sceneYaw). Smoothed
      // from the pointer by the render loop; the bake never sees it.
      sceneYaw,
    },
    // Look uniforms are passed straight through: the WGSL structs in disk.wgsl /
    // stars.wgsl are the source of truth for their fields.
    disk: settings.disk,
    stars: settings.stars,
  });
  // No composite uniform to update: shade.wgsl tone maps in place and returns
  // early (raw) for every debug view, so the bypass is a branch in the shader.
}

async function prewarm(effects: Effects, targets: Targets, output: Output): Promise<void> {
  await Promise.all([
    effects.bake.compile(targets.gbuffer),
    // Compiled against the OUTPUT format (the swap chain), not an HDR target:
    // shade is the last pass and writes display-referred unorm.
    effects.shade.compile({ colors: [output.format] }),
  ]);
}

function renderChain(frame: Frame, effects: Effects, targets: Targets, output: Output, bake: boolean): void {
  if (bake) frame.pass({ target: targets.gbuffer, clear: CLEAR }, (pass) => pass.draw(effects.bake));
  // Two passes, not three: shade reads the G-buffer and writes the swap chain.
  frame.pass({ target: output, clear: CLEAR }, (pass) => pass.draw(effects.shade));
}

/** Wall clock for the bake throttle; independent of the animation clock. */
function clockMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function normalizeSize(size: readonly [number, number]): [number, number] {
  return [Math.max(1, Math.floor(size[0])), Math.max(1, Math.floor(size[1]))];
}
