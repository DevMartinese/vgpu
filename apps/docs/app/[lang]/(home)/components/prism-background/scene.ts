/**
 * Deterministic scene graph.
 *
 * The CPU traces wavelength-connected sheets across the finite beam and writes
 * them into one fixed vertex buffer. Every frame draws wall, external light,
 * back-side glass and internal light in painter's order into one 4x MSAA HDR
 * target. A second pass lets the front interface refract that resolved image
 * without reading from its own render attachment. The result then feeds a
 * two visible bloom levels, one broad particle-light level, and the sole
 * tone-mapped presentation pass.
 */

import type {
  Buffer,
  Draw,
  Effect,
  Frame,
  Geometry,
  Gpu,
  Surface,
  Target,
} from "vgpu";
import { draw, effect, frame, sampler, target } from "vgpu";

import {
  cameraView,
  rotationMatrix,
  wallHalfHeight,
  type CameraView,
} from "./camera";
import bloomBlurWgsl from "./bloom-blur.wgsl";
import bloomCompositeWgsl from "./bloom-composite.wgsl";
import bloomExtractWgsl from "./bloom-extract.wgsl";
import {
  BLOOM_KERNEL_TAPS,
  BLOOM_LEVEL_DIVISORS,
  BLOOM_LEVEL_FACTORS,
  BLOOM_LEVELS,
  BLOOM_VISIBLE_LEVELS,
  PARTICLE_LIGHT_FIRST_LEVEL,
  bloomKernelWeights,
  bloomSpread,
} from "./bloom";
import copyLinearWgsl from "./copy-linear.wgsl";
import dustWgsl from "./dust.wgsl";
import {
  createEnvironmentSampler,
  createEnvironmentTexture,
  destroyEnvironmentTexture,
  ENVIRONMENT_SIZE,
  ENVIRONMENT_TEXEL_ANGLE,
  prepareEnvironmentTexture,
  type EnvironmentTexture,
} from "./environment-texture";
import glassBackWgsl from "./glass-back.wgsl";
import glassWgsl from "./glass.wgsl";
import {
  applyProjectionFraming,
  fitProjectionDistance,
  framingCoverage,
  IDENTITY_PROJECTION_FRAMING,
  projectedBounds,
  type NormalizedViewport,
  type ProjectionFraming,
} from "./framing";
import {
  buildLightMesh,
  LIGHT_INTERNAL_QUADS,
  LIGHT_INTERNAL_SEGMENTS,
  LIGHT_INTERNAL_FIRST_VERTEX,
  LIGHT_INTERNAL_VERTICES,
  LIGHT_OUTGOING_FIRST_VERTEX,
  LIGHT_OUTGOING_VERTICES,
  LIGHT_WHITE_QUADS,
  LIGHT_WHITE_VERTICES,
  LIGHT_VERTEX_STRIDE,
  lightVertexCount,
  type LightMeshStats,
} from "./light-mesh";
import lightWgsl from "./light.wgsl";
import lightWireframeWgsl from "./light-wireframe.wgsl";
import particleLightDownsampleWgsl from "./particle-light-downsample.wgsl";
import presentWgsl from "./present.wgsl";
import {
  prismGeometry,
  prismMeshData,
  prismWireframeGeometry,
} from "./prism-mesh";
import wallWgsl from "./wall.wgsl";
import wireframeWgsl from "./wireframe.wgsl";
import {
  DEFAULT_PRISM_CONTROLS,
  CAMERA_DISTANCE,
  PRISM_BACK_Z,
  PRISM_BEAM_SLICES,
  PRISM_DEFAULT_ARC,
  PRISM_DISPERSION_PRESETS,
  PRISM_FRONT_Z,
  PRISM_GLASS,
  PRISM_INCIDENCE_ARC,
  PRISM_LIGHT_PLANE_Z,
  PRISM_LIGHT_FADE_RANGES,
  PRISM_POSTPROCESS_RANGES,
  PRISM_SPECTRAL_DISPERSION_RANGES,
  PRISM_TRIANGLE,
  clampBeamWidth,
  clampCameraFov,
  lampForIncidence,
  type PrismControls,
  type CollimatedLight,
} from "./types";

type Output = Surface | Target;
const ENVIRONMENT_ROTATION = rotationMatrix(PRISM_GLASS.environmentRotation);
const DUST_PARTICLE_COUNT = 2200;
const BLOOM_KERNEL_WEIGHTS = BLOOM_KERNEL_TAPS.map((tapCount) =>
  bloomKernelWeights(tapCount)
);
const CAMERA_FIT_MIN_DISTANCE = PRISM_FRONT_Z + 0.1;
const CAMERA_FIT_MAX_DISTANCE = 32;
const PRISM_FRAME_POINTS = (() => {
  const vertices = prismMeshData().vertices;
  const points: [number, number, number][] = [];
  for (let index = 0; index < vertices.length; index += 6) {
    points.push([vertices[index]!, vertices[index + 1]!, vertices[index + 2]!]);
  }
  return points;
})();
interface BloomLevelTargets {
  readonly horizontal: Target;
  readonly vertical: Target;
}
interface BloomLevelEffects {
  readonly horizontal: Effect;
  readonly vertical: Effect;
}
type BloomTargets = readonly [
  BloomLevelTargets,
  BloomLevelTargets,
  BloomLevelTargets
];
type BloomBlurEffects = readonly [
  BloomLevelEffects,
  BloomLevelEffects,
  BloomLevelEffects
];

