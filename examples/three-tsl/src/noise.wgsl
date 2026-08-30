import { hash3 } from "@vgpu/wgsl-std/hash";

// Trilinear value noise over a lattice hashed with @vgpu/wgsl-std's hash3.
export fn valueNoise3(position: vec3f) -> f32 {
  let cell = floor(position);
  let local = fract(position);
  let fade = local * local * (3.0 - 2.0 * local);
  let c000 = hash3(cell + vec3f(0.0, 0.0, 0.0)).x;
  let c100 = hash3(cell + vec3f(1.0, 0.0, 0.0)).x;
  let c010 = hash3(cell + vec3f(0.0, 1.0, 0.0)).x;
  let c110 = hash3(cell + vec3f(1.0, 1.0, 0.0)).x;
  let c001 = hash3(cell + vec3f(0.0, 0.0, 1.0)).x;
  let c101 = hash3(cell + vec3f(1.0, 0.0, 1.0)).x;
  let c011 = hash3(cell + vec3f(0.0, 1.0, 1.0)).x;
  let c111 = hash3(cell + vec3f(1.0, 1.0, 1.0)).x;
  let bottom = mix(mix(c000, c100, fade.x), mix(c010, c110, fade.x), fade.y);
  let top = mix(mix(c001, c101, fade.x), mix(c011, c111, fade.x), fade.y);
  return mix(bottom, top, fade.z);
}

export fn fbm3(position: vec3f, octaves: u32) -> f32 {
  var total = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var normalization = 0.0;
  for (var i = 0u; i < octaves; i++) {
    total += valueNoise3(position * frequency) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return total / max(normalization, 1e-5);
}

// Ridged multifractal: sharp creases where the noise crosses its midline.
// Returns 0..1 with thin bright ridges near 1.
export fn ridged3(position: vec3f, octaves: u32) -> f32 {
  var total = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var normalization = 0.0;
  for (var i = 0u; i < octaves; i++) {
    let ridge = 1.0 - abs(valueNoise3(position * frequency) * 2.0 - 1.0);
    total += ridge * ridge * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return total / max(normalization, 1e-5);
}
