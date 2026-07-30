/**
 * f32-exact TypeScript reference for the shared noise hash + gradient core
 * (`packages/wgsl-std/src/noise/internal/gradient.wgsl`).
 *
 * Why this file exists: `noise.test.ts` only ever compares a TS reference against literals and
 * separately checks that the WGSL *resolves*. Nothing binds the WGSL to the reference. The noise
 * modules close that gap by running the real WGSL on the GPU (Docker) and comparing against the
 * values produced here, so this reference must be bit-accurate to f32, not merely close:
 *
 *   * the u32 hashes (`pcg2d`/`pcg3d`) are exact by construction -- `Math.imul` + `>>> 0`
 *     reproduce WGSL's wrapping u32 mul/add/xor/shift bit for bit;
 *   * every float step is wrapped in `Math.fround` and evaluated in the *same order* as the WGSL
 *     expression, so each intermediate is the f32 value a GPU would hold. Reassociating (or
 *     dropping a `fround`) silently turns a golden into a f64 golden and the GPU comparison starts
 *     failing for the wrong reason.
 *
 * Note WGSL is allowed to contract `a * b + c` into an FMA, so the *final* GPU value can still
 * differ from this reference by a few ulp; that is what the noise tests' 1e-5 tolerance covers.
 * Gradient selection (integer) is exact everywhere, on every backend.
 */

/** `noiseInvSqrt2` as f32, matching `const noiseInvSqrt2: f32 = 0.7071067811865476;`. */
export const noiseInvSqrt2Ref = Math.fround(0.7071067811865476);

/** Bit-exact `pcg2d` (`src/hash/index.wgsl`). Inputs are treated as u32 bit patterns. */
export function pcg2dRef(value: readonly [number, number]): [number, number] {
  let x = (Math.imul(value[0], 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(value[1], 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0;
  y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0;
  y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  return [x, y];
}

/** Bit-exact `pcg3d` (`src/hash/index.wgsl`). Inputs are treated as u32 bit patterns. */
export function pcg3dRef(value: readonly [number, number, number]): [number, number, number] {
  let x = (Math.imul(value[0], 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(value[1], 1664525) + 1013904223) >>> 0;
  let z = (Math.imul(value[2], 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  return [x, y, z];
}

/** Bit-exact `unitFloat`: top 24 bits of the hash mapped to [0, 1). */
export function unitFloatRef(hash: number): number {
  return (hash >>> 8) * (1 / 16777216);
}

/** `bitcast<vec2u>(cell)` / `bitcast<vec3u>(cell)`: two's-complement bit pattern of an i32. */
function bitsOf(cell: number): number {
  return cell >>> 0;
}

/** Bit-exact `gradIndex2`: `pcg2d(bitcast<vec2u>(cell)).x & 7u`. */
export function gradIndex2Ref(cell: readonly [number, number]): number {
  return pcg2dRef([bitsOf(cell[0]), bitsOf(cell[1])])[0] & 7;
}

/** Bit-exact `gradIndex3`: `pcg3d(bitcast<vec3u>(cell)).x % 12u` (unsigned modulo). */
export function gradIndex3Ref(cell: readonly [number, number, number]): number {
  return pcg3dRef([bitsOf(cell[0]), bitsOf(cell[1]), bitsOf(cell[2])])[0] % 12;
}

/**
 * Bit-exact `gradDot2`. index 0..3 -> (1,0) (-1,0) (0,1) (0,-1); 4..7 -> (+-1,+-1)/sqrt(2).
 * The diagonal branch is the only one that rounds: `fround(fround(sx + sy) * noiseInvSqrt2)`,
 * matching WGSL's `noiseInvSqrt2 * (sx + sy)`.
 */
export function gradDot2Ref(index: number, dx: number, dy: number): number {
  const x = Math.fround(dx);
  const y = Math.fround(dy);
  if (index >= 4) {
    const sx = (index & 1) !== 0 ? Math.fround(-x) : x;
    const sy = (index & 2) !== 0 ? Math.fround(-y) : y;
    return Math.fround(noiseInvSqrt2Ref * Math.fround(sx + sy));
  }
  const axis = (index & 2) !== 0 ? y : x;
  return (index & 1) !== 0 ? Math.fround(-axis) : axis;
}

/**
 * Bit-exact `gradDot3`. `index / 4u` picks the component pair (0 -> (x,y), 1 -> (x,z), 2 -> (y,z))
 * and bits 0/1 are the signs; the whole dot product is a single rounded add.
 */
export function gradDot3Ref(index: number, dx: number, dy: number, dz: number): number {
  const x = Math.fround(dx);
  const y = Math.fround(dy);
  const z = Math.fround(dz);
  const pair = Math.floor(index / 4);
  const a = pair === 2 ? y : x;
  const b = pair === 0 ? y : z;
  const sa = (index & 1) !== 0 ? Math.fround(-a) : a;
  const sb = (index & 2) !== 0 ? Math.fround(-b) : b;
  return Math.fround(sa + sb);
}

/**
 * Bit-exact single-component quintic fade, evaluated in WGSL's own order:
 * `t * t * t * (t * (t * 6.0 - 15.0) + 10.0)` == `((t*t)*t) * ((t*((t*6)-15)) + 10)`.
 */
export function fadeRef(t: number): number {
  const value = Math.fround(t);
  const squared = Math.fround(value * value);
  const cubed = Math.fround(squared * value);
  const scaled = Math.fround(value * 6);
  const shifted = Math.fround(scaled - 15);
  const inner = Math.fround(value * shifted);
  const polynomial = Math.fround(inner + 10);
  return Math.fround(cubed * polynomial);
}

/** Bit-exact `noiseFade2` (componentwise `fadeRef`). */
export function fade2Ref(tx: number, ty: number): [number, number] {
  return [fadeRef(tx), fadeRef(ty)];
}

/** Bit-exact `noiseFade3` (componentwise `fadeRef`). */
export function fade3Ref(tx: number, ty: number, tz: number): [number, number, number] {
  return [fadeRef(tx), fadeRef(ty), fadeRef(tz)];
}