export interface PrismScene {
  readonly gpu: Gpu;
  outputSize: readonly [number, number];
  backgroundTarget?: Target;
  sceneTarget?: Target;
  bloomTargets?: BloomTargets;
  readonly light: Draw;
  readonly lightWireframe: Draw;
  readonly dust: Draw;
  readonly lightBuffer: Buffer;
  lightStats: LightMeshStats;
  readonly wall: Draw;
  readonly copyBackground: Effect;
  readonly bloomExtract: Effect;
  readonly bloomBlur: BloomBlurEffects;
  readonly bloomComposite: Effect;
  readonly particleLightDownsample: Effect;
  readonly present: Effect;
  readonly glassBack: Draw;
  readonly glassFront: Draw;
  readonly wireframe: Draw;
  readonly prism: Geometry;
  readonly prismWireframe: Geometry;
  readonly sceneSampler: ReturnType<typeof sampler>;
  readonly environmentSampler: ReturnType<typeof sampler>;
  studioEnvironment?: EnvironmentTexture;
  debugEnvironment?: EnvironmentTexture;
  controls: PrismControls;
  lampArc: number;
  lampTarget: number;
  orbit: readonly [number, number];
  aspect: number;
  cameraDistance: number;
  framingViewport?: NormalizedViewport;
  framing: ProjectionFraming;
  view: CameraView;
  readonly label: string;
}

export function createScene(
  gpu: Gpu,
  output: readonly [number, number],
  label: string
): PrismScene {
  const aspect = output[0] / Math.max(1, output[1]);
  const initialMesh = buildLightMesh({
    light: lampAt(PRISM_DEFAULT_ARC, DEFAULT_PRISM_CONTROLS.beamWidth),
    dispersion:
      DEFAULT_PRISM_CONTROLS.spectralDispersion ??
      PRISM_DISPERSION_PRESETS[DEFAULT_PRISM_CONTROLS.dispersion],
    edgeFalloff: DEFAULT_PRISM_CONTROLS.lightFade.edgeFalloff,
    wallHalfExtent: wallExtent(
      aspect,
      CAMERA_DISTANCE,
      DEFAULT_PRISM_CONTROLS.cameraFov
    ),
  });
  const lightBuffer = gpu.device.createBuffer({
    size: initialMesh.vertices.byteLength,
    usage: ["vertex", "copy_dst"],
    label: `${label}.light-vertices`,
  });
  lightBuffer.write(initialMesh.vertices);
  const lightGeometry = {
    vertexBuffers: [lightBuffer.gpu],
    vertexBufferLayouts: [
      {
        arrayStride: LIGHT_VERTEX_STRIDE,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x2" as const },
          { shaderLocation: 1, offset: 8, format: "float32" as const },
          { shaderLocation: 2, offset: 12, format: "float32" as const },
          { shaderLocation: 3, offset: 16, format: "float32" as const },
          { shaderLocation: 4, offset: 20, format: "float32" as const },
        ],
      },
    ],
    vertexCount: lightVertexCount(),
  };
  const prism = prismGeometry(gpu, `${label}.prism`);
  const prismWireframe = prismWireframeGeometry(
    gpu,
    `${label}.prism-wireframe`
  );
  return {
    gpu,
    outputSize: output,
    light: draw(gpu, {
      shader: lightWgsl,
      geometry: lightGeometry,
      blend: "additive",
      cull: "none",
      depth: false,
      label: `${label}.light`,
    }),
    lightBuffer,
    lightStats: initialMesh.stats,
    wall: draw(gpu, {
      shader: wallWgsl,
      vertices: 6,
      cull: "back",
      depth: false,
      label: `${label}.wall`,
    }),
    copyBackground: effect(gpu, copyLinearWgsl, {
      label: `${label}.pass-b-copy-a`,
    }),
    bloomExtract: effect(gpu, bloomExtractWgsl, {
      label: `${label}.bloom-extract`,
    }),
    bloomBlur: Array.from({ length: BLOOM_LEVELS }, (_, level) => ({
      horizontal: effect(gpu, bloomBlurWgsl, {
        label: `${label}.bloom-${level}-horizontal`,
      }),
      vertical: effect(gpu, bloomBlurWgsl, {
        label: `${label}.bloom-${level}-vertical`,
      }),
    })) as unknown as BloomBlurEffects,
    bloomComposite: effect(gpu, bloomCompositeWgsl, {
      label: `${label}.bloom-composite`,
    }),
    particleLightDownsample: effect(gpu, particleLightDownsampleWgsl, {
      label: `${label}.particle-light-downsample`,
    }),
    present: effect(gpu, presentWgsl, { label: `${label}.present` }),
    glassBack: draw(gpu, {
      shader: glassBackWgsl,
      geometry: prism,
      cull: "front",
      depth: false,
      blend: "premultiplied",
      label: `${label}.glass-back`,
    }),
    glassFront: draw(gpu, {
      shader: glassWgsl,
      geometry: prism,
      cull: "back",
      depth: false,
      label: `${label}.glass-front`,
    }),
    wireframe: draw(gpu, {
      shader: wireframeWgsl,
      geometry: prismWireframe,
      cull: "none",
      depth: false,
      blend: "premultiplied",
      label: `${label}.wireframe`,
    }),
    lightWireframe: draw(gpu, {
      shader: lightWireframeWgsl,
      geometry: lightGeometry,
      cull: "none",
      depth: false,
      blend: "premultiplied",
      label: `${label}.light-wireframe`,
    }),
    dust: draw(gpu, {
      shader: dustWgsl,
      vertices: 6,
      instances: DUST_PARTICLE_COUNT,
      cull: "none",
      depth: false,
      blend: "additive",
      label: `${label}.dust`,
    }),
    prism,
    prismWireframe,
    sceneSampler: sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    }),
    environmentSampler: createEnvironmentSampler(gpu),
    controls: {
      ...DEFAULT_PRISM_CONTROLS,
      spectralDispersion:
        DEFAULT_PRISM_CONTROLS.spectralDispersion ??
        PRISM_DISPERSION_PRESETS[DEFAULT_PRISM_CONTROLS.dispersion],
    },
    lampArc: PRISM_DEFAULT_ARC,
    lampTarget: 0.5,
    orbit: [0, 0],
    aspect,
    cameraDistance: CAMERA_DISTANCE,
    framing: IDENTITY_PROJECTION_FRAMING,
    view: cameraView(
      aspect,
      0,
      0,
      CAMERA_DISTANCE,
      DEFAULT_PRISM_CONTROLS.cameraFov
    ),
    label,
  };
}

