import type { Buffer, Geometry, GeometryLike, Gpu } from "vgpu";

import type { CameraView } from "../camera";
import type { EnvironmentTexture } from "../environment-texture";
import type { NormalizedViewport, ProjectionFraming } from "../framing";
import type { LightMeshStats } from "../light-mesh";
import type { PrismControls } from "../types";

export interface PrismLightMeshMeasurement {
  readonly buildMs: number;
  readonly uploadMs: number;
  readonly bytes: number;
}

/** Installed only while the opt-in performance sampler owns the frame loop. */
export interface PrismRuntimeMeasurementSink {
  now(): number;
  recordLightMesh(sample: PrismLightMeshMeasurement): void;
}

/** Retained identities and mutable optical/camera state shared by both modes. */
export interface PrismRuntime {
  readonly gpu: Gpu;
  readonly label: string;
  readonly lightBuffer: Buffer;
  readonly lightVertexScratch: number[];
  readonly lightVertices: Float32Array<ArrayBuffer>;
  readonly lightGeometry: GeometryLike;
  readonly prism: Geometry;
  readonly prismWireframe: Geometry;
  readonly sceneSampler: GPUSampler;
  readonly environmentSampler: GPUSampler;
  /** Allocates the authored orientation map only for the opt-in debug UI. */
  readonly debugEnvironmentEnabled: boolean;
  studioEnvironment?: EnvironmentTexture;
  debugEnvironment?: EnvironmentTexture;
  environmentReady?: Promise<void>;
  outputSize: readonly [number, number];
  lightStats: LightMeshStats;
  controls: PrismControls;
  lampArc: number;
  lampTarget: number;
  orbit: readonly [number, number];
  aspect: number;
  cameraDistance: number;
  framingViewport?: NormalizedViewport;
  framing: ProjectionFraming;
  view: CameraView;
  measurementSink?: PrismRuntimeMeasurementSink;
}
