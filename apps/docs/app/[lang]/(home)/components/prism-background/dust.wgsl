// Sparse volumetric dust, composited after tone mapping.
//
// Every instance is a tiny screen-facing quad whose 3D position is derived from
// its index. The first bloom level is the illumination volume projected onto the
// screen: away from HDR light it is black and the fragment is discarded; closer
// to a beam its smoothly increasing radiance lights the mote with the same hue.

import { linearToSrgb3, tonemapAces } from "@vgpu/wgsl-std/color";

struct DustParams {
  viewProjection: mat4x4f,
  fieldHalfExtent: vec2f,
  outputSize: vec2f,
  time: f32,
  cameraDistance: f32,
  lightPlaneZ: f32,
  exposure: f32,
}

@group(0) @binding(0) var<uniform> params: DustParams;
@group(0) @binding(1) var lightTexture: texture_2d<f32>;
@group(0) @binding(2) var lightSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) pointCoord: vec2f,
  @location(1) lightUv: vec2f,
  @location(2) sparkle: f32,
};

const TAU: f32 = 6.28318530718;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453);
}

fn quadCorner(vertexIndex: u32) -> vec2f {
  let cornerIndex = array<u32, 6>(0u, 1u, 2u, 2u, 1u, 3u)[vertexIndex % 6u];
  switch (cornerIndex) {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f( 1.0, -1.0); }
    case 2u: { return vec2f(-1.0,  1.0); }
    default: { return vec2f( 1.0,  1.0); }
  }
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let id = f32(instanceIndex) + 1.0;
  let seedX = hash11(id * 1.113);
  let seedY = hash11(id * 2.371 + 7.0);
  let seedZ = hash11(id * 4.117 + 19.0);
  let seedDepth = hash11(id * 5.923 + 23.0);
  let seedSize = hash11(id * 7.731 + 31.0);

  // A triangular depth distribution concentrates most motes around the same
  // plane as the light sheet. The small remaining spread still reads as volume,
  // without the strong parallax caused by particles close to the camera.
  let dustZ = params.lightPlaneZ + (seedZ + seedDepth - 1.0) * 0.14;
  var worldPosition = vec3f(
    (seedX * 2.0 - 1.0) * params.fieldHalfExtent.x,
    (seedY * 2.0 - 1.0) * params.fieldHalfExtent.y,
    dustZ,
  );
  // `fieldHalfExtent` describes the wall plane. Narrow it towards the camera
  // so every depth slice fills approximately the same visible frustum instead
  // of wasting most of the close particles outside the viewport.
  let depthScale = clamp(
    (params.cameraDistance - worldPosition.z) / max(params.cameraDistance, 0.001),
    0.08,
    1.0,
  );
  worldPosition.x *= depthScale;
  worldPosition.y *= depthScale;
  worldPosition += vec3f(
    sin(params.time * mix(0.09, 0.17, seedY) + seedZ * TAU) * mix(0.008, 0.035, seedSize),
    sin(params.time * mix(0.07, 0.14, seedZ) + seedX * TAU) * mix(0.01, 0.04, seedY),
    sin(params.time * mix(0.05, 0.1, seedX) + seedY * TAU) * mix(0.006, 0.025, seedZ),
  );

  let projected = params.viewProjection * vec4f(worldPosition, 1.0);
  let ndc = projected.xy / max(projected.w, 0.00001);
  let corner = quadCorner(vertexIndex);
  let radiusPixels = mix(1.5, 4.0, seedSize);
  let clipOffset = corner * radiusPixels * 2.0 / max(params.outputSize, vec2f(1.0));

  var out: VertexOut;
  out.position = vec4f(
    projected.xy + clipOffset * projected.w,
    projected.z,
    projected.w,
  );
  out.pointCoord = corner;
  out.lightUv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  out.sparkle = mix(0.55, 1.0, hash11(id * 11.917 + 43.0));
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let radiusSquared = dot(in.pointCoord, in.pointCoord);
  if (radiusSquared > 1.0) { discard; }

  let light = max(
    textureSampleLevel(lightTexture, lightSampler, in.lightUv, 0.0).rgb,
    vec3f(0.0),
  );
  let brightness = max(max(light.r, light.g), light.b);
  // The reconstructed bloom halo is deliberately low-energy away from the
  // beam. Read that tail as distance: it turns motes on before they overlap the
  // saturated core, while a zero sample still produces exactly no particle.
  let illumination = smoothstep(0.000001, 0.0035, brightness);
  if (illumination < 0.002) { discard; }

  let radial = exp(-radiusSquared * 3.0);
  let lightColor = linearToSrgb3(tonemapAces(light));
  let hue = mix(lightColor, vec3f(1.0), 0.42);
  let energy = illumination * radial * in.sparkle * 0.42
    * max(params.exposure, 0.0);
  return vec4f(hue * energy, 0.0);
}
