// Simplex noise on the skewed simplicial lattice (Perlin 2001; Gustavson, "Simplex noise
// demystified"), re-derived on this package's integer pcg hashes -- no code copied, no permutation
// table, no period-289 float hash, and no `sqrt`/trig anywhere in the core (see
// ../internal/gradient.wgsl for the determinism contract this module inherits).
//
// Range is a *proof*, not an observation: the kernel sum is bounded by its measured supremum
// (0.0100802047 for 2D, 0.0130071572 for 3D) and the normalizers below sit just under 1/sup, so
// abs(simplex2d(p)) <= 0.98786 and abs(simplex3d(p)) <= 0.98854 for every finite input. Do not
// replace them with the folkloric webgl-noise scale factors, which exceed 1 and force consumers to
// clamp. sigma is ~0.533 (2D) / ~0.388 (3D): ~1.7x Perlin's, with ~2.5x the slope, so
// `simplex3d(p)` is a higher-frequency field than `perlin3d(p)` -- scale `p` by ~0.4-0.5 when
// migrating (see index.docs.md).
import { gradDot2, gradDot3, gradIndex2, gradIndex3 } from "../internal/gradient.wgsl";

// Skew/unskew constants, spelled as precomputed decimal literals because `sqrt` is banned in the
// core: its accuracy is implementation-defined, which would make the goldens driver-dependent.
const simplexF2: f32 = 0.36602540378443865;      // (sqrt(3) - 1) / 2
const simplexG2: f32 = 0.21132486540518713;      // (3 - sqrt(3)) / 6
const simplexG2Twice: f32 = 0.42264973081037427; // 2 * simplexG2
const simplexF3: f32 = 0.3333333333333333;       // 1 / 3
const simplexG3: f32 = 0.16666666666666666;      // 1 / 6
const simplexG3Twice: f32 = 0.3333333333333333;  // 2 * simplexG3
const simplexG3Thrice: f32 = 0.5;                // 3 * simplexG3

// Kernel radius^2 is 0.5, NOT the widespread 0.6 (Gustavson/webgl-noise canonical value):
// 0.6 measurably produces C0 cracks (max |dv| ~4.6e-5 to 9.5e-5 vs ~2.9e-8 to 4.8e-8 at 0.5,
// i.e. ~1000x worse) because its support radius (0.775) exceeds the 4-corner traversal's
// reach. See `simplexCrackDetector` in tests/simplex.test.ts -- do not "fix" this back to 0.6.
//
// Why 0.5 is exactly right rather than merely smaller: on the face where the corner ranking flips,
// the corner the traversal drops sits at squared distance >= 0.5 from the sample, with equality at
// the tightest point (2D: d = (simplexG2 - 0.5, 0.5), |d|^2 = 0.5 exactly). At radius^2 = 0.5 that
// dropped corner therefore contributes exactly 0 with a vanishing first and second derivative
// (t^4), so the field stays C2 across every simplex face. At 0.6 the same corner still carries
// t = 0.1, and dropping it is a discontinuity.
fn simplexKernel2(cell: vec2i, d: vec2f) -> f32 {
  let t = 0.5 - dot(d, d);
  if (t <= 0.0) { return 0.0; }
  let t2 = t * t;
  return t2 * t2 * gradDot2(gradIndex2(cell), d);
}

fn simplexKernel3(cell: vec3i, d: vec3f) -> f32 {
  let t = 0.5 - dot(d, d);
  if (t <= 0.0) { return 0.0; }
  let t2 = t * t;
  return t2 * t2 * gradDot3(gradIndex3(cell), d);
}

// 2D simplex: 3 corners of a triangle in the sheared lattice. `vec2i(base)` (never
// `vec2i(position)`) keeps negative coordinates correct, and there is no float `mod` anywhere --
// WGSL's `%` truncates toward the dividend, unlike GLSL's `mod`, which is how ported noise code
// silently breaks for p < 0.
export fn simplex2d(position: vec2f) -> f32 {
  let skew = (position.x + position.y) * simplexF2;
  let base = floor(position + vec2f(skew));
  let cell = vec2i(base);
  let unskew = (base.x + base.y) * simplexG2;
  let d0 = position - (base - vec2f(unskew));
  // Which of the two triangles of the sheared cell we are in: the ranking of d0's components.
  let second = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), d0.x > d0.y);
  let d1 = d0 - second + vec2f(simplexG2);
  let d2 = d0 - vec2f(1.0) + vec2f(simplexG2Twice);
  var total = simplexKernel2(cell, d0);
  total = total + simplexKernel2(cell + vec2i(second), d1);
  total = total + simplexKernel2(cell + vec2i(1, 1), d2);
  // raw sup = 0.0100802047, so 98.0 < 1/sup: abs(value) <= 0.98786, never clipped.
  return 98.0 * total;
}

