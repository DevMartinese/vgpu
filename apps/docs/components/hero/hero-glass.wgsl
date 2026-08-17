import { presentCeramic } from "./hero-fractal-ceramic.wgsl";
import { sampleHeroEnvironment } from "./hero-glass-environment.wgsl";

override FRONT_GLASS: bool = false;

struct GlassParams {
  viewProjection: mat4x4f,
  model: mat4x4f,
  cameraPosition: vec3f,
  meshMin: vec3f,
  meshMax: vec3f,
  ior: f32,
  reflectionStrength: f32,
  backOpacity: f32,
  absorption: vec3f,
}
@group(0) @binding(0) var<uniform> params: GlassParams;
@group(0) @binding(1) var environmentTexture: texture_2d_array<f32>;
@group(0) @binding(2) var environmentSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) worldNormal: vec3f,
};

@vertex fn vs_main(
  @location(0) packed_position: vec4f,
  @location(1) packed_normal: vec4f,
) -> VertexOut {
  let localPosition = mix(params.meshMin, params.meshMax, packed_position.xyz);
  let world = params.model * vec4f(localPosition, 1.0);
  var out: VertexOut;
  out.position = params.viewProjection * world;
  out.worldPosition = world.xyz;
  out.worldNormal = normalize((params.model * vec4f(packed_normal.xyz, 0.0)).xyz);
  return out;
}

fn studio(direction: vec3f) -> vec3f {
  return sampleHeroEnvironment(
    environmentTexture,
    environmentSampler,
    normalize(direction),
  ) * params.reflectionStrength;
}

fn dielectricFresnel(ior: f32, facing: f32) -> f32 {
  let ratio = (ior - 1.0) / (ior + 1.0);
  let f0 = ratio * ratio;
  return f0 + (1.0 - f0) * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
}

fn premultiplied(color: vec3f, alpha: f32) -> vec4f {
  return vec4f(color * alpha, alpha);
}

@fragment fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let rawNormal = normalize(in.worldNormal);
  let view = normalize(params.cameraPosition - in.worldPosition);
  let normal = select(-rawNormal, rawNormal, dot(rawNormal, view) >= 0.0);
  let incident = -view;
  let facing = clamp(dot(view, normal), 0.0, 1.0);
  let fresnel = dielectricFresnel(params.ior, facing);
  let reflected = studio(reflect(incident, normal));

  if (!FRONT_GLASS) {
    let alpha = clamp(
      params.backOpacity * (0.22 + 0.78 * pow(1.0 - facing, 1.5)),
      0.0,
      0.85,
    );
    return premultiplied(presentCeramic(reflected).rgb, alpha);
  }

  // The ceramic mesh is rendered behind this shell. Until screen-space
  // refraction is added, the front face contributes only its tinted Fresnel lobe.
  let tint = exp(-params.absorption * 0.08);
  let alpha = clamp(fresnel + 0.018, 0.0, 0.42);
  return premultiplied(presentCeramic(reflected * tint).rgb, alpha);
}
