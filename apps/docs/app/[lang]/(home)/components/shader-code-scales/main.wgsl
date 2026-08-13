import { palette } from "./color.wgsl";

struct Uniforms {
  resolution: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let shortest = min(uniforms.resolution.x, uniforms.resolution.y);
  let aspect = uniforms.resolution / shortest;
  let p = (uv - 0.5) * aspect;
  let radius = length(p);
  let angle = atan2(p.y, p.x) / 6.28318 + 0.5;
  let ring = exp(-95.0 * pow(abs(radius - 0.31), 2.0));
  let halo = exp(-18.0 * pow(abs(radius - 0.31), 2.0));
  let bands = 0.82 + 0.18 * sin(angle * 25.13272 + radius * 42.0);
  let color = palette(angle + radius * 0.65);
  return vec4f(color * (ring * bands * 2.0 + halo * 0.22), 1.0);
}
