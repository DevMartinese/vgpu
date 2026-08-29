import { srgbToLinear3 } from "@vgpu/wgsl-std/color";
import { LightWall, wallPoint } from "./wall-common.wgsl";

const GLOBAL_LIGHT_MASK_ASPECT = 1.5;

@group(0) @binding(0) var<uniform> params: LightWall;
@group(0) @binding(1) var wallLighting: texture_2d<f32>;
@group(0) @binding(2) var materialSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldPosition: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  let corners = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0),
    vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(0.0, 0.0),
  );
  let uv = corners[index];
  let worldPosition = wallPoint(params, uv);
  var out: VertexOut;
  out.position = params.viewProjection * vec4f(worldPosition, 0.0, 1.0);
  out.uv = uv;
  out.worldPosition = worldPosition;
  return out;
}

fn globalLightUv(screenUv: vec2f) -> vec2f {
  let wallAspect = params.wallHalfExtent.x / max(params.wallHalfExtent.y, 0.001);
  var uv = screenUv;
  if (wallAspect > GLOBAL_LIGHT_MASK_ASPECT) {
    uv.y = screenUv.y * GLOBAL_LIGHT_MASK_ASPECT / wallAspect;
  } else {
    uv.x = (screenUv.x - 0.5) * wallAspect / GLOBAL_LIGHT_MASK_ASPECT + 0.5;
  }
  return clamp(uv, vec2f(0.001), vec2f(0.999));
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let globalLight = textureSample(
    wallLighting,
    materialSampler,
    globalLightUv(in.uv),
  ).r;
  let shapedLight = pow(
    clamp(globalLight, 0.0, 1.0),
    max(params.globalLightTransfer, 0.001),
  );
  let groundingOffset = vec2f(
    in.worldPosition.x - params.prismCenter.x,
    params.prismCenter.y - in.worldPosition.y,
  );
  let groundingUv = clamp(
    groundingOffset / params.groundingScale + vec2f(0.5),
    vec2f(0.001),
    vec2f(0.999),
  );
  let grounding = textureSample(wallLighting, materialSampler, groundingUv);
  let ao = mix(1.0, grounding.b, params.prismAoStrength);
  let exposure = mix(
    params.shadowFloor,
    params.highlightExposure,
    shapedLight,
  );
  let albedo = srgbToLinear3(params.wallColor) * 0.8;
  let illumination = vec3f(
    shapedLight * params.ambientLightStrength * 0.8,
  );
  return vec4f(max((albedo * exposure + illumination) * ao, vec3f(0.0)), 1.0);
}
