import { linearToSrgb3 } from "@vgpu/wgsl-std/color";
import { applyPrismToneMapping } from "../shared/tone-mapping.wgsl";

@group(0) @binding(0) var sceneTexture: texture_2d<f32>;

struct PresentParams {
  exposure: f32,
  toneMapping: u32,
}

@group(0) @binding(1) var<uniform> params: PresentParams;

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let scene = textureLoad(sceneTexture, vec2i(position.xy), 0).rgb
    * max(params.exposure, 0.0);
  return vec4f(
    linearToSrgb3(applyPrismToneMapping(scene, params.toneMapping)),
    1.0,
  );
}
