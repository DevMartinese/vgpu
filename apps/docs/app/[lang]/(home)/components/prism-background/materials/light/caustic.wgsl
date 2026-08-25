import { Scene } from "../../scene.wgsl";
import { wavelengthToBeamRgb } from "../shared/spectral.wgsl";

struct CausticParams {
  strength: f32,
  coverage: f32,
  farDesaturation: f32,
  farBrightness: f32,
  travelScale: f32,
  falloffRateScale: f32,
  falloffPowerScale: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var<uniform> caustic: CausticParams;
@group(0) @binding(2) var causticProfile: texture_2d<f32>;
@group(0) @binding(3) var causticSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) profile: f32,
  @location(2) intensity: f32,
  @location(3) travel: f32,
  @location(4) wavelength: f32,
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
  // One continuous physical cross-section must keep one depth. Putting the
  // exterior rays on the wall and the interior rays inside the glass makes the
  // shared entry/exit vertices project to different pixels under perspective.
  out.position = scene.viewProjection * vec4f(position, scene.lightPlaneZ, 1.0);
  out.color = select(wavelengthToBeamRgb(wavelength), vec3f(1.0), wavelength < 0.0);
  out.profile = profile;
  out.intensity = intensity;
  out.travel = travel;
  out.wavelength = wavelength;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let radius = abs(in.profile);
  let radial = exp(-scene.lightEdgeFalloff * radius * radius)
    * (1.0 - smoothstep(0.55, 1.0, radius));
  let distance = clamp(in.travel / max(caustic.travelScale, 0.001), 0.0, 1.0);
  let wavelengthUv = clamp((700.0 - max(in.wavelength, 400.0)) / 300.0, 0.0, 1.0);
  let baked = textureSample(causticProfile, causticSampler, vec2f(distance, wavelengthUv));
  let outgoingFalloff = 1.0 / pow(
    1.0
      + max(scene.rainbowFalloffRate, 0.0)
        * max(caustic.falloffRateScale, 0.0)
        * max(in.travel, 0.0),
    max(
      scene.rainbowFalloffPower * max(caustic.falloffPowerScale, 0.0),
      0.0001,
    ),
  );
  let energy = max(in.intensity, 0.0) * radial * outgoingFalloff
    * max(scene.lightOpacity, 0.0) * baked.a;
  let bounded = 1.0 - exp(-energy * max(caustic.strength, 0.0));
  let farMix = smoothstep(0.16, 0.92, distance) * caustic.farDesaturation;
  let spectral = in.color * mix(vec3f(1.0), baked.rgb, select(0.34, 0.0, in.wavelength < 0.0));
  let neutral = vec3f(max(max(spectral.r, spectral.g), spectral.b) + caustic.farBrightness * distance);
  let tint = clamp(mix(spectral, neutral, farMix) * (0.62 + bounded * 0.68), vec3f(0.0), vec3f(1.45));
  let coverage = clamp(bounded * caustic.coverage, 0.0, 0.86);
  // The wall has already been shaded. Emit premultiplied radiance with zero
  // alpha into an additive draw so no wavelength can darken the plaster below.
  return vec4f(tint * coverage, 0.0);
}
