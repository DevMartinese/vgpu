// Additive rasterization of the deterministic CPU ray bundle as a world-space
// sheet halfway through the prism's depth.
//
// Inside the prism, every sampled wavelength is a finite-width strip spanning
// adjacent beam boundaries, so all colors overlap into white at entry and
// separate continuously as they travel. The outgoing fan connects neighbouring
// wavelengths. The fragment stage only applies intensity and beam falloff.

import { Scene } from "./scene.wgsl";
import { wavelengthToBeamRgb } from "./materials/shared/spectral.wgsl";

@group(0) @binding(0) var<uniform> scene: Scene;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) profile: f32,
  @location(2) intensity: f32,
  @location(3) travel: f32,
};

@vertex
fn vs_main(
  @location(0) position: vec2f,
  @location(1) wavelength: f32,
  @location(2) profile: f32,
  @location(3) intensity: f32,
  @location(4) travel: f32,
) -> VertexOut {
  var out: VertexOut;
  out.position = scene.viewProjection * vec4f(position, scene.lightPlaneZ, 1.0);
  let spectral = wavelengthToBeamRgb(max(wavelength, 400.0));
  out.color = select(spectral, vec3f(1.0), wavelength < 0.0);
  out.profile = profile;
  out.intensity = intensity;
  out.travel = travel;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let radius = abs(in.profile);
  let radialFalloff = exp(-scene.lightEdgeFalloff * radius * radius)
    * (1.0 - smoothstep(0.55, 1.0, radius));
  // Geometric dilution falls quickly near the effective source, then leaves a
  // progressively softer tail. Unlike the previous exponential plus cutoff,
  // this never introduces a second abrupt fade near the wall.
  let attenuationDistance = max(scene.rainbowFalloffRate, 0.0)
    * max(in.travel, 0.0);
  let longitudinalFalloff = 1.0 / pow(
    1.0 + attenuationDistance,
    max(scene.rainbowFalloffPower, 0.0001),
  );
  return vec4f(
    in.color * in.intensity * radialFalloff * longitudinalFalloff
      * max(scene.lightOpacity, 0.0),
    0.0,
  );
}