function refreshCamera(scene: PrismScene): void {
  const view = cameraView(
    scene.aspect,
    scene.orbit[0],
    scene.orbit[1],
    scene.cameraDistance,
    scene.controls.cameraFov
  );
  scene.view = {
    ...view,
    viewProjection: applyProjectionFraming(view.viewProjection, scene.framing),
  };
}

/**
 * Finds one stable fit for the camera's full pointer orbit. The projection can
 * then rotate interactively without the prism breathing or re-centering.
 */
function refreshFraming(scene: PrismScene): void {
  const viewport = scene.framingViewport;
  if (!viewport) {
    scene.cameraDistance = CAMERA_DISTANCE;
    scene.framing = IDENTITY_PROJECTION_FRAMING;
    return;
  }
  const fit = fitProjectionDistance(
    viewport,
    (distance) =>
      projectedBounds(
        framingMatrices(scene.aspect, distance, scene.controls.cameraFov),
        PRISM_FRAME_POINTS
      ),
    CAMERA_FIT_MIN_DISTANCE,
    CAMERA_FIT_MAX_DISTANCE
  );
  scene.cameraDistance = fit.distance;
  scene.framing = fit.framing;
}

function framingMatrices(
  aspect: number,
  distance: number,
  fov: number
): Float32Array[] {
  const matrices: Float32Array[] = [];
  for (const orbitX of [-1, 0, 1]) {
    for (const orbitY of [-1, 0, 1]) {
      matrices.push(
        cameraView(aspect, orbitX, orbitY, distance, fov).viewProjection
      );
    }
  }
  return matrices;
}

function refreshLightMesh(scene: PrismScene): void {
  const mesh = buildLightMesh({
    light: lampAt(scene.lampArc, scene.controls.beamWidth, scene.lampTarget),
    dispersion:
      scene.controls.spectralDispersion ??
      PRISM_DISPERSION_PRESETS[scene.controls.dispersion],
    edgeFalloff: scene.controls.lightFade.edgeFalloff,
    wallHalfExtent: wallExtent(
      scene.aspect,
      scene.cameraDistance,
      scene.controls.cameraFov,
      scene.framing
    ),
  });
  scene.lightBuffer.write(mesh.vertices);
  scene.lightStats = mesh.stats;
}

