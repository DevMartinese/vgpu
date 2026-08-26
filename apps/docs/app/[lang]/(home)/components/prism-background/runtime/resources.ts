import type { Gpu } from "vgpu";
import { sampler } from "vgpu";

import { cameraView } from "../camera";
import {
  createEnvironmentSampler,
  createEnvironmentTexture,
  destroyEnvironmentTexture,
  prepareEnvironmentTexture,
} from "../environment-texture";
import { IDENTITY_PROJECTION_FRAMING } from "../framing";
import {
  buildLightMesh,
  LIGHT_VERTEX_STRIDE,
  lightVertexCount,
} from "../light-mesh";
import { prismGeometry, prismWireframeGeometry } from "../prism-mesh";
import {
  CAMERA_DISTANCE,
  DEFAULT_PRISM_CONTROLS,
  PRISM_DEFAULT_ARC,
  PRISM_DISPERSION_PRESETS,
} from "../types";
import { normalizeControls } from "./normalize-controls";
import { settleAllOrThrow } from "./settle";
import { lampAt, wallExtent } from "./state";
import type { PrismRuntime } from "./types";

export function createPrismRuntime(
  gpu: Gpu,
  output: readonly [number, number],
  label: string
): PrismRuntime {
  const controls = normalizeControls(DEFAULT_PRISM_CONTROLS);
  const aspect = output[0] / Math.max(1, output[1]);
  const lightVertexScratch: number[] = [];
  const initialMesh = buildLightMesh(
    {
      light: lampAt(
        PRISM_DEFAULT_ARC,
        controls.beamWidth,
        0.5,
        controls.beamMouseY
      ),
      dispersion:
        controls.spectralDispersion ??
        PRISM_DISPERSION_PRESETS[controls.dispersion],
      edgeFalloff: controls.lightFade.edgeFalloff,
      wallHalfExtent: wallExtent(aspect, CAMERA_DISTANCE, controls.cameraFov),
    },
    undefined,
    lightVertexScratch
  );
  const lightBuffer = gpu.device.createBuffer({
    size: initialMesh.vertices.byteLength,
    usage: ["vertex", "copy_dst"],
    label: `${label}.light-vertices`,
  });
  lightBuffer.write(initialMesh.vertices);
  const prism = prismGeometry(gpu, `${label}.prism`);
  const prismWireframe = prismWireframeGeometry(
    gpu,
    `${label}.prism-wireframe`
  );

  return {
    gpu,
    label,
    outputSize: output,
    lightBuffer,
    lightVertexScratch,
    lightVertices: initialMesh.vertices,
    lightGeometry: {
      vertexBuffers: [lightBuffer.gpu],
      vertexBufferLayouts: [
        {
          arrayStride: LIGHT_VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x2" },
            { shaderLocation: 3, offset: 8, format: "float32" },
          ],
        },
      ],
      vertexCount: lightVertexCount(),
    },
    prism,
    prismWireframe,
    sceneSampler: sampler(gpu, {
      minFilter: "linear",
      magFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    }),
    environmentSampler: createEnvironmentSampler(gpu),
    controls,
    lightStats: initialMesh.stats,
    lampArc: PRISM_DEFAULT_ARC,
    lampTarget: 0.5,
    orbit: [0, 0],
    aspect,
    cameraDistance: CAMERA_DISTANCE,
    framing: IDENTITY_PROJECTION_FRAMING,
    view: cameraView(aspect, 0, 0, CAMERA_DISTANCE, controls.cameraFov),
  };
}

/** Builds the cubemaps once and shares the same promise across both pipelines. */
export function prepareRuntimeEnvironment(
  runtime: PrismRuntime
): Promise<void> {
  if (runtime.environmentReady) return runtime.environmentReady;
  runtime.studioEnvironment ??= createEnvironmentTexture(
    runtime.gpu,
    `${runtime.label}.environment-studio`,
    false
  );
  runtime.debugEnvironment ??= createEnvironmentTexture(
    runtime.gpu,
    `${runtime.label}.environment-debug`,
    true
  );
  runtime.environmentReady = settleAllOrThrow([
    prepareEnvironmentTexture(
      runtime.gpu,
      runtime.studioEnvironment,
      runtime.environmentSampler
    ),
    prepareEnvironmentTexture(
      runtime.gpu,
      runtime.debugEnvironment,
      runtime.environmentSampler
    ),
  ]);
  return runtime.environmentReady;
}

export function destroyPrismRuntime(runtime: PrismRuntime): void {
  destroyEnvironmentTexture(runtime.studioEnvironment);
  runtime.studioEnvironment = undefined;
  destroyEnvironmentTexture(runtime.debugEnvironment);
  runtime.debugEnvironment = undefined;
  runtime.environmentReady = undefined;
  runtime.lightBuffer.destroy();
  runtime.prism.destroy();
  runtime.prismWireframe.destroy();
}
