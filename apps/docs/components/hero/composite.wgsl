struct Composite {
  exposure: f32,
  /** Non-zero while a G-buffer debug view is active: pass the raw values through. */
  debug: f32,
}

@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> composite: Composite;

const SATURATION: f32 = 0.0;

fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3f(b))) / (x * (c * x + vec3f(d)) + vec3f(e)), vec3f(0.0), vec3f(1.0));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var color = textureSampleLevel(scene, samp, uv, 0.0).rgb;

  // Debug views must not be tone mapped or desaturated: the channels carry data.
  if (composite.debug > 0.5) {
    return vec4f(color, 1.0);
  }

  color *= composite.exposure;
  color = aces(color);

  // Subtle cinematic vignette.
  let centered = uv - vec2f(0.5);
  let vignette = 1.0 - smoothstep(0.55, 1.15, length(centered) * 1.6);
  color *= mix(0.72, 1.0, vignette);

  color = pow(color, vec3f(1.0 / 2.2));

  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  color = mix(vec3f(luma), color, SATURATION);
  return vec4f(color, 1.0);
}