export function setControls(scene: PrismScene, controls: PrismControls): void {
  const defaultGlass = DEFAULT_PRISM_CONTROLS.glass;
  const defaultPostprocess = DEFAULT_PRISM_CONTROLS.postprocess;
  const defaultLightFade = DEFAULT_PRISM_CONTROLS.lightFade;
  const inputGlass = controls.glass ?? defaultGlass;
  const inputPostprocess = controls.postprocess ?? defaultPostprocess;
  const inputLightFade = controls.lightFade ?? defaultLightFade;
  const legacyLightFade = inputLightFade as typeof inputLightFade & {
    rainbowFalloff?: number;
  };
  const inputSpectralDispersion =
    controls.spectralDispersion ??
    PRISM_DISPERSION_PRESETS[
      controls.dispersion ?? DEFAULT_PRISM_CONTROLS.dispersion
    ];
  const inputAbsorption = inputGlass.absorption ?? defaultGlass.absorption;
  const finite = (value: number | undefined, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const next = {
    ...controls,
    // Runtime fallback keeps Fast Refresh safe across the control schema change.
    cameraFov: clampCameraFov(
      controls.cameraFov ?? DEFAULT_PRISM_CONTROLS.cameraFov
    ),
    beamWidth: clampBeamWidth(
      controls.beamWidth ?? DEFAULT_PRISM_CONTROLS.beamWidth
    ),
    spectralDispersion: {
      base: Math.min(
        PRISM_SPECTRAL_DISPERSION_RANGES.base.max,
        Math.max(
          PRISM_SPECTRAL_DISPERSION_RANGES.base.min,
          finite(
            inputSpectralDispersion.base,
            PRISM_DISPERSION_PRESETS[DEFAULT_PRISM_CONTROLS.dispersion].base
          )
        )
      ),
      strength: Math.min(
        PRISM_SPECTRAL_DISPERSION_RANGES.strength.max,
        Math.max(
          PRISM_SPECTRAL_DISPERSION_RANGES.strength.min,
          finite(
            inputSpectralDispersion.strength,
            PRISM_DISPERSION_PRESETS[DEFAULT_PRISM_CONTROLS.dispersion].strength
          )
        )
      ),
    },
    lightFade: {
      beamOpacity: Math.min(
        PRISM_LIGHT_FADE_RANGES.beamOpacity.max,
        Math.max(
          PRISM_LIGHT_FADE_RANGES.beamOpacity.min,
          finite(inputLightFade.beamOpacity, defaultLightFade.beamOpacity)
        )
      ),
      edgeFalloff: Math.min(
        PRISM_LIGHT_FADE_RANGES.edgeFalloff.max,
        Math.max(
          PRISM_LIGHT_FADE_RANGES.edgeFalloff.min,
          finite(inputLightFade.edgeFalloff, defaultLightFade.edgeFalloff)
        )
      ),
      rainbowFalloffRate: Math.min(
        PRISM_LIGHT_FADE_RANGES.rainbowFalloffRate.max,
        Math.max(
          PRISM_LIGHT_FADE_RANGES.rainbowFalloffRate.min,
          finite(
            inputLightFade.rainbowFalloffRate ?? legacyLightFade.rainbowFalloff,
            defaultLightFade.rainbowFalloffRate
          )
        )
      ),
      rainbowFalloffPower: Math.min(
        PRISM_LIGHT_FADE_RANGES.rainbowFalloffPower.max,
        Math.max(
          PRISM_LIGHT_FADE_RANGES.rainbowFalloffPower.min,
          finite(
            inputLightFade.rainbowFalloffPower,
            defaultLightFade.rainbowFalloffPower
          )
        )
      ),
    },
    wireframe: controls.wireframe ?? DEFAULT_PRISM_CONTROLS.wireframe,
    lightWireframe:
      controls.lightWireframe ?? DEFAULT_PRISM_CONTROLS.lightWireframe,
    environmentDebug:
      controls.environmentDebug ?? DEFAULT_PRISM_CONTROLS.environmentDebug,
    glass: {
      ior: finite(inputGlass.ior, defaultGlass.ior),
      reflectionStrength: finite(
        inputGlass.reflectionStrength,
        defaultGlass.reflectionStrength
      ),
      absorption: [
        finite(inputAbsorption[0], defaultGlass.absorption[0]),
        finite(inputAbsorption[1], defaultGlass.absorption[1]),
        finite(inputAbsorption[2], defaultGlass.absorption[2]),
      ] as const,
      environmentExposure: finite(
        inputGlass.environmentExposure,
        defaultGlass.environmentExposure
      ),
    },
    postprocess: {
      bloomStrength: finite(
        inputPostprocess.bloomStrength,
        defaultPostprocess.bloomStrength
      ),
      bloomThreshold: finite(
        inputPostprocess.bloomThreshold,
        defaultPostprocess.bloomThreshold
      ),
      bloomRadius: finite(
        inputPostprocess.bloomRadius,
        defaultPostprocess.bloomRadius
      ),
    },
  };
  const opticsChanged =
    next.dispersion !== scene.controls.dispersion ||
    next.spectralDispersion.base !== scene.controls.spectralDispersion?.base ||
    next.spectralDispersion.strength !==
      scene.controls.spectralDispersion?.strength ||
    next.beamWidth !== scene.controls.beamWidth ||
    next.lightFade.edgeFalloff !== scene.controls.lightFade.edgeFalloff;
  const cameraChanged = next.cameraFov !== scene.controls.cameraFov;
  scene.controls = next;
  if (cameraChanged) {
    refreshFraming(scene);
    refreshCamera(scene);
  }
  if (opticsChanged || cameraChanged) refreshLightMesh(scene);
}

export function setLampArc(scene: PrismScene, position: number): void {
  setLampAim(scene, position, scene.lampTarget);
}

export function setLampAim(
  scene: PrismScene,
  arcPosition: number,
  targetPosition: number
): void {
  const nextArc = Math.min(1, Math.max(0, arcPosition));
  const nextTarget = Math.min(1, Math.max(0, targetPosition));
  if (nextArc === scene.lampArc && nextTarget === scene.lampTarget) return;
  scene.lampArc = nextArc;
  scene.lampTarget = nextTarget;
  refreshLightMesh(scene);
}

export function setOrbit(scene: PrismScene, x: number, y: number): void {
  scene.orbit = [Math.min(1, Math.max(-1, x)), Math.min(1, Math.max(-1, y))];
  refreshCamera(scene);
}

export function setFramingViewport(
  scene: PrismScene,
  viewport: NormalizedViewport | undefined
): void {
  if (sameViewport(scene.framingViewport, viewport)) return;
  scene.framingViewport = viewport;
  refreshFraming(scene);
  refreshCamera(scene);
  refreshLightMesh(scene);
}

export function resizeScene(
  scene: PrismScene,
  output: readonly [number, number]
): void {
  scene.outputSize = output;
  scene.aspect = output[0] / Math.max(1, output[1]);
  scene.backgroundTarget?.resize(output);
  scene.sceneTarget?.resize(output);
  scene.bloomTargets?.forEach((bloomLevel, level) => {
    const size = bloomLevelSize(output, level);
    bloomLevel.horizontal.resize(size);
    bloomLevel.vertical.resize(size);
  });
  refreshFraming(scene);
  refreshCamera(scene);
  refreshLightMesh(scene);
}

export function incidenceAt(position: number): number {
  const clamped = Math.min(1, Math.max(0, position));
  return (
    PRISM_INCIDENCE_ARC.min +
    (PRISM_INCIDENCE_ARC.max - PRISM_INCIDENCE_ARC.min) * clamped
  );
}

export function lampAt(
  position: number,
  beamWidth = DEFAULT_PRISM_CONTROLS.beamWidth,
  targetPosition = 0.5
): CollimatedLight {
  return lampForIncidence(incidenceAt(position), beamWidth, targetPosition);
}

export function wallExtent(
  aspect: number,
  cameraDistance = CAMERA_DISTANCE,
  cameraFov = DEFAULT_PRISM_CONTROLS.cameraFov,
  framing: ProjectionFraming = IDENTITY_PROJECTION_FRAMING
): readonly [number, number] {
  const halfHeight = wallHalfHeight(aspect, cameraDistance, cameraFov);
  const coverage = framingCoverage(framing);
  return [halfHeight * aspect * coverage[0], halfHeight * coverage[1]];
}

function sameViewport(
  a: NormalizedViewport | undefined,
  b: NormalizedViewport | undefined
): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.left - b.left) < 1e-5 &&
    Math.abs(a.top - b.top) < 1e-5 &&
    Math.abs(a.right - b.right) < 1e-5 &&
    Math.abs(a.bottom - b.bottom) < 1e-5
  );
}

