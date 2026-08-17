import type GUI from "lil-gui";
import type { Effect, Gpu, Surface, Target } from "vgpu";
import { effect, frame, sampler, surface, target } from "vgpu";
import heroFractalDepthWgsl from "./hero-fractal-depth.wgsl";
import heroFractalFloorBakeWgsl from "./hero-fractal-floor-bake.wgsl";
import heroFractalWgsl from "./hero-fractal.wgsl";

const FLOOR_BAKE_SIZE = 512;

export interface HeroFractalCamera {
  /** XYZ Euler rotation, in radians. */
  readonly cameraRotation: readonly [number, number, number];
  /** Local XYZ offset from the target before rotation. */
  readonly cameraDistance: readonly [number, number, number];
  /** World-space point the camera looks toward. */
  readonly cameraTarget: readonly [number, number, number];
  /** Vertical field of view, in degrees. */
  readonly fov: number;
}

export interface HeroFractalMaterial {
  /** Linear RGB ceramic body color. */
  readonly baseColor: readonly [number, number, number];
  /** Microsurface roughness used by the ceramic GGX lobe. */
  readonly roughness: number;
  /** Strength of the ceramic diffuse lobe. */
  readonly diffuseStrength: number;
  /** Strength of the ceramic specular lobe. */
  readonly specularStrength: number;
  /** Strength of the neutral room fill. */
  readonly ambientStrength: number;
  /** Intensity of the key light shared with the floor shadow. */
  readonly lightIntensity: number;
}

interface HeroFractalRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: Readonly<HeroFractalCamera>;
  readonly material: Readonly<HeroFractalMaterial>;
  readonly onError?: (error: unknown) => void;
}

export interface HeroFractalRenderer {
  readonly ready: Promise<void>;
  dispose(): void;
}

interface HeroFractalEffects {
  readonly depth: Effect;
  readonly floorBake: Effect;
  readonly composite: Effect;
}

interface HeroFractalTargets {
  readonly geometry: Target;
  readonly floorBake: Target;
}

function createMaterialDebugGui(
  GuiConstructor: typeof GUI,
  material: {
    baseColor: [number, number, number];
    roughness: number;
    diffuseStrength: number;
    specularStrength: number;
    ambientStrength: number;
    lightIntensity: number;
  },
  draw: () => void,
): GUI {
  const gui = new GuiConstructor({ title: "Hero fractal material", width: 290 });
  gui.domElement.dataset.heroFractalMaterialGui = "";
  gui.domElement.style.zIndex = "1000";

  const ceramic = gui.addFolder("Ceramic");
  ceramic.addColor(material, "baseColor", 1).name("base color");
  ceramic.add(material, "roughness", 0, 1, 0.01).name("roughness");
  ceramic.add(material, "diffuseStrength", 0, 2, 0.01).name("diffuse strength");
  ceramic.add(material, "specularStrength", 0, 2, 0.01).name("specular strength");
  ceramic.add(material, "ambientStrength", 0, 1, 0.01).name("ambient fill");

  const light = gui.addFolder("Shared key light");
  light.add(material, "lightIntensity", 0, 8, 0.01).name("intensity");

  gui.onChange(draw);
  return gui;
}

