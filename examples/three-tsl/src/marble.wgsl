import { fbm3 } from "./noise.wgsl";

// Marble stripes along x, domain-warped by fbm. Returns 0..1.
export fn marble(position: vec3f, warp: f32) -> f32 {
  let swirl = fbm3(position * 2.0, 5u);
  let bands = sin(position.x * 4.0 + swirl * warp);
  let veins = 1.0 - abs(bands);
  return pow(veins, 3.0);
}