/** Kept as one shared block so wall, ribbons and glass cannot drift apart. */
export function sceneUniforms(scene: PrismScene): Record<string, unknown> {
  const wallColor = scene.controls.wallColor.match(
    /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i
  );
  return {
    viewProjection: scene.view.viewProjection,
    wallHalfExtent: wallExtent(
      scene.aspect,
      scene.cameraDistance,
      scene.controls.cameraFov,
      scene.framing
    ),
    wallColor: wallColor
      ? wallColor.slice(1).map((channel) => Number.parseInt(channel, 16) / 255)
      : [0, 0, 0],
    causticOnly: scene.controls.view === "caustic" ? 1 : 0,
    lightPlaneZ: PRISM_LIGHT_PLANE_Z,
    lightWhiteQuads: LIGHT_WHITE_QUADS,
    lightBeamSlices: PRISM_BEAM_SLICES,
    lightInternalQuads: LIGHT_INTERNAL_QUADS,
    lightInternalSegments: LIGHT_INTERNAL_SEGMENTS,
    lightOpacity: scene.controls.lightFade.beamOpacity,
    lightEdgeFalloff: scene.controls.lightFade.edgeFalloff,
    rainbowFalloffRate: scene.controls.lightFade.rainbowFalloffRate,
    rainbowFalloffPower: scene.controls.lightFade.rainbowFalloffPower,
  };
}

export function glassUniforms(scene: PrismScene): Record<string, unknown> {
  const glass = scene.controls.glass;
  return {
    viewProjection: scene.view.viewProjection,
    environmentRotation: ENVIRONMENT_ROTATION,
    cameraPosition: scene.view.position,
    absorption: glass.absorption,
    prismA: PRISM_TRIANGLE.a,
    prismB: PRISM_TRIANGLE.b,
    prismC: PRISM_TRIANGLE.c,
    environmentSize: ENVIRONMENT_SIZE,
    frontZ: PRISM_FRONT_Z,
    backZ: PRISM_BACK_Z,
    ior: glass.ior,
    reflectionStrength: glass.reflectionStrength,
    environmentExposure: glass.environmentExposure,
    environmentDebug: scene.controls.environmentDebug ? 1 : 0,
    environmentTexelAngle: ENVIRONMENT_TEXEL_ANGLE,
  };
}

