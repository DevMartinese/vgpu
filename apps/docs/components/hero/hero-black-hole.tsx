'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BAKE_KEYS,
  createRenderer,
  defaultHeroSettings,
  type DiskNoiseVariant,
  type HeroRenderer,
  type MeasureResult,
} from './renderer';

/**
 * Set on <html> by the panel's "hide UI" toggle. The matching rule lives in
 * app/globals.css and hides every `[data-hero-overlay]` element, so the hero is
 * nothing but the shader (the lil-gui panel is outside the hero and stays).
 */
const HERO_SOLO_CLASS = 'hero-solo';

/** One-line headline for the panel's read-only field. Detail goes to the console. */
function formatMeasurement(r: MeasureResult): string {
  const gpu = r.gpuMedianMs === undefined ? '' : ` · gpu ${r.gpuMedianMs.toFixed(2)}ms`;
  const capped = r.vsyncCapped ? ' · VSYNC-CAPPED, use gpu' : '';
  return `${r.variant} ${r.medianMs.toFixed(2)}ms (${r.fps.toFixed(0)} fps)${gpu} n=${r.samples}${capped}`;
}

/**
 * The A/B verdict.
 *
 * Reports the GPU number whenever both arms have one: wall-clock cannot separate
 * two variants that are both faster than the display, and reporting a "1.00x"
 * that only means "both hit vsync" would be worse than reporting nothing.
 */
function formatComparison(analytic: MeasureResult, tiled: MeasureResult): string {
  const useGpu = analytic.gpuMedianMs !== undefined && tiled.gpuMedianMs !== undefined;
  const a = useGpu ? analytic.gpuMedianMs! : analytic.medianMs;
  const t = useGpu ? tiled.gpuMedianMs! : tiled.medianMs;
  const ratio = a / t;
  const verdict = ratio >= 1 ? `${ratio.toFixed(2)}x faster` : `${(1 / ratio).toFixed(2)}x SLOWER`;
  const caveat = !useGpu && (analytic.vsyncCapped || tiled.vsyncCapped) ? ' (vsync-capped, unreliable)' : '';
  return `analytic ${a.toFixed(2)}ms → tiled ${t.toFixed(2)}ms = tiled is ${verdict} [${useGpu ? 'gpu' : 'wall'}]${caveat}`;
}

