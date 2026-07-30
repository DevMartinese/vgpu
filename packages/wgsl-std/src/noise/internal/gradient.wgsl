// Shared, table-free gradient core for the gradient-noise families (perlin/, simplex/).
//
// Private module: it is intentionally absent from this package's `package.json` exports, so the
// only way in is a relative import from a sibling noise module
// (`import { gradDot3 } from "../internal/gradient.wgsl";`). The declarations still carry `export`
// because the resolver keys its import graph off that literal token
// (packages/wgsl/src/runtime/parser.ts) -- `export` here means "importable by a relative sibling",
// not "public API".
//
// Determinism contract (locked by tests/noise-gradient.test.ts):
//   * no `array<...>` anywhere: permutation/gradient tables cost shader text in every consumer and
//     backends expand or spill them anyway, buying nothing over a few `select`s.
//   * no `sin`/`cos`/`sqrt`/`inverseSqrt`/`pow` anywhere: their accuracy is implementation-defined
//     (WGSL allows several ulp), so an angle-based gradient would drift per driver and make golden
//     tests flaky. Everything below is `+ - * select` plus the exactly specified u32 hash ops, so
//     *which* gradient a cell gets is bit-identical on every backend.
//
// References (algorithms, no code copied): Perlin 2002 "Improving Noise" (quintic fade, 12
// cube-edge gradients), Perlin 2001 / Gustavson "Simplex noise demystified".
import { pcg2d, pcg3d } from "@vgpu/wgsl-std/hash";

// 1 / sqrt(2), spelled as a literal because `sqrt` is banned above.
export const noiseInvSqrt2: f32 = 0.7071067811865476;

// Gradient selector: pcg2d/pcg3d over the bit pattern of the integer cell (same idiom as
// voronoi2d/voronoi3d), giving a 2^32-cell period instead of the folklore period-289 float hash.
export fn gradIndex2(cell: vec2i) -> u32 { return pcg2d(bitcast<vec2u>(cell)).x & 7u; }

// 12 gradients out of 32 bits: bias is 4/2^32 ~= 1e-9.
export fn gradIndex3(cell: vec3i) -> u32 { return pcg3d(bitcast<vec3u>(cell)).x % 12u; }

// 8 unit gradients. index 0..3 -> (1,0) (-1,0) (0,1) (0,-1);  4..7 -> (+-1,+-1)/sqrt(2).
// Unit length keeps the 2D field's amplitude bound closed-form (raw sup |perlin2d| = 1/sqrt(2)).
export fn gradDot2(index: u32, d: vec2f) -> f32 {
  let axis = select(d.x, d.y, (index & 2u) != 0u);
  let axisDot = select(axis, -axis, (index & 1u) != 0u);
  let sx = select(d.x, -d.x, (index & 1u) != 0u);
  let sy = select(d.y, -d.y, (index & 2u) != 0u);
  return select(axisDot, noiseInvSqrt2 * (sx + sy), index >= 4u);
}

// Perlin's 12 cube-edge gradients (+-1,+-1,0) (+-1,0,+-1) (0,+-1,+-1), length sqrt(2): the dot
// product costs one add plus two negations, no multiplies.
// index/4 selects the component pair: 0 -> (x,y), 1 -> (x,z), 2 -> (y,z); bits 0/1 are the signs.
export fn gradDot3(index: u32, d: vec3f) -> f32 {
  let pair = index / 4u;
  let a = select(d.x, d.y, pair == 2u);
  let b = select(select(d.y, d.z, pair == 1u), d.z, pair == 2u);
  let sa = select(a, -a, (index & 1u) != 0u);
  let sb = select(b, -b, (index & 2u) != 0u);
  return sa + sb;
}

// Quintic fade 6t^5 - 15t^4 + 10t^3 (Perlin 2002): zero first *and* second derivative at the cell
// boundaries, so lattice seams stay invisible in derivatives (normals) too.
export fn noiseFade2(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
export fn noiseFade3(t: vec3f) -> vec3f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