export function dustUniforms(
  scene: PrismScene,
  time: number
): Record<string, unknown> {
  return {
    viewProjection: scene.view.viewProjection,
    fieldHalfExtent: wallExtent(
      scene.aspect,
      scene.cameraDistance,
      scene.controls.cameraFov,
      scene.framing
    ),
    outputSize: scene.outputSize,
    time,
    cameraDistance: scene.cameraDistance,
    lightPlaneZ: PRISM_LIGHT_PLANE_Z,
    prismA: PRISM_TRIANGLE.a,
    prismB: PRISM_TRIANGLE.b,
    prismC: PRISM_TRIANGLE.c,
    prismFrontZ: PRISM_FRONT_Z,
  };
}

export async function prepareScene(
  scene: PrismScene,
  output: Output
): Promise<void> {
  scene.outputSize = output.size;
  scene.aspect = output.size[0] / Math.max(1, output.size[1]);
  refreshFraming(scene);
  refreshCamera(scene);
  refreshLightMesh(scene);
  const backgroundTarget =
    scene.backgroundTarget ??
    target(scene.gpu, {
      size: output.size,
      format: "rgba16float",
      msaa: true,
      label: `${scene.label}.pass-a-back-and-light`,
    });
  scene.backgroundTarget = backgroundTarget;
  const sceneTarget =
    scene.sceneTarget ??
    target(scene.gpu, {
      size: output.size,
      format: "rgba16float",
      msaa: true,
      label: `${scene.label}.pass-b-front-glass`,
    });
  scene.sceneTarget = sceneTarget;
  if (
    backgroundTarget.size[0] !== output.size[0] ||
    backgroundTarget.size[1] !== output.size[1]
  ) {
    backgroundTarget.resize(output.size);
  }
  if (
    sceneTarget.size[0] !== output.size[0] ||
    sceneTarget.size[1] !== output.size[1]
  ) {
    sceneTarget.resize(output.size);
  }
  const bloomTargets =
    scene.bloomTargets ??
    (Array.from({ length: BLOOM_LEVELS }, (_, level) =>
      Object.freeze({
        horizontal: target(scene.gpu, {
          size: bloomLevelSize(output.size, level),
          format: "rgba16float",
          label: `${scene.label}.bloom-${level}-horizontal`,
        }),
        vertical: target(scene.gpu, {
          size: bloomLevelSize(output.size, level),
          format: "rgba16float",
          label: `${scene.label}.bloom-${level}-vertical`,
        }),
      })
    ) as unknown as BloomTargets);
  scene.bloomTargets = bloomTargets;
  bloomTargets.forEach((bloomLevel, level) => {
    const size = bloomLevelSize(output.size, level);
    for (const bloomTarget of [bloomLevel.horizontal, bloomLevel.vertical]) {
      if (bloomTarget.size[0] !== size[0] || bloomTarget.size[1] !== size[1]) {
        bloomTarget.resize(size);
      }
    }
  });
  const studioEnvironment =
    scene.studioEnvironment ??
    createEnvironmentTexture(
      scene.gpu,
      `${scene.label}.environment-studio`,
      false
    );
  const debugEnvironment =
    scene.debugEnvironment ??
    createEnvironmentTexture(
      scene.gpu,
      `${scene.label}.environment-debug`,
      true
    );
  scene.studioEnvironment = studioEnvironment;
  scene.debugEnvironment = debugEnvironment;
  bind(scene, backgroundTarget, sceneTarget, bloomTargets, 0);
  const outputSignature = { colors: [output.format] } as const;
  await Promise.all([
    prepareEnvironmentTexture(
      scene.gpu,
      studioEnvironment,
      scene.environmentSampler
    ),
    prepareEnvironmentTexture(
      scene.gpu,
      debugEnvironment,
      scene.environmentSampler
    ),
    scene.light.compile(backgroundTarget),
    scene.wall.compile(backgroundTarget),
    scene.glassBack.compile(backgroundTarget),
    scene.lightWireframe.compile(backgroundTarget),
    scene.copyBackground.compile(sceneTarget),
    scene.glassFront.compile(sceneTarget),
    scene.wireframe.compile(sceneTarget),
    scene.dust.compile(outputSignature),
    scene.bloomExtract.compile(bloomTargets[0].vertical),
    ...scene.bloomBlur.flatMap((bloom, level) => [
      bloom.horizontal.compile(bloomTargets[level]!.horizontal),
      bloom.vertical.compile(bloomTargets[level]!.vertical),
    ]),
    scene.bloomComposite.compile(bloomTargets[0].horizontal),
    scene.particleLightDownsample.compile(
      bloomTargets[PARTICLE_LIGHT_FIRST_LEVEL].vertical
    ),
    scene.present.compile(outputSignature),
  ]);
}

