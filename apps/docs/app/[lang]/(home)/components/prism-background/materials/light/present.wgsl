import { linearToSrgb3, tonemapAces } from "@vgpu/wgsl-std/color";

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let scene = textureLoad(sceneTexture, vec2i(position.xy), 0).rgb;
  return vec4f(linearToSrgb3(tonemapAces(max(scene, vec3f(0.0)))), 1.0);
}

