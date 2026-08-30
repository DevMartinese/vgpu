// Improved Perlin noise (Perlin 2002: quintic fade + cube-edge gradient set) in 2D/3D, plus the
// amplitude-normalized FBM that wraps each one.
//
// Numeric contract -- the published field *is* the API here, so treat every constant below as
// frozen (locked by tests/perlin.test.ts):
//   * range is a guaranteed open (-1, 1), never clipped. The trilinear/quintic blend is a convex
//     combination of the corner dot products, so |value| <= max_i |g_i . d_i|; the raw suprema are
//     1/sqrt(2) = 0.7071067812 (2D, attained at f = (0.5, 0.5)) and 1.0363538112 (3D), and the
//     normalizers below are strictly *below* 1/sup, so the bound is a proof rather than an
//     observation. Do not "fix" them toward the folkloric 2.2x of webgl-noise's cnoise: that
//     value provably exceeds 1 and forces every consumer to clamp.
//   * typical amplitude is much smaller than the bound (sigma ~= 0.305 in 2D, 0.260 in 3D):
//     consumers should `remap`, not `saturate`.
//   * exactly 0 at every integer lattice point (all corner offsets are zero vectors there, and
//     fade(0) = 0), which is the highest-value regression signal for a fade or corner-offset bug.
//
// Determinism contract, inherited from ../internal/gradient.wgsl: no lookup tables, no
// sin/cos/sqrt/inverseSqrt/pow, integer pcg hashing only -- so *which* gradient a cell gets is
// bit-identical on every backend and reproducible by the f32-exact TS reference in
// tests/perlin.test.ts.
//
// Reference (algorithm only, no code copied): Ken Perlin, "Improving Noise", SIGGRAPH 2002.
import { gradDot2, gradDot3, gradIndex2, gradIndex3, noiseFade2, noiseFade3 } from "../internal/gradient.wgsl";

// 1 / 0.7071067812 = 1.41421356..., truncated *downward* so the range stays strictly inside
// (-1, 1): max |perlin2d| = 0.99996.
const perlinNormalize2: f32 = 1.4142;
// 1 / 1.0363538112 = 0.96491..., with ~1% margin against residual error in the numeric sup search:
// max |perlin3d| = 0.99956.
const perlinNormalize3: f32 = 0.9645;

export fn perlin2d(position: vec2f) -> f32 {
  let base = floor(position);
  // vec2i(floor(p)) -- never vec2i(p): truncation toward zero would collapse the cells on both
  // sides of the origin into one, which is a visible seam for negative coordinates.
  let cell = vec2i(base);
  let f = position - base;
  let u = noiseFade2(f);
  let d00 = gradDot2(gradIndex2(cell), f);
  let d10 = gradDot2(gradIndex2(cell + vec2i(1, 0)), f - vec2f(1.0, 0.0));
  let d01 = gradDot2(gradIndex2(cell + vec2i(0, 1)), f - vec2f(0.0, 1.0));
  let d11 = gradDot2(gradIndex2(cell + vec2i(1, 1)), f - vec2f(1.0, 1.0));
  return perlinNormalize2 * mix(mix(d00, d10, u.x), mix(d01, d11, u.x), u.y);
}

export fn perlin3d(position: vec3f) -> f32 {
  let base = floor(position);
  let cell = vec3i(base);
  let f = position - base;
  let u = noiseFade3(f);
  let d000 = gradDot3(gradIndex3(cell), f);
  let d100 = gradDot3(gradIndex3(cell + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
  let d010 = gradDot3(gradIndex3(cell + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0));
  let d110 = gradDot3(gradIndex3(cell + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
  let d001 = gradDot3(gradIndex3(cell + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0));
  let d101 = gradDot3(gradIndex3(cell + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
  let d011 = gradDot3(gradIndex3(cell + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0));
  let d111 = gradDot3(gradIndex3(cell + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
  let x00 = mix(d000, d100, u.x);
  let x10 = mix(d010, d110, u.x);
  let x01 = mix(d001, d101, u.x);
  let x11 = mix(d011, d111, u.x);
  return perlinNormalize3 * mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// Fractal Brownian motion, amplitude-normalized: `sum / weight` with `weight` the sum of the
// amplitudes. That division is what keeps the (-1, 1) guarantee alive across octaves, because
// |sum| <= weight by construction.
//
// Both clamps are silent and deliberate:
//   * `octaves` in [1, 16] bounds the loop -- a dynamic count coming from a uniform could
//     otherwise hang the GPU;
//   * `gain` in [0, 1] keeps `weight` equal to the sum of |amplitude|, which the range proof needs
//     (a negative gain would cancel terms in `weight` while still adding magnitude to `sum`).
// `weight >= 1` always (the first amplitude is 1), so the division is never by zero.
//
// Free invariant, asserted by the tests: fbmPerlin2d(p, 1, lacunarity, gain) == perlin2d(p) exactly.
export fn fbmPerlin2d(position: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  let count = clamp(octaves, 1, 16);
  let decay = clamp(gain, 0.0, 1.0);
  var sum = 0.0;
  var amplitude = 1.0;
  var weight = 0.0;
  var sample = position;
  for (var i = 0; i < count; i = i + 1) {
    sum = sum + amplitude * perlin2d(sample);
    weight = weight + amplitude;
    sample = sample * lacunarity;
    amplitude = amplitude * decay;
  }
  return sum / weight;
}

// Cost model: one perlin3d is 8 pcg3d hashes, so a 6-octave call is 48 -- prefer fbmPerlin2d when
// the third axis only carries animation.
export fn fbmPerlin3d(position: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  let count = clamp(octaves, 1, 16);
  let decay = clamp(gain, 0.0, 1.0);
  var sum = 0.0;
  var amplitude = 1.0;
  var weight = 0.0;
  var sample = position;
  for (var i = 0; i < count; i = i + 1) {
    sum = sum + amplitude * perlin3d(sample);
    weight = weight + amplitude;
    sample = sample * lacunarity;
    amplitude = amplitude * decay;
  }
  return sum / weight;
}