export function presentScene(
  scene: PrismScene,
  output: Output,
  currentFrame?: Frame,
  time = 0,
  updateScene = true
): void {
  const backgroundTarget = scene.backgroundTarget;
  const sceneTarget = scene.sceneTarget;
  const bloomTargets = scene.bloomTargets;
  if (!backgroundTarget || !sceneTarget || !bloomTargets) {
    throw new Error("prepareScene must run before presentScene.");
  }
  bind(scene, backgroundTarget, sceneTarget, bloomTargets, time);
  const encode = (current: Frame) => {
    // `wall` and `caustic` are hidden test isolations. Both composed views run
    // the exact same Pass A; these flags only let GPU tests inspect its inputs.
    const showBackFace =
      scene.controls.view === "glass" || scene.controls.view === "back";
    const showLight = scene.controls.view !== "wall";
    if (updateScene) {
      // Pass A: wall -> external light -> transparent back face -> internal
      // light. All four draws share one full-resolution MSAA render pass.
      current.pass(
        { target: backgroundTarget, clear: [0, 0, 0, 1] },
        (pass) => {
          pass.draw(scene.wall);
          if (showLight) {
            pass.draw(scene.light, {
              firstVertex: 0,
              vertices: LIGHT_WHITE_VERTICES,
            });
            pass.draw(scene.light, {
              firstVertex: LIGHT_OUTGOING_FIRST_VERTEX,
              vertices: LIGHT_OUTGOING_VERTICES,
            });
            if (scene.controls.lightWireframe) {
              pass.draw(scene.lightWireframe, {
                firstVertex: 0,
                vertices: LIGHT_WHITE_VERTICES,
              });
              pass.draw(scene.lightWireframe, {
                firstVertex: LIGHT_OUTGOING_FIRST_VERTEX,
                vertices: LIGHT_OUTGOING_VERTICES,
              });
            }
          }
          if (showBackFace) pass.draw(scene.glassBack);
          if (showLight) {
            pass.draw(scene.light, {
              firstVertex: LIGHT_INTERNAL_FIRST_VERTEX,
              vertices: LIGHT_INTERNAL_VERTICES,
            });
            if (scene.controls.lightWireframe) {
              pass.draw(scene.lightWireframe, {
                firstVertex: LIGHT_INTERNAL_FIRST_VERTEX,
                vertices: LIGHT_INTERNAL_VERTICES,
              });
            }
          }
        }
      );
      // Pass B first preserves Pass A over the full frame, then replaces only
      // the prism silhouette with the front material sampling Pass A.
      current.pass({ target: sceneTarget, clear: [0, 0, 0, 1] }, (pass) => {
        pass.draw(scene.copyBackground);
        if (scene.controls.view === "glass") {
          pass.draw(scene.glassFront);
          if (scene.controls.wireframe) pass.draw(scene.wireframe);
        }
      });
      current.pass(
        { target: bloomTargets[0].vertical, clear: [0, 0, 0, 1] },
        (pass) => {
          pass.draw(scene.bloomExtract);
        }
      );
      bloomTargets
        .slice(0, BLOOM_VISIBLE_LEVELS)
        .forEach((bloomLevel, level) => {
          current.pass(
            { target: bloomLevel.horizontal, clear: [0, 0, 0, 1] },
            (pass) => {
              pass.draw(scene.bloomBlur[level]!.horizontal);
            }
          );
          current.pass(
            { target: bloomLevel.vertical, clear: [0, 0, 0, 1] },
            (pass) => {
              pass.draw(scene.bloomBlur[level]!.vertical);
            }
          );
        });
      current.pass(
        {
          target: bloomTargets[PARTICLE_LIGHT_FIRST_LEVEL].vertical,
          clear: [0, 0, 0, 1],
        },
        (pass) => {
          pass.draw(scene.particleLightDownsample);
        }
      );
      bloomTargets
        .slice(PARTICLE_LIGHT_FIRST_LEVEL)
        .forEach((bloomLevel, index) => {
          const level = PARTICLE_LIGHT_FIRST_LEVEL + index;
          current.pass(
            { target: bloomLevel.horizontal, clear: [0, 0, 0, 1] },
            (pass) => {
              pass.draw(scene.bloomBlur[level]!.horizontal);
            }
          );
          current.pass(
            { target: bloomLevel.vertical, clear: [0, 0, 0, 1] },
            (pass) => {
              pass.draw(scene.bloomBlur[level]!.vertical);
            }
          );
        });
      current.pass(
        { target: bloomTargets[0].horizontal, clear: [0, 0, 0, 1] },
        (pass) => {
          pass.draw(scene.bloomComposite);
        }
      );
    }
    current.pass({ target: output }, (pass) => {
      pass.draw(scene.present);
      if (scene.controls.view === "glass") {
        pass.draw(scene.dust, {
          instances: DUST_PARTICLE_COUNT,
        });
      }
    });
  };
  if (currentFrame) encode(currentFrame);
  else frame(scene.gpu, encode);
}

