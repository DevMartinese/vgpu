// Recombines the two detailed scales reserved for visible bloom. Increasing
// radius transfers weight toward the broadest of those scales without
// enlarging discrete taps.

struct CompositeParams {
  radius: f32,
  factors: vec4f,
}

@group(0) @binding(0) var level0Texture: texture_2d<f32>;
@group(0) @binding(1) var level1Texture: texture_2d<f32>;
@group(0) @binding(2) var levelSampler: sampler;
@group(0) @binding(3) var<uniform> params: CompositeParams;

fn factor(index: u32) -> f32 {
  let nearToFar = array<f32, 4>(
    params.factors.x,
    params.factors.y,
    params.factors.z,
    params.factors.w,
  );
  return mix(
    nearToFar[index],
    nearToFar[1u - index],
    clamp(params.radius, 0.0, 1.0),
  );
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let color = (
    textureSampleLevel(level0Texture, levelSampler, uv, 0.0).rgb * factor(0u)
    + textureSampleLevel(level1Texture, levelSampler, uv, 0.0).rgb * factor(1u)
  ) / 1.8;
  return vec4f(max(color, vec3f(0.0)), 1.0);
}
