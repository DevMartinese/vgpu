import { srgbToLinear3 } from "@vgpu/wgsl-std/color";
import { evaluateGlassGrounding } from "./glass-grounding.wgsl";

const GLOBAL_LIGHT_MASK_ASPECT = 1.5;
// The art-directed PNG is stored in an unorm KTX channel. Decode its visual
// (sRGB-like) luminance before using it as incident light in the linear HDR
// composition. This restores the authored separation between soft shadows.
const GLOBAL_LIGHT_TRANSFER = 2.2;
const GLOBAL_LIGHT_DARK_EXPOSURE = 0.52;
const GLOBAL_LIGHT_BRIGHT_EXPOSURE = 1.08;

export struct LightWall {
  viewProjection: mat4x4f,
  wallHalfExtent: vec2f,
  wallColor: vec3f,
  prismCenter: vec2f,
  lightDirection: vec3f,
  materialWorldScale: f32,
  normalStrength: f32,
  microNormalFrequency: f32,
  microNormalStrength: f32,
  ambient: f32,
  ambientLightStrength: f32,
  prismShadowStrength: f32,
  prismAoStrength: f32,
  groundingScale: f32,
}

export struct WallSample {
  albedo: vec3f,
  largeNormal: vec3f,
  microNormal: vec3f,
  normal: vec3f,
  roughness: f32,
  globalLight: f32,
  prismShadow: f32,
  prismAo: f32,
  composed: vec3f,
}

export fn wallPoint(params: LightWall, uv: vec2f) -> vec2f {
  return (uv - vec2f(0.5)) * vec2f(2.0, -2.0) * params.wallHalfExtent;
}

fn wallMaterialUv(worldPosition: vec2f, worldScale: f32) -> vec2f {
  // The texture repeats in world units, so changing the canvas aspect ratio
  // reveals more wall instead of stretching the plaster normal map.
  return worldPosition / max(worldScale, 0.001);
}

fn normalFromXy(normalXy: vec2f) -> vec3f {
  let limitedXy = normalXy / max(length(normalXy), 1.0);
  return normalize(vec3f(
    limitedXy,
    sqrt(max(1.0 - dot(limitedXy, limitedXy), 0.0001)),
  ));
}

export fn evaluateWall(
  worldPosition: vec2f,
  screenUv: vec2f,
  params: LightWall,
  wallMaterial: texture_2d<f32>,
  wallLighting: texture_2d<f32>,
  materialSampler: sampler,
) -> WallSample {
  let materialUv = wallMaterialUv(worldPosition, params.materialWorldScale);
  let material = textureSample(wallMaterial, materialSampler, materialUv);
  // A decorrelated, higher-frequency read supplies subtle plaster grain without
  // baking it into the broad wall undulation. Both layers remain world-locked.
  let microUv = wallMaterialUv(
    worldPosition,
    params.materialWorldScale / max(params.microNormalFrequency, 1.0),
  ) + vec2f(0.371, 0.613);
  // A modest negative bias preserves plaster-scale relief after the repeated
  // micro read selects its mip; linear filtering still suppresses shimmer.
  let microMaterial = textureSampleBias(
    wallMaterial,
    materialSampler,
    microUv,
    -2.0,
  );
  let largeNormalXy = (material.gb * 2.0 - 1.0) * params.normalStrength;
  let microNormalXy = (microMaterial.gb * 2.0 - 1.0) * params.microNormalStrength;
  let largeNormal = normalFromXy(largeNormalXy);
  let microNormal = normalFromXy(microNormalXy);
  let normal = normalFromXy(largeNormalXy + microNormalXy);
  let groundingOffset = vec2f(
    worldPosition.x - params.prismCenter.x,
    params.prismCenter.y - worldPosition.y,
  );
  let groundingUv = clamp(
    groundingOffset / params.groundingScale + vec2f(0.5),
    vec2f(0.001),
    vec2f(0.999),
  );
  // Full-bleed cover fit: wide canvases crop only the bottom of the authored
  // mask, keeping its top edge anchored; narrow canvases crop both sides.
  let wallAspect = params.wallHalfExtent.x / max(params.wallHalfExtent.y, 0.001);
  var lightingUv = screenUv;
  if (wallAspect > GLOBAL_LIGHT_MASK_ASPECT) {
    lightingUv.y = screenUv.y * GLOBAL_LIGHT_MASK_ASPECT / wallAspect;
  } else {
    lightingUv.x =
      (screenUv.x - 0.5) * wallAspect / GLOBAL_LIGHT_MASK_ASPECT + 0.5;
  }
  lightingUv = clamp(lightingUv, vec2f(0.001), vec2f(0.999));
  let globalLight = textureSample(wallLighting, materialSampler, lightingUv).r;
  let globalLightLinear = pow(clamp(globalLight, 0.0, 1.0), GLOBAL_LIGHT_TRANSFER);
  let grounding = textureSample(wallLighting, materialSampler, groundingUv);
  let glassGrounding = evaluateGlassGrounding(grounding.g, grounding.b);
  let prismShadow = mix(1.0, glassGrounding.x, params.prismShadowStrength);
  let prismAo = mix(1.0, glassGrounding.y, params.prismAoStrength);
  let lightFacing = max(dot(normal, normalize(params.lightDirection)), 0.0);
  let diffuse = mix(
    params.ambient,
    1.0,
    lightFacing,
  );
  let halfDirection = normalize(normalize(params.lightDirection) + vec3f(0.0, 0.0, 1.0));
  let specularPower = mix(48.0, 4.0, material.a);
  let specular = pow(max(dot(normal, halfDirection), 0.0), specularPower)
    * mix(0.12, 0.025, material.a);
  let albedo = srgbToLinear3(params.wallColor) * material.r;
  let direct = albedo * diffuse + vec3f(specular);
  // The mask controls both the local wall exposure and the neutral incident
  // radiance. Merely adding it over a uniformly bright wall lifts its shadows,
  // then ACES compresses nearly all of the authored detail into white.
  let globalBaseExposure = mix(
    GLOBAL_LIGHT_DARK_EXPOSURE,
    GLOBAL_LIGHT_BRIGHT_EXPOSURE,
    globalLightLinear,
  );
  let globalDiffuse = mix(0.25, 1.0, lightFacing);
  let globalSurfaceResponse = material.r * globalDiffuse;
  let globalIllumination = vec3f(
    globalLightLinear * params.ambientLightStrength * globalSurfaceResponse
  );
  let composed = (
    direct * globalBaseExposure + globalIllumination
  ) * prismShadow * prismAo;
  return WallSample(
    albedo,
    largeNormal,
    microNormal,
    normal,
    material.a,
    globalLight,
    glassGrounding.x,
    glassGrounding.y,
    composed,
  );
}