function bind(
  scene: PrismScene,
  backgroundTarget: Target,
  sceneTarget: Target,
  bloomTargets: BloomTargets,
  time: number
): void {
  const studioEnvironment = scene.studioEnvironment;
  const debugEnvironment = scene.debugEnvironment;
  if (!studioEnvironment || !debugEnvironment) {
    throw new Error(
      "Environment textures must exist before binding the scene."
    );
  }
  const values = sceneUniforms(scene);
  scene.light.set({ scene: values });
  scene.lightWireframe.set({ scene: values });
  scene.wall.set({ scene: values });
  scene.copyBackground.set({ sceneTexture: backgroundTarget });
  scene.glassBack.set({
    params: glassUniforms(scene),
    studioEnvironment: studioEnvironment.texture,
    debugEnvironment: debugEnvironment.texture,
    environmentSampler: scene.environmentSampler,
  });
  scene.glassFront.set({
    params: glassUniforms(scene),
    sceneTexture: backgroundTarget,
    sceneSampler: scene.sceneSampler,
    studioEnvironment: studioEnvironment.texture,
    debugEnvironment: debugEnvironment.texture,
    environmentSampler: scene.environmentSampler,
  });
  scene.wireframe.set({
    params: { viewProjection: scene.view.viewProjection },
  });
  scene.bloomExtract.set({
    sourceTexture: sceneTarget,
    sourceSampler: scene.sceneSampler,
    params: { threshold: scene.controls.postprocess.bloomThreshold },
  });
  const particleLightTarget = bloomTargets[PARTICLE_LIGHT_FIRST_LEVEL];
  scene.particleLightDownsample.set({
    sourceTexture: sceneTarget,
    sourceSampler: scene.sceneSampler,
    params: {
      sourceTexelSize: [1 / sceneTarget.size[0], 1 / sceneTarget.size[1]],
      sourceToTargetScale: [
        sceneTarget.size[0] / particleLightTarget.vertical.size[0],
        sceneTarget.size[1] / particleLightTarget.vertical.size[1],
      ],
    },
  });
  scene.bloomBlur.forEach((bloom, level) => {
    const targetLevel = bloomTargets[level]!;
    const horizontalSource =
      level === 0 || level === PARTICLE_LIGHT_FIRST_LEVEL
        ? targetLevel.vertical
        : bloomTargets[level - 1]!.vertical;
    const tapCount = BLOOM_KERNEL_TAPS[level]!;
    const coefficients = BLOOM_KERNEL_WEIGHTS[level]!;
    const commonParams = {
      texelSize: [
        1 / targetLevel.horizontal.size[0],
        1 / targetLevel.horizontal.size[1],
      ],
      tapCount,
      coefficients0: coefficients.slice(0, 4),
      coefficients1: coefficients.slice(4, 8),
      coefficients2: coefficients.slice(8, 12),
      coefficients3: coefficients.slice(12, 16),
      coefficients4: coefficients.slice(16, 20),
      coefficients5: coefficients.slice(20, 24),
    };
    bloom.horizontal.set({
      sourceTexture: horizontalSource,
      sourceSampler: scene.sceneSampler,
      params: { ...commonParams, direction: [1, 0] },
    });
    bloom.vertical.set({
      sourceTexture: targetLevel.horizontal,
      sourceSampler: scene.sceneSampler,
      params: { ...commonParams, direction: [0, 1] },
    });
  });
  scene.bloomComposite.set({
    level0Texture: bloomTargets[0].vertical,
    level1Texture: bloomTargets[1].vertical,
    levelSampler: scene.sceneSampler,
    params: {
      radius: bloomSpread(
        scene.controls.postprocess.bloomRadius,
        PRISM_POSTPROCESS_RANGES.bloomRadius.min,
        PRISM_POSTPROCESS_RANGES.bloomRadius.max
      ),
      factors: [...BLOOM_LEVEL_FACTORS, 0, 0],
    },
  });
  scene.present.set({
    sceneTexture: sceneTarget,
    bloomTexture: bloomTargets[0].horizontal,
    bloomSampler: scene.sceneSampler,
    params: {
      bloomStrength:
        scene.controls.view === "glass"
          ? scene.controls.postprocess.bloomStrength
          : 0,
    },
  });
  scene.dust.set({
    params: dustUniforms(scene, time),
    colorTexture: bloomTargets[1].vertical,
    lightTexture: bloomTargets[2].vertical,
    lightSampler: scene.sceneSampler,
  });
}

function bloomLevelSize(
  size: readonly [number, number],
  level: number
): readonly [number, number] {
  const divisor = BLOOM_LEVEL_DIVISORS[level] ?? BLOOM_LEVEL_DIVISORS.at(-1)!;
  return [
    Math.max(1, Math.ceil(size[0] / divisor)),
    Math.max(1, Math.ceil(size[1] / divisor)),
  ];
}

function destroyTarget(value: Target | undefined): void {
  (value as (Target & { destroy?: () => void }) | undefined)?.destroy?.();
}

export function destroyScene(scene: PrismScene): void {
  destroyTarget(scene.backgroundTarget);
  scene.backgroundTarget = undefined;
  destroyTarget(scene.sceneTarget);
  scene.sceneTarget = undefined;
  scene.bloomTargets?.forEach((bloomLevel) => {
    destroyTarget(bloomLevel.horizontal);
    destroyTarget(bloomLevel.vertical);
  });
  scene.bloomTargets = undefined;
  destroyEnvironmentTexture(scene.studioEnvironment);
  scene.studioEnvironment = undefined;
  destroyEnvironmentTexture(scene.debugEnvironment);
  scene.debugEnvironment = undefined;
  scene.lightBuffer.destroy();
  scene.prism.destroy();
  scene.prismWireframe.destroy();
}
