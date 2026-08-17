import type GUI from "lil-gui";
import type { Draw, Effect, Geometry, Gpu, Surface, Target } from "vgpu";
import { draw, effect, frame, geometry, sampler, surface, target } from "vgpu";
import { perspectiveCamera, sphere } from "vgpu/scene";
import { loadHeroGlassAssets, type HeroGlassAssets } from "./hero-glass-assets";
import heroDebugAxesWgsl from "./hero-debug-axes.wgsl";
import heroGlassEnvironmentDebugWgsl from "./hero-glass-environment-debug.wgsl";
import heroGlassWireframeWgsl from "./hero-glass-wireframe.wgsl";
import heroGlassWgsl from "./hero-glass.wgsl";
import heroFractalBackgroundWgsl from "./hero-fractal-background.wgsl";
import heroFractalFloorBakeWgsl from "./hero-fractal-floor-bake.wgsl";

const FLOOR_BAKE_SIZE = 512;
const ENVIRONMENT_SPHERE_MODEL = scaleTranslationMatrix(1, [0, 0, 0]);
const GLASS_MODEL_MATRIX = scaleTranslationMatrix(1, [0, 0, 0]);
const ENVIRONMENT_DEBUG_CAMERA_POSITION = [0, 0, 3] as const;
const WORLD_AXES_MODEL_MATRIX = scaleTranslationMatrix(1.45, [0, 0, 0]);
const CAMERA_TARGET_AXES_SCALE = 0.22;

export interface HeroFractalCamera {
  /** XYZ Euler rotation, in radians. */
  readonly cameraRotation: readonly [number, number, number];
  /** Local XYZ offset from the target before rotation. */
  readonly cameraDistance: readonly [number, number, number];
  /** World-space point the camera looks toward. */
  readonly cameraTarget: readonly [number, number, number];
  /** Vertical field of view, in degrees. */
  readonly fov: number;
  /** Maximum mouse-driven orbit angle in degrees. */
  readonly maxMouseRotation: number;
  /** Per-frame interpolation factor used to settle the mouse orbit. */
  readonly mouseLerp: number;
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

export interface HeroFractalGlass {
  /** Uniform scale of the raymarched fractal inside the fixed glass shell. */
  readonly fractalScale: number;
  /** Air-to-glass index of refraction. */
  readonly ior: number;
  /** Maximum distance marched after entering the front glass surface. */
  readonly maxRayDistance: number;
  /** Multiplier for the static studio cubemap. */
  readonly reflectionStrength: number;
  /** Visibility of the directly rendered rear glass surfaces. */
  readonly backOpacity: number;
  /** Beer-Lambert absorption coefficients in linear RGB. */
  readonly absorption: readonly [number, number, number];
}

interface HeroFractalRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly camera: Readonly<HeroFractalCamera>;
  readonly material: Readonly<HeroFractalMaterial>;
  readonly glass: Readonly<HeroFractalGlass>;
  readonly onError?: (error: unknown) => void;
}

export interface HeroFractalRenderer {
  readonly ready: Promise<void>;
  dispose(): void;
}

type DebugView = "final" | "environment";

interface HeroFractalEffects {
  readonly floorBake: Effect;
  readonly background: Effect;
}

interface HeroFractalDraws {
  readonly glassBack: Draw;
  readonly glassFront: Draw;
  readonly glassWireframe: Draw;
  readonly environmentSphere: Draw;
  readonly worldAxes: Draw;
  readonly cameraTargetAxes: Draw;
}

interface HeroFractalTargets {
  readonly floorBake: Target;
}

interface CameraState {
  readonly background: {
    readonly resolution: readonly [number, number];
    readonly cameraPosition: readonly [number, number, number];
    readonly cameraTarget: readonly [number, number, number];
    readonly cameraUp: readonly [number, number, number];
    readonly tanHalfFov: number;
    readonly floorGrid: number;
  };
  readonly viewProjection: Float32Array;
  readonly position: readonly [number, number, number];
}