// 3D simplex: 4 corners of a tetrahedron, i.e. half the 8 corners perlin3d needs (4 pcg3d hashes
// against Perlin's 8).
export fn simplex3d(position: vec3f) -> f32 {
  let skew = (position.x + position.y + position.z) * simplexF3;
  let base = floor(position + vec3f(skew));
  let cell = vec3i(base);
  let unskew = (base.x + base.y + base.z) * simplexG3;
  let d0 = position - (base - vec3f(unskew));

  // Traversal order = ranking of d0's components (the classic error-prone step). The six branches
  // are the six orderings of (x, y, z): `o1` steps along the largest component and `o2` adds the
  // second largest, so the pair encodes *which two* of the four tetrahedron corners are visited in
  // the middle. Do not "simplify" this into arithmetic on comparisons -- every collapsed variant
  // swaps a corner for at least one ordering, which the goldens and the crack detector catch but a
  // statistical test would not.
  var o1 = vec3f(0.0);
  var o2 = vec3f(0.0);
  if (d0.x >= d0.y) {
    if (d0.y >= d0.z)      { o1 = vec3f(1.0, 0.0, 0.0); o2 = vec3f(1.0, 1.0, 0.0); } // x >= y >= z
    else if (d0.x >= d0.z) { o1 = vec3f(1.0, 0.0, 0.0); o2 = vec3f(1.0, 0.0, 1.0); } // x >= z > y
    else                   { o1 = vec3f(0.0, 0.0, 1.0); o2 = vec3f(1.0, 0.0, 1.0); } // z > x >= y
  } else {
    if (d0.y < d0.z)       { o1 = vec3f(0.0, 0.0, 1.0); o2 = vec3f(0.0, 1.0, 1.0); } // z > y > x
    else if (d0.x < d0.z)  { o1 = vec3f(0.0, 1.0, 0.0); o2 = vec3f(0.0, 1.0, 1.0); } // y >= z > x
    else                   { o1 = vec3f(0.0, 1.0, 0.0); o2 = vec3f(1.0, 1.0, 0.0); } // y > x >= z
  }

  let d1 = d0 - o1 + vec3f(simplexG3);
  let d2 = d0 - o2 + vec3f(simplexG3Twice);
  let d3 = d0 - vec3f(1.0) + vec3f(simplexG3Thrice);
  var total = simplexKernel3(cell, d0);
  total = total + simplexKernel3(cell + vec3i(o1), d1);
  total = total + simplexKernel3(cell + vec3i(o2), d2);
  total = total + simplexKernel3(cell + vec3i(1, 1, 1), d3);
  // raw sup = 0.0130071572, so 76.0 < 1/sup: abs(value) <= 0.98854, never clipped.
  return 76.0 * total;
}

// Amplitude-normalized FBM: dividing by the sum of the amplitudes is what makes the (-1, 1)
// guarantee survive octaves (abs(sum) <= weight by construction, and weight >= 1 so the division is
// always safe). `octaves` is clamped to [1, 16] because an unbounded dynamic loop count is a
// GPU-hang risk, and `gain` to [0, 1] because a negative gain would break weight = sum of |a| and
// with it the range proof. Both clamps are silent and documented. Free invariant:
// `fbmSimplex2d(p, 1, lacunarity, gain)` is exactly `simplex2d(p)`.
export fn fbmSimplex2d(position: vec2f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  let count = clamp(octaves, 1, 16);
  let decay = clamp(gain, 0.0, 1.0);
  var sum = 0.0;
  var amplitude = 1.0;
  var weight = 0.0;
  var sample = position;
  for (var i = 0; i < count; i = i + 1) {
    sum = sum + amplitude * simplex2d(sample);
    weight = weight + amplitude;
    sample = sample * lacunarity;
    amplitude = amplitude * decay;
  }
  return sum / weight;
}

export fn fbmSimplex3d(position: vec3f, octaves: i32, lacunarity: f32, gain: f32) -> f32 {
  let count = clamp(octaves, 1, 16);
  let decay = clamp(gain, 0.0, 1.0);
  var sum = 0.0;
  var amplitude = 1.0;
  var weight = 0.0;
  var sample = position;
  for (var i = 0; i < count; i = i + 1) {
    sum = sum + amplitude * simplex3d(sample);
    weight = weight + amplitude;
    sample = sample * lacunarity;
    amplitude = amplitude * decay;
  }
  return sum / weight;
}