export function HeroBlackHole() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(defaultHeroSettings());
  const rendererRef = useRef<HeroRenderer | null>(null);
  const [hasWebGpu, setHasWebGpu] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;

    async function initialize() {
      try {
        const adapter = await navigator.gpu?.requestAdapter();
        const canvas = canvasRef.current;
        if (cancelled || !adapter || !canvas) return;
        const renderer = createRenderer({
          canvas,
          settings: settingsRef.current,
          // Only the tuning panel measures anything, and the feature has to be
          // requested at device creation — so the shipped hero keeps asking for
          // exactly the device it always did. Same `?debug` test as the panel
          // effect below; duplicated rather than lifted to state because this one
          // has to be known BEFORE the device exists.
          profiling: new URLSearchParams(window.location.search).has('debug'),
          onError: (error) => {
            console.warn('[hero-black-hole] renderer failed, falling back to static image:', error);
            if (!cancelled) setHasWebGpu(false);
          },
        });
        rendererRef.current = renderer;
        dispose = renderer.dispose;
        setHasWebGpu(true);
        await renderer.ready;
      } catch {
        if (!cancelled) setHasWebGpu(false);
      }
    }

    void initialize();
    return () => { cancelled = true; rendererRef.current = null; dispose?.(); };
  }, []);

  // Dev tuning panel, gated behind `?debug` (http://localhost:3010/?debug).
  // Geometry sliders re-run the one-shot bake; the disk-look sliders are read
  // every frame and need no bake.
  useEffect(() => {
    if (!hasWebGpu) return;
    // Read the query string straight off `window` instead of useSearchParams:
    // this is a client-only concern, so it avoids dragging the component into a
    // Suspense boundary. Bailing out BEFORE the dynamic import below is what
    // keeps the lil-gui chunk from ever being requested in production.
    if (!new URLSearchParams(window.location.search).has('debug')) return;
    let cancelled = false;
    let gui: { destroy(): void } | undefined;

    // "hide UI": drops the hero copy (header, tagline, setup snippet, the
    // legibility scrim) so the shader can be judged on its own. It is only a
    // class on <html> — see `.hero-solo` in globals.css — so it is instantly
    // reversible and never unmounts anything. Default OFF: the composed page is
    // the real design now, and this is just a tuning aid.
    const ui = { hideUi: false };
    const applyHideUi = () => document.documentElement.classList.toggle(HERO_SOLO_CLASS, ui.hideUi);
    applyHideUi();

    void import('lil-gui').then(({ default: GUI }) => {
      if (cancelled) return;
      const settings = settingsRef.current;
      const rebake = () => rendererRef.current?.rebake();
      const panel = new GUI({ title: 'black hole' });
      panel.domElement.style.top = '72px';

      // Geometry invalidates the baked G-buffer. No onChange wiring needed: the
      // renderer polls BAKE_KEYS every frame and re-bakes on a throttle with a
      // trailing edge, so dragging a slider stays smooth and the released value
      // always gets baked. That also makes it impossible to forget a key here.
      const geometry = panel.addFolder(`geometry (auto re-bakes: ${BAKE_KEYS.join(', ')})`);
      // Slider ranges are sized to leave headroom on BOTH sides of the shipped
      // default, so every knob stays tunable from the panel without editing code.
      geometry.add(settings, 'cameraY', -0.4, 0.6, 0.005).name('camera Y (rad)');
      geometry.add(settings, 'distance', 6, 40, 0.5).name('size (camera dist)');
      geometry.add(settings, 'diskRadius', 3.5, 30, 0.1).name('disk radius');
      geometry.add(settings, 'fov', 0.6, 5, 0.01).name('fov (focal len)');
      geometry.add(settings, 'centerY', -1, 1, 0.01).name('center Y (ndc, + = up)');

      // Mouse rotation is a per-frame uniform, NOT geometry: the scene is
      // axisymmetric, so turning it around Y reuses the same baked G-buffer.
      // 0 disables the interaction entirely.
      const interaction = panel.addFolder('interaction (per frame)');
      interaction.add(settings, 'mouseYaw', 0, 0.4, 0.005).name('mouse yaw max (rad)');

      // --- disk.wgsl owns this block (DiskLook) ---
      const disk = panel.addFolder('disk look (per frame)');
      // brightness lives near 0.05 now that disk.wgsl carries a much larger
      // internal gain, so this slider is deliberately fine-grained.
      disk.add(settings.disk, 'brightness', 0, 0.6, 0.002).name('brightness');
      disk.add(settings.disk, 'speed', 0, 2, 0.005).name('rotation speed');
      disk.add(settings.disk, 'stretch', 0.2, 12, 0.05).name('tangential stretch');
      disk.add(settings.disk, 'detail', 0.1, 8, 0.01).name('radial detail');
      disk.add(settings.disk, 'turbulence', 0, 8, 0.01).name('turbulence');
      disk.add(settings.disk, 'density', 0, 3, 0.01).name('smoke density');
      disk.add(settings.disk, 'doppler', 0, 2, 0.01).name('doppler');
      const diskSpares = disk.addFolder('spare knobs').close();
      diskSpares.add(settings.disk, 'spare0', -2, 2, 0.01).name('disk spare 0');
      diskSpares.add(settings.disk, 'spare1', -2, 2, 0.01).name('disk spare 1');
      diskSpares.add(settings.disk, 'spare2', -2, 2, 0.01).name('disk spare 2');
      diskSpares.add(settings.disk, 'spare3', -2, 2, 0.01).name('disk spare 3');

      // --- stars.wgsl owns this block (StarLook) ---
      const stars = panel.addFolder('stars (per frame)').close();
      // Per-star emission is `brightness * mix(brightness min, brightness max, hash)`.
      stars.add(settings.stars, 'brightness', 0, 3, 0.01).name('brightness (global)');
      // Shared 0..4 scale: min and max are the two ends of one emission range,
      // so a common axis makes them comparable. It also leaves headroom over the
      // shipped defaults (1 and 2.93), which were pinned at the old 1 / 3 tops.
      stars.add(settings.stars, 'brightnessMin', 0, 4, 0.01).name('brightness min');
      stars.add(settings.stars, 'brightnessMax', 0, 4, 0.01).name('brightness max');
      stars.add(settings.stars, 'density', 0, 6, 0.01).name('density');
      stars.add(settings.stars, 'twinkle', 0, 1, 0.01).name('twinkle');

      const debug = panel.addFolder('debug');
      debug.add(ui, 'hideUi').name('hide UI (hero copy)').onChange(applyHideUi);
      debug.add(settings, 'debugView', {
        off: 0,
        'normals / side': 1,
        'disk coords': 2,
        'flags (hit/hole/sky)': 3,
        'lensed ray dir': 4,
        'disk density': 5,
        'sky footprint / star LOD': 6,
        'second disk hit': 7,
      }).name('g-buffer view');
      // A/B for the second baked disk crossing: 1 shows what the renderer looked
      // like when a ray stopped at its first hit, 2 is the intended result.
      debug.add(settings, 'diskLayers', {
        'front hit only': 1,
        'front + hidden hit': 2,
      }).name('disk layers');

      // --- perf A/B ---------------------------------------------------------
      // Two independently compiled shade pipelines (see DISK_NOISE_SWITCH in
      // renderer.ts). Switching is a pipeline swap, not a re-bake: the G-buffer
      // is pure geometry and knows nothing about the disk's noise.
      const perf = panel.addFolder('perf A/B (disk noise)');
      const readout = { result: 'press "measure frame time"' };
      let busy = false;

      /**
       * Runs one measurement of whatever variant is currently selected.
       *
       * The panel field only ever shows the headline; the full result (both
       * medians, both means, sample count, method, resolution) goes to the
       * console, because that is what you actually want to paste somewhere.
       */
      const runMeasure = async (label?: string): Promise<MeasureResult | undefined> => {
        const renderer = rendererRef.current;
        if (!renderer || busy) return undefined;
        busy = true;
        readout.result = `measuring ${label ?? settings.diskNoise}…`;
        try {
          const result = await renderer.measure();
          readout.result = formatMeasurement(result);
          console.log(`[hero] ${result.variant}: ${formatMeasurement(result)}`, result);
          if (result.vsyncCapped) {
            console.warn(
              '[hero] wall-clock is vsync-capped — the frame is waiting for the display, so ms/frame ' +
              'cannot separate the two variants. Compare the GPU number instead.',
            );
          }
          return result;
        } catch (error) {
          readout.result = 'failed — see console';
          console.error('[hero] measure failed', error);
          return undefined;
        } finally {
          busy = false;
        }
      };

      const perfActions = {
        'measure frame time': () => { void runMeasure(); },
        /**
         * Measures both arms back to back and prints the ratio.
         *
         * Worth having over "switch, measure, write it down, switch back": it
         * removes the transcription step and, more importantly, it measures both
         * arms seconds apart on the same thermal state, which is the main way a
         * hand-run A/B goes wrong.
         */
        'A/B both variants': () => {
          void (async () => {
            const restore = settings.diskNoise;
            const results: Partial<Record<DiskNoiseVariant, MeasureResult>> = {};
            for (const variant of ['analytic', 'tiled'] as const) {
              settings.diskNoise = variant;
              const result = await runMeasure(variant);
              if (!result) { settings.diskNoise = restore; panel.controllersRecursive().forEach((c) => c.updateDisplay()); return; }
              results[variant] = result;
            }
            settings.diskNoise = restore;
            panel.controllersRecursive().forEach((c) => c.updateDisplay());
            readout.result = formatComparison(results.analytic!, results.tiled!);
            console.log(`[hero] A/B ${formatComparison(results.analytic!, results.tiled!)}`, results);
          })();
        },
      };
      perf.add(settings, 'diskNoise', {
        'analytic (control)': 'analytic',
        'tiled volume': 'tiled',
      }).name('disk noise');
      perf.add(perfActions, 'measure frame time');
      perf.add(perfActions, 'A/B both variants');
      // Disabled = read-only text field. `.listen()` polls the object, so the
      // async handlers above can just assign to `readout.result`.
      perf.add(readout, 'result').name('last measurement').disable().listen();

      const actions = {
        'copy JSON': () => {
          void navigator.clipboard?.writeText(JSON.stringify(settings, null, 2));
        },
        're-bake': rebake,
      };
      panel.add(actions, 'copy JSON');
      panel.add(actions, 're-bake');
      gui = panel;
    });

    return () => {
      cancelled = true;
      gui?.destroy();
      document.documentElement.classList.remove(HERO_SOLO_CLASS);
    };
  }, [hasWebGpu]);

  // Full-bleed: the canvas covers the entire hero section, with no gradient mask.
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black">
      <img src="/examples/black-hole.card.png" alt="" className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${hasWebGpu ? 'opacity-0' : 'opacity-100 saturate-[0.35]'}`} />
      <canvas ref={canvasRef} className={`pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-500 ${hasWebGpu ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  );
}