function createMaterialDebugGui(
  GuiConstructor: typeof GUI,
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    up: [number, number, number];
    fov: number;
    maxMouseRotation: number;
    mouseLerp: number;
  },
  material: {
    baseColor: [number, number, number];
    roughness: number;
    diffuseStrength: number;
    specularStrength: number;
    ambientStrength: number;
    lightIntensity: number;
  },
  glass: {
    fractalScale: number;
    ior: number;
    maxRayDistance: number;
    reflectionStrength: number;
    backOpacity: number;
    absorption: [number, number, number];
  },
  debug: {
    view: DebugView;
    wireframe: boolean;
    floorGrid: boolean;
    coloredAxes: boolean;
    cameraTarget: boolean;
  },
  requestDraw: () => void,
  requestFloorBake: () => void
): GUI {
  const gui = new GuiConstructor({
    title: "Hero fractal material",
    width: 290,
  });
  gui.domElement.dataset.heroFractalMaterialGui = "";
  gui.domElement.style.zIndex = "1000";

  const debugFolder = gui.addFolder("Debug");
  debugFolder.add(debug, "view", ["final", "environment"]).name("view");
  debugFolder.add(debug, "wireframe").name("Wireframe");
  debugFolder.add(debug, "floorGrid").name("Floor grid");
  debugFolder.add(debug, "coloredAxes").name("Colored axes");
  debugFolder.add(debug, "cameraTarget").name("Camera target");

  const cameraFolder = gui.addFolder("Camera");
  addVector3Controllers(cameraFolder, camera.position, "position", -10, 10);
  addVector3Controllers(cameraFolder, camera.target, "target", -3, 3);
  cameraFolder.add(camera, "fov", 10, 100, 0.1).name("FOV");
  cameraFolder.add(camera, "maxMouseRotation", 0, 15, 0.1).name("max rotation");
  cameraFolder.add(camera, "mouseLerp", 0.01, 1, 0.01).name("lerp");

  const ceramic = gui.addFolder("Ceramic");
  ceramic.addColor(material, "baseColor", 1).name("base color");
  ceramic.add(material, "roughness", 0, 1, 0.01).name("roughness");
  ceramic.add(material, "diffuseStrength", 0, 2, 0.01).name("diffuse strength");
  ceramic
    .add(material, "specularStrength", 0, 2, 0.01)
    .name("specular strength");
  ceramic.add(material, "ambientStrength", 0, 1, 0.01).name("ambient fill");

  const glassFolder = gui.addFolder("Glass");
  glassFolder
    .add(glass, "fractalScale", 0.5, 0.99, 0.005)
    .name("fractal scale")
    .onChange(requestFloorBake);
  glassFolder.add(glass, "ior", 1.001, 2.2, 0.001).name("IOR");
  glassFolder
    .add(glass, "maxRayDistance", 0.5, 6, 0.05)
    .name("max ray distance");
  glassFolder.add(glass, "reflectionStrength", 0, 4, 0.01).name("reflection");
  glassFolder.add(glass, "backOpacity", 0, 1, 0.01).name("back opacity");
  glassFolder.addColor(glass, "absorption", 1).name("absorption");

  const light = gui.addFolder("Shared key light");
  light.add(material, "lightIntensity", 0, 8, 0.01).name("intensity");

  gui.onChange(requestDraw);
  return gui;
}

function addVector3Controllers(
  folder: GUI,
  vector: [number, number, number],
  label: string,
  min: number,
  max: number
): void {
  folder.add(vector, "0", min, max, 0.01).name(`${label} x`);
  folder.add(vector, "1", min, max, 0.01).name(`${label} y`);
  folder.add(vector, "2", min, max, 0.01).name(`${label} z`);
}