/** Static multi-pass renderer owned exclusively by the homepage hero. */
export function createHeroFractalRenderer(
  options: HeroFractalRendererOptions,
): HeroFractalRenderer {
  let disposed = false;
  let reportedError = false;
  let gpu: Gpu | undefined;
  let canvasSurface: Surface | undefined;
  let effects: HeroFractalEffects | undefined;
  let targets: HeroFractalTargets | undefined;
  let floorBakeSampler: GPUSampler | undefined;
  let debugGui: GUI | undefined;
  let observer: ResizeObserver | undefined;
  let resizeFrame = 0;
  let materialFrame = 0;
  let depthReady = false;
  let floorBakeReady = false;
  let lastDpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const material = {
    baseColor: [...options.material.baseColor] as [number, number, number],
    roughness: options.material.roughness,
    diffuseStrength: options.material.diffuseStrength,
    specularStrength: options.material.specularStrength,
    ambientStrength: options.material.ambientStrength,
    lightIntensity: options.material.lightIntensity,
  };
  const debugEnabled = new URLSearchParams(window.location.search).has("debug");

  const cameraParams = (resolution: readonly [number, number]) => {
    const fovRadians = options.camera.fov * Math.PI / 180;
    return {
      resolution,
      cameraRotation: options.camera.cameraRotation,
      cameraDistance: options.camera.cameraDistance,
      cameraTarget: options.camera.cameraTarget,
      tanHalfFov: Math.tan(fovRadians * 0.5),
    };
  };

  const draw = (bakeGeometry = false) => {
    if (
      disposed || !gpu || !canvasSurface || !effects || !targets ||
      !floorBakeSampler
    ) return;

    const currentGpu = gpu;
    const currentSurface = canvasSurface;
    const currentEffects = effects;
    const currentTargets = targets;
    const currentFloorSampler = floorBakeSampler;
    const camera = cameraParams(currentSurface.size);
    currentEffects.depth.set({ params: camera });
    currentEffects.composite.set({
      params: { ...camera, material },
      depthTexture: currentTargets.geometry.colors[0],
      normalTexture: currentTargets.geometry.colors[1],
      floorBakeTexture: currentTargets.floorBake,
      floorSampler: currentFloorSampler,
    });

    const shouldBakeFloor = !floorBakeReady;
    const shouldBakeDepth = bakeGeometry || !depthReady;
    frame(currentGpu, (currentFrame) => {
      if (shouldBakeFloor) {
        currentFrame.pass(
          { target: currentTargets.floorBake, clear: [1, 1, 0, 1] },
          (pass) => pass.draw(currentEffects.floorBake),
        );
      }
      if (shouldBakeDepth) {
        currentFrame.pass(
          {
            target: currentTargets.geometry,
            clear: [0, 0, 0, 1],
          },
          (pass) => pass.draw(currentEffects.depth),
        );
      }
      currentFrame.pass(
        { target: currentSurface, clear: [1, 1, 1, 1] },
        (pass) => pass.draw(currentEffects.composite),
      );
    });
    floorBakeReady = true;
    depthReady = true;
  };

  const requestMaterialDraw = () => {
    if (materialFrame) return;
    materialFrame = requestAnimationFrame(() => {
      materialFrame = 0;
      draw();
    });
  };

  const resizeAndDraw = () => {
    resizeFrame = 0;
    if (disposed || !canvasSurface || !targets) return;
    const rect = options.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const size: readonly [number, number] = [
      Math.max(1, Math.round(rect.width * dpr)),
      Math.max(1, Math.round(rect.height * dpr)),
    ];
    const sizeChanged = size[0] !== canvasSurface.size[0] ||
      size[1] !== canvasSurface.size[1];
    canvasSurface.resize(size);
    targets.geometry.resize(size);
    if (sizeChanged) depthReady = false;
    draw(sizeChanged);
  };

  const requestResize = () => {
    if (!resizeFrame) resizeFrame = requestAnimationFrame(resizeAndDraw);
  };

  const onWindowResize = () => {
    if (window.devicePixelRatio === lastDpr) return;
    lastDpr = window.devicePixelRatio;
    requestResize();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    if (materialFrame) cancelAnimationFrame(materialFrame);
    resizeFrame = 0;
    materialFrame = 0;
    observer?.disconnect();
    observer = undefined;
    window.removeEventListener("resize", onWindowResize);
    debugGui?.destroy();
    debugGui = undefined;
    effects = undefined;
    targets = undefined;
    floorBakeSampler = undefined;
    canvasSurface?.dispose();
    canvasSurface = undefined;
    gpu?.dispose();
    gpu = undefined;
  };

  const initialize = async () => {
    // Keep lil-gui out of the normal homepage chunk and load it only when the
    // debug query flag is present. Presence is intentional: ?debug=false still
    // means debug mode is enabled.
    const guiModulePromise = debugEnabled ? import("lil-gui") : undefined;
    const { init } = await import("vgpu");
    if (disposed) return;
    const nextGpu = await init();
    if (disposed) {
      nextGpu.dispose();
      return;
    }
    gpu = nextGpu;
    canvasSurface = surface(gpu, options.canvas, { dpr: [1, 2] });
    effects = {
      depth: effect(gpu, heroFractalDepthWgsl, {
        label: "homepage-light-fractal-depth",
      }),
      floorBake: effect(gpu, heroFractalFloorBakeWgsl, {
        label: "homepage-light-fractal-floor-bake",
      }),
      composite: effect(gpu, heroFractalWgsl, {
        label: "homepage-light-fractal-composite",
      }),
    };
    targets = {
      geometry: target(gpu, {
        size: canvasSurface.size,
        colors: [
          { format: "r32float" },
          { format: "rgba8unorm" },
        ],
        label: "homepage-light-fractal-geometry",
      }),
      floorBake: target(gpu, {
        size: [FLOOR_BAKE_SIZE, FLOOR_BAKE_SIZE],
        format: "rgba8unorm",
        label: "homepage-light-fractal-floor-bake",
      }),
    };
    floorBakeSampler = sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    await Promise.all([
      effects.depth.compile(targets.geometry),
      effects.floorBake.compile(targets.floorBake),
      effects.composite.compile({ colors: [canvasSurface.format] }),
    ]);
    if (disposed) return;
    observer = new ResizeObserver(requestResize);
    observer.observe(options.canvas);
    window.addEventListener("resize", onWindowResize);
    resizeAndDraw();
    if (guiModulePromise) {
      const { default: GuiConstructor } = await guiModulePromise;
      if (disposed) return;
      debugGui = createMaterialDebugGui(
        GuiConstructor,
        material,
        requestMaterialDraw,
      );
    }
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

  return { ready, dispose };
}
