// Additive rasterization of the deterministic CPU ray bundle as a world-space
// sheet halfway through the prism's depth.
//
// Inside the prism, every sampled wavelength is a finite-width strip spanning
// adjacent beam boundaries, so all colors overlap into white at entry and
// separate continuously as they travel. The outgoing fan connects neighbouring
// wavelengths. The fragment stage only applies intensity and beam falloff.

import { Scene } from "./scene.wgsl";

fn cieX(wavelength: f32) -> f32 {
  let t1 = (wavelength - 442.0) * select(0.0374, 0.0624, wavelength < 442.0);
  let t2 = (wavelength - 599.8) * select(0.0323, 0.0264, wavelength < 599.8);
  let t3 = (wavelength - 501.1) * select(0.0382, 0.0490, wavelength < 501.1);
  return 0.362 * exp(-0.5 * t1 * t1)
    + 1.056 * exp(-0.5 * t2 * t2)
    - 0.065 * exp(-0.5 * t3 * t3);
}

fn cieY(wavelength: f32) -> f32 {
  let t1 = (wavelength - 568.8) * select(0.0247, 0.0213, wavelength < 568.8);
  let t2 = (wavelength - 530.9) * select(0.0322, 0.0613, wavelength < 530.9);
  return 0.821 * exp(-0.5 * t1 * t1) + 0.286 * exp(-0.5 * t2 * t2);
}

fn cieZ(wavelength: f32) -> f32 {
  let t1 = (wavelength - 437.0) * select(0.0278, 0.0845, wavelength < 437.0);
  let t2 = (wavelength - 459.0) * select(0.0725, 0.0385, wavelength < 459.0);
  return 1.217 * exp(-0.5 * t1 * t1) + 0.681 * exp(-0.5 * t2 * t2);
}

// CIE standard illuminant D65, 400–700 nm in 10 nm steps. The complete
// spectrum shares one exposure; individual wavelengths are never normalized.
fn d65SpectralPower(wavelength: f32) -> f32 {
  let values = array<f32, 31>(
    82.7549, 91.486, 93.4318, 86.6823, 104.865, 117.008, 117.812,
    114.861, 115.923, 108.811, 109.354, 107.802, 104.79, 107.689,
    104.405, 104.046, 100.0, 96.3342, 95.788, 88.6856, 90.0062,
    89.5991, 87.6987, 83.2886, 83.6992, 80.0268, 80.2146, 82.2778,
    78.2842, 69.7213, 71.6091,
  );
  let coordinate = clamp((wavelength - 400.0) / 10.0, 0.0, 30.0);
  let lower = min(u32(coordinate), 29u);
  let fraction = coordinate - f32(lower);
  return mix(values[lower], values[lower + 1u], fraction) * 0.01;
}

fn wavelengthToBeamRgb(wavelength: f32) -> vec3f {
  let clampedWavelength = clamp(wavelength, 400.0, 700.0);
  let xyz = vec3f(
    cieX(clampedWavelength),
    cieY(clampedWavelength),
    cieZ(clampedWavelength),
  );
  let linearRgb = vec3f(
    3.2406 * xyz.x - 1.5372 * xyz.y - 0.4986 * xyz.z,
    -0.9689 * xyz.x + 1.8758 * xyz.y + 0.0415 * xyz.z,
    0.0557 * xyz.x - 0.2040 * xyz.y + 1.0570 * xyz.z,
  );
  // Monochromatic colors leave the sRGB gamut. Moving the whole triplet toward
  // the neutral axis makes it positive; normalizing it then separates hue from
  // the smooth photopic energy envelope, avoiding display-primary dark bands.
  let neutralOffset = min(min(linearRgb.r, linearRgb.g), min(linearRgb.b, 0.0));
  let positiveRgb = linearRgb - vec3f(neutralOffset);
  let hue = positiveRgb
    / max(max(positiveRgb.r, positiveRgb.g), max(positiveRgb.b, 1.0e-6));
  let relativePhotopicPower = d65SpectralPower(clampedWavelength)
    * xyz.y
    / 1.0347;
  let spectralExposure = 4.5;
  let displayPower = (1.0 - exp(-spectralExposure * relativePhotopicPower))
    / (1.0 - exp(-spectralExposure));
  // One global chromatic adaptation keeps all overlapping wavelengths neutral;
  // unlike the removed hue ramp, it never normalizes wavelengths independently.
  let whiteBalance = vec3f(1.1868, 1.0, 2.2495);
  return hue * displayPower * whiteBalance;
}

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