/** Static, event-driven renderer owned exclusively by the homepage hero. */
export function createHeroFractalRenderer(
  options: HeroFractalRendererOptions
): HeroFractalRenderer {
  let disposed = false;
  let reportedError = false;
  let gpu: Gpu | undefined;
  let canvasSurface: Surface | undefined;
  let effects: HeroFractalEffects | undefined;
  let draws: HeroFractalDraws | undefined;
  let targets: HeroFractalTargets | undefined;
  let assets: HeroGlassAssets | undefined;
  let environmentSphereGeometry: Geometry | undefined;
  let debugAxesGeometry: Geometry | undefined;
  let floorBakeSampler: GPUSampler | undefined;
  let environmentSampler: GPUSampler | undefined;
  let debugGui: GUI | undefined;
  let observer: ResizeObserver | undefined;
  let resizeFrame = 0;
  let materialFrame = 0;
  let cameraFrame = 0;
  let floorBakeReady = false;
  let pointerTargetX = 0;
  let pointerTargetY = 0;
  let pointerCurrentX = 0;
  let pointerCurrentY = 0;
  let lastDpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const material = {
    baseColor: [...options.material.baseColor] as [number, number, number],
    roughness: options.material.roughness,
    diffuseStrength: options.material.diffuseStrength,
    specularStrength: options.material.specularStrength,
    ambientStrength: options.material.ambientStrength,
    lightIntensity: options.material.lightIntensity,
  };
  const glass = {
    fractalScale: options.glass.fractalScale,
    ior: options.glass.ior,
    maxRayDistance: options.glass.maxRayDistance,
    reflectionStrength: options.glass.reflectionStrength,
    backOpacity: options.glass.backOpacity,
    absorption: [...options.glass.absorption] as [number, number, number],
  };
  const initialPositionOffset = rotateCamera(
    options.camera.cameraDistance,
    options.camera.cameraRotation
  );
  const cameraControls = {
    position: add3(options.camera.cameraTarget, initialPositionOffset),
    target: [...options.camera.cameraTarget] as [number, number, number],
    up: rotateCamera([0, 1, 0], options.camera.cameraRotation),
    fov: options.camera.fov,
    maxMouseRotation: options.camera.maxMouseRotation,
    mouseLerp: options.camera.mouseLerp,
  };
  const debug = {
    view: "final" as DebugView,
    wireframe: false,
    floorGrid: false,
    coloredAxes: false,
    cameraTarget: false,
  };
  const debugEnabled = new URLSearchParams(window.location.search).has("debug");

  const cameraState = (resolution: readonly [number, number]): CameraState => {
    const fovRadians = (cameraControls.fov * Math.PI) / 180;
    const cameraPosition = orbitCameraPosition(
      cameraControls.position,
      cameraControls.target,
      cameraControls.up,
      [pointerCurrentX, pointerCurrentY],
      cameraControls.maxMouseRotation
    );
    const camera = perspectiveCamera({
      fov: cameraControls.fov,
      aspect: resolution[0] / Math.max(resolution[1], 1),
      near: 0.05,
      far: 20,
      position: cameraPosition,
      target: cameraControls.target,
      up: cameraControls.up,
    });
    return {
      background: {
        resolution,
        cameraPosition,
        cameraTarget: cameraControls.target,
        cameraUp: cameraControls.up,
        tanHalfFov: Math.tan(fovRadians * 0.5),
        floorGrid: debug.floorGrid ? 1 : 0,
      },
      viewProjection: camera.viewProjectionMatrix as Float32Array,
      position: cameraPosition,
    };
  };

  const drawHero = () => {
    if (
      disposed ||
      !gpu ||
      !canvasSurface ||
      !effects ||
      !draws ||
      !targets ||
      !assets ||
      !floorBakeSampler ||
      !environmentSampler
    )
      return;

    const camera = cameraState(canvasSurface.size);
    const environmentCamera = perspectiveCamera({
      fov: 45,
      aspect: canvasSurface.size[0] / Math.max(canvasSurface.size[1], 1),
      near: 0.05,
      far: 10,
      position: ENVIRONMENT_DEBUG_CAMERA_POSITION,
      target: [0, 0, 0],
    });
    effects.floorBake.set({ params: { fractalScale: glass.fractalScale } });
    effects.background.set({
      params: camera.background,
      floorBakeTexture: targets.floorBake,
      floorSampler: floorBakeSampler,
    });
    const glassParams = {
      viewProjection: camera.viewProjection,
      model: GLASS_MODEL_MATRIX,
      cameraPosition: camera.position,
      meshMin: assets.meshMin,
      meshMax: assets.meshMax,
      ior: glass.ior,
      maxRayDistance: glass.maxRayDistance,
      fractalScale: glass.fractalScale,
      reflectionStrength: glass.reflectionStrength,
      backOpacity: glass.backOpacity,
      absorption: glass.absorption,
      material,
    };
    draws.glassBack.set({
      params: glassParams,
      environmentTexture: assets.environmentView,
      environmentSampler,
    });
    draws.glassFront.set({
      params: glassParams,
      environmentTexture: assets.environmentView,
      environmentSampler,
    });
    draws.glassWireframe.set({
      params: {
        viewProjection: camera.viewProjection,
        model: glassParams.model,
        meshMin: assets.meshMin,
        meshMax: assets.meshMax,
      },
    });
    draws.environmentSphere.set({
      params: {
        viewProjection: environmentCamera.viewProjectionMatrix,
        model: ENVIRONMENT_SPHERE_MODEL,
        cameraPosition: ENVIRONMENT_DEBUG_CAMERA_POSITION,
        reflectionStrength: glass.reflectionStrength,
      },
      environmentTexture: assets.environmentView,
      environmentSampler,
    });
    const debugAxesParams = {
      viewProjection: camera.viewProjection,
      resolution: canvasSurface.size,
      lineWidth: 2.5,
      opacity: 0.94,
    };
    draws.worldAxes.set({
      params: {
        ...debugAxesParams,
        model: WORLD_AXES_MODEL_MATRIX,
      },
    });
    draws.cameraTargetAxes.set({
      params: {
        ...debugAxesParams,
        model: scaleTranslationMatrix(
          CAMERA_TARGET_AXES_SCALE,
          cameraControls.target
        ),
        lineWidth: 3.5,
      },
    });

    const shouldBakeFloor = !floorBakeReady;
    const currentGpu = gpu;
    const currentSurface = canvasSurface;
    const currentEffects = effects;
    const currentDraws = draws;
    const currentTargets = targets;
    frame(currentGpu, (currentFrame) => {
      if (shouldBakeFloor) {
        currentFrame.pass(
          { target: currentTargets.floorBake, clear: [1, 1, 0, 1] },
          (pass) => pass.draw(currentEffects.floorBake)
        );
      }
      currentFrame.pass(
        { target: currentSurface, clear: [1, 1, 1, 1] },
        (pass) => {
          if (debug.view === "environment") {
            pass.draw(currentDraws.environmentSphere);
          } else {
            pass.draw(currentEffects.background);
            pass.draw(currentDraws.glassBack);
            pass.draw(currentDraws.glassFront);
            if (debug.wireframe) pass.draw(currentDraws.glassWireframe);
            if (debug.coloredAxes) pass.draw(currentDraws.worldAxes);
            if (debug.cameraTarget) pass.draw(currentDraws.cameraTargetAxes);
          }
        }
      );
    });
    floorBakeReady = true;
  };

  const requestMaterialDraw = () => {
    if (materialFrame) return;
    materialFrame = requestAnimationFrame(() => {
      materialFrame = 0;
      drawHero();
    });
  };

  const requestFloorBake = () => {
    floorBakeReady = false;
    requestMaterialDraw();
  };

  const animateCamera = () => {
    cameraFrame = 0;
    if (disposed) return;
    const lerp = Math.min(1, Math.max(0.001, cameraControls.mouseLerp));
    pointerCurrentX += (pointerTargetX - pointerCurrentX) * lerp;
    pointerCurrentY += (pointerTargetY - pointerCurrentY) * lerp;
    const remainingX = Math.abs(pointerTargetX - pointerCurrentX);
    const remainingY = Math.abs(pointerTargetY - pointerCurrentY);
    if (remainingX < 0.0001) pointerCurrentX = pointerTargetX;
    if (remainingY < 0.0001) pointerCurrentY = pointerTargetY;
    drawHero();
    if (remainingX >= 0.0001 || remainingY >= 0.0001) {
      cameraFrame = requestAnimationFrame(animateCamera);
    }
  };

  const requestCameraDraw = () => {
    if (!cameraFrame) cameraFrame = requestAnimationFrame(animateCamera);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    pointerTargetX = Math.min(
      1,
      Math.max(-1, (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1)
    );
    pointerTargetY = Math.min(
      1,
      Math.max(-1, (event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1)
    );
    requestCameraDraw();
  };

  const resetPointer = () => {
    pointerTargetX = 0;
    pointerTargetY = 0;
    requestCameraDraw();
  };

  const onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget === null) resetPointer();
  };

  const resizeAndDraw = () => {
    resizeFrame = 0;
    if (disposed || !canvasSurface) return;
    const rect = options.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvasSurface.resize([
      Math.max(1, Math.round(rect.width * dpr)),
      Math.max(1, Math.round(rect.height * dpr)),
    ]);
    drawHero();
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
    if (cameraFrame) cancelAnimationFrame(cameraFrame);
    resizeFrame = 0;
    materialFrame = 0;
    cameraFrame = 0;
    observer?.disconnect();
    observer = undefined;
    window.removeEventListener("resize", onWindowResize);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerout", onPointerOut);
    window.removeEventListener("blur", resetPointer);
    debugGui?.destroy();
    debugGui = undefined;
    draws = undefined;
    effects = undefined;
    (
      targets?.floorBake as (Target & { destroy?: () => void }) | undefined
    )?.destroy?.();
    targets = undefined;
    environmentSphereGeometry?.destroy();
    environmentSphereGeometry = undefined;
    debugAxesGeometry?.destroy();
    debugAxesGeometry = undefined;
    assets?.dispose();
    assets = undefined;
    floorBakeSampler = undefined;
    environmentSampler = undefined;
    canvasSurface?.dispose();
    canvasSurface = undefined;
    gpu?.dispose();
    gpu = undefined;
  };

  const initialize = async () => {
    // Keep lil-gui out of the normal homepage chunk and load it only when the
    // debug query flag is present.
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
    const loadedAssets = await loadHeroGlassAssets(gpu);
    if (disposed) {
      loadedAssets.dispose();
      return;
    }
    assets = loadedAssets;
    environmentSphereGeometry = geometry(
      gpu,
      sphere({
        radius: 0.82,
        widthSegments: 48,
        heightSegments: 24,
      })
    );
    debugAxesGeometry = createDebugAxesGeometry(gpu);
    effects = {
      floorBake: effect(gpu, heroFractalFloorBakeWgsl, {
        label: "homepage-light-fractal-floor-bake",
      }),
      background: effect(gpu, heroFractalBackgroundWgsl, {
        label: "homepage-light-fractal-background",
      }),
    };
    draws = {
      glassBack: draw(gpu, {
        shader: heroGlassWgsl,
        geometry: assets.geometry,
        cull: "front",
        depth: false,
        blend: "premultiplied",
        constants: { ENABLE_RAYMARCH: false },
        label: "homepage-light-glass-back",
      }),
      glassFront: draw(gpu, {
        shader: heroGlassWgsl,
        geometry: assets.geometry,
        cull: "back",
        depth: false,
        blend: "premultiplied",
        constants: { ENABLE_RAYMARCH: true },
        label: "homepage-light-glass-front-fractal",
      }),
      glassWireframe: draw(gpu, {
        shader: heroGlassWireframeWgsl,
        geometry: assets.wireframeGeometry,
        cull: "none",
        depth: false,
        blend: "premultiplied",
        label: "homepage-light-glass-wireframe",
      }),
      environmentSphere: draw(gpu, {
        shader: heroGlassEnvironmentDebugWgsl,
        geometry: environmentSphereGeometry,
        cull: "back",
        depth: false,
        label: "homepage-light-glass-environment-debug",
      }),
      worldAxes: draw(gpu, {
        shader: heroDebugAxesWgsl,
        geometry: debugAxesGeometry,
        cull: "none",
        depth: false,
        blend: "premultiplied",
        label: "homepage-light-world-axes-debug",
      }),
      cameraTargetAxes: draw(gpu, {
        shader: heroDebugAxesWgsl,
        geometry: debugAxesGeometry,
        cull: "none",
        depth: false,
        blend: "premultiplied",
        label: "homepage-light-camera-target-axes-debug",
      }),
    };
    targets = {
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
    environmentSampler = sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
    });
    await Promise.all([
      compileWithLabel(
        "floor bake",
        effects.floorBake.compile(targets.floorBake)
      ),
      compileWithLabel(
        "background",
        effects.background.compile({ colors: [canvasSurface.format] })
      ),
      compileWithLabel(
        "glass back",
        draws.glassBack.compile({ colors: [canvasSurface.format] })
      ),
      compileWithLabel(
        "glass front",
        draws.glassFront.compile({ colors: [canvasSurface.format] })
      ),
      compileWithLabel(
        "glass wireframe",
        draws.glassWireframe.compile({ colors: [canvasSurface.format] })
      ),
      compileWithLabel(
        "environment sphere",
        draws.environmentSphere.compile({ colors: [canvasSurface.format] })
      ),
      compileWithLabel(
        "world axes",
        draws.worldAxes.compile({ colors: [canvasSurface.format] })
      ),
      compileWithLabel(
        "camera target axes",
        draws.cameraTargetAxes.compile({ colors: [canvasSurface.format] })
      ),
    ]);
    if (disposed) return;
    observer = new ResizeObserver(requestResize);
    observer.observe(options.canvas);
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerout", onPointerOut);
    window.addEventListener("blur", resetPointer);
    resizeAndDraw();
    if (guiModulePromise) {
      const { default: GuiConstructor } = await guiModulePromise;
      if (disposed) return;
      debugGui = createMaterialDebugGui(
        GuiConstructor,
        cameraControls,
        material,
        glass,
        debug,
        requestMaterialDraw,
        requestFloorBake
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

async function compileWithLabel(
  label: string,
  compilation: Promise<unknown>
): Promise<void> {
  try {
    await compilation;
  } catch (error) {
    throw new Error(`Hero ${label} pipeline compilation failed.`, {
      cause: error,
    });
  }
}

function createDebugAxesGeometry(gpu: Gpu): Geometry {
  const vertices: number[] = [];
  const corners = [
    [0, -1],
    [0, 1],
    [1, 1],
    [0, -1],
    [1, 1],
    [1, -1],
  ] as const;
  const axes = [
    { end: [1, 0, 0], color: [1, 0.08, 0.05] },
    { end: [0, 1, 0], color: [0.1, 0.78, 0.18] },
    { end: [0, 0, 1], color: [0.05, 0.36, 1] },
  ] as const;

  for (const axis of axes) {
    for (const corner of corners) {
      vertices.push(0, 0, 0, ...axis.end, ...axis.color, ...corner);
    }
  }

  return geometry(gpu, {
    label: "homepage-light-debug-axes",
    buffers: [
      {
        data: new Float32Array(vertices),
        stride: 44,
        attributes: {
          line_start: "float32x3",
          line_end: "float32x3",
          axis_color: "float32x3",
          corner: "float32x2",
        },
      },
    ],
  });
}

function orbitCameraPosition(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
  up: readonly [number, number, number],
  pointer: readonly [number, number],
  maxRotationDegrees: number
): readonly [number, number, number] {
  if (maxRotationDegrees === 0 || (pointer[0] === 0 && pointer[1] === 0)) {
    return position;
  }

  const maxRotation = (maxRotationDegrees * Math.PI) / 180;
  const upAxis = normalize3(up, [0, 1, 0]);
  const offset = subtract3(position, target);
  const yaw = -pointer[0] * maxRotation;
  const yawedOffset = rotateAroundAxis(offset, upAxis, yaw);
  const forward = scale3(yawedOffset, -1);
  const rightAxis = normalize3(cross3(forward, upAxis), [0, 0, 1]);
  const pitch = pointer[1] * maxRotation;
  const orbitOffset = rotateAroundAxis(yawedOffset, rightAxis, pitch);
  return add3(target, orbitOffset);
}

function rotateAroundAxis(
  vector: readonly [number, number, number],
  axis: readonly [number, number, number],
  angle: number
): [number, number, number] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const projection = dot3(axis, vector) * (1 - cosine);
  const perpendicular = cross3(axis, vector);
  return [
    vector[0] * cosine + perpendicular[0] * sine + axis[0] * projection,
    vector[1] * cosine + perpendicular[1] * sine + axis[1] * projection,
    vector[2] * cosine + perpendicular[2] * sine + axis[2] * projection,
  ];
}

function normalize3(
  vector: readonly [number, number, number],
  fallback: readonly [number, number, number]
): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 0.000001) return [...fallback];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function subtract3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(
  vector: readonly [number, number, number],
  scale: number
): [number, number, number] {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

function cross3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rotateCamera(
  vector: readonly [number, number, number],
  rotation: readonly [number, number, number]
): [number, number, number] {
  const cz = Math.cos(rotation[2]);
  const sz = Math.sin(rotation[2]);
  const rolled: [number, number, number] = [
    cz * vector[0] - sz * vector[1],
    sz * vector[0] + cz * vector[1],
    vector[2],
  ];
  const cx = Math.cos(rotation[0]);
  const sx = Math.sin(rotation[0]);
  const pitched: [number, number, number] = [
    rolled[0],
    cx * rolled[1] + sx * rolled[2],
    -sx * rolled[1] + cx * rolled[2],
  ];
  const cy = Math.cos(rotation[1]);
  const sy = Math.sin(rotation[1]);
  return [
    cy * pitched[0] + sy * pitched[2],
    pitched[1],
    -sy * pitched[0] + cy * pitched[2],
  ];
}

function add3(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scaleTranslationMatrix(
  scale: number,
  translation: readonly [number, number, number]
): Float32Array {
  return new Float32Array([
    scale,
    0,
    0,
    0,
    0,
    scale,
    0,
    0,
    0,
    0,
    scale,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ]);
}
