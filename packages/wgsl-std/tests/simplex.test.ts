import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { gradDot2Ref, gradDot3Ref, gradIndex2Ref, gradIndex3Ref } from "./support/hash-reference.ts";
import { runNoiseCompute } from "./support/gpu-compute.ts";

const dockerTest = process.env.VGPU_DOCKER_TEST === "1";
const simplexPath = resolve("packages/wgsl-std/src/noise/simplex/index.wgsl");
const simplexSubpath = "@vgpu/wgsl-std/noise/simplex";

/**
 * Documented max slope (Lipschitz bound) of the *normalized* fields, from the design's measured
 * table: simplex is ~2.5x steeper than Perlin at the same input scale. The crack detector's
 * threshold and the continuity test are both expressed in terms of these.
 */
const maxSlope2 = 6.95;
const maxSlope3 = 6.53;
/** Published sigma of the normalized fields (design table); asserted within +-10%. */
const sigma2 = 0.533;
const sigma3 = 0.388;

// ---------------------------------------------------------------------------------------------
// Layer 1 -- f32-exact TypeScript reference
// ---------------------------------------------------------------------------------------------

type Round = (value: number) => number;

interface SimplexRefOptions {
  /**
   * Kernel radius^2. 0.5 is what ships; the crack detector instantiates a second reference at the
   * canonical 0.6 purely to prove that value wrong -- see `kernel radius^2 = 0.5 has no C0 cracks`.
   */
  readonly radiusSquared: number;
  /** `Math.fround` (f32-exact). Kept a parameter so the crack scan cannot drift from the goldens. */
  readonly round: Round;
}

interface SimplexRef {
  readonly simplex2d: (x: number, y: number) => number;
  readonly simplex3d: (x: number, y: number, z: number) => number;
  readonly fbmSimplex2d: (x: number, y: number, octaves: number, lacunarity: number, gain: number) => number;
  readonly fbmSimplex3d: (x: number, y: number, z: number, octaves: number, lacunarity: number, gain: number) => number;
  /** Diagnostic only: identifies the simplex (cell + component ranking) a sample falls in. */
  readonly faceKey2d: (x: number, y: number) => string;
  readonly faceKey3d: (x: number, y: number, z: number) => string;
}

/**
 * Builds the reference from the *same* expression order as `src/noise/simplex/index.wgsl`.
 *
 * Every float step is wrapped in `round` and evaluated in WGSL's own left-to-right order, so with
 * `round = Math.fround` each intermediate is the f32 value a GPU holds: reassociating, or dropping a
 * `round`, silently turns the goldens into f64 goldens and the Docker comparison then fails for the
 * wrong reason. The kernel radius is a parameter for one reason only -- the crack detector must
 * evaluate the *identical* traversal at radius^2 = 0.6, and a hand-written second copy of this code
 * would be free to differ from the shipped one in other ways too.
 */
function createSimplexRef(options: SimplexRefOptions): SimplexRef {
  const { round } = options;
  const f2 = round(0.36602540378443865);
  const g2 = round(0.21132486540518713);
  const g2Twice = round(0.42264973081037427);
  const f3 = round(0.3333333333333333);
  const g3 = round(0.16666666666666666);
  const g3Twice = round(0.3333333333333333);
  const g3Thrice = round(0.5);
  const radius = round(options.radiusSquared);

  function kernel2(cellX: number, cellY: number, dx: number, dy: number): number {
    const t = round(radius - round(round(dx * dx) + round(dy * dy)));
    if (t <= 0) return 0;
    const t2 = round(t * t);
    return round(round(t2 * t2) * gradDot2Ref(gradIndex2Ref([cellX, cellY]), dx, dy));
  }

  function kernel3(cellX: number, cellY: number, cellZ: number, dx: number, dy: number, dz: number): number {
    const t = round(radius - round(round(round(dx * dx) + round(dy * dy)) + round(dz * dz)));
    if (t <= 0) return 0;
    const t2 = round(t * t);
    return round(round(t2 * t2) * gradDot3Ref(gradIndex3Ref([cellX, cellY, cellZ]), dx, dy, dz));
  }

  function simplex2d(px: number, py: number): number {
    const x = round(px);
    const y = round(py);
    const skew = round(round(x + y) * f2);
    const baseX = Math.floor(round(x + skew));
    const baseY = Math.floor(round(y + skew));
    const unskew = round(round(baseX + baseY) * g2);
    const d0x = round(x - round(baseX - unskew));
    const d0y = round(y - round(baseY - unskew));
    const secondX = d0x > d0y ? 1 : 0;
    const secondY = d0x > d0y ? 0 : 1;
    const d1x = round(round(d0x - secondX) + g2);
    const d1y = round(round(d0y - secondY) + g2);
    const d2x = round(round(d0x - 1) + g2Twice);
    const d2y = round(round(d0y - 1) + g2Twice);
    let total = kernel2(baseX, baseY, d0x, d0y);
    total = round(total + kernel2(baseX + secondX, baseY + secondY, d1x, d1y));
    total = round(total + kernel2(baseX + 1, baseY + 1, d2x, d2y));
    return round(98 * total);
  }

  function simplex3d(px: number, py: number, pz: number): number {
    const x = round(px);
    const y = round(py);
    const z = round(pz);
    const skew = round(round(round(x + y) + z) * f3);
    const baseX = Math.floor(round(x + skew));
    const baseY = Math.floor(round(y + skew));
    const baseZ = Math.floor(round(z + skew));
    const unskew = round(round(round(baseX + baseY) + baseZ) * g3);
    const d0x = round(x - round(baseX - unskew));
    const d0y = round(y - round(baseY - unskew));
    const d0z = round(z - round(baseZ - unskew));
    // The six orderings of (x, y, z): o1 steps along the largest component, o2 adds the second.
    let o1x = 0;
    let o1y = 0;
    let o1z = 0;
    let o2x = 0;
    let o2y = 0;
    let o2z = 0;
    if (d0x >= d0y) {
      if (d0y >= d0z) { o1x = 1; o2x = 1; o2y = 1; }
      else if (d0x >= d0z) { o1x = 1; o2x = 1; o2z = 1; }
      else { o1z = 1; o2x = 1; o2z = 1; }
    } else {
      if (d0y < d0z) { o1z = 1; o2y = 1; o2z = 1; }
      else if (d0x < d0z) { o1y = 1; o2y = 1; o2z = 1; }
      else { o1y = 1; o2x = 1; o2y = 1; }
    }
    const d1x = round(round(d0x - o1x) + g3);
    const d1y = round(round(d0y - o1y) + g3);
    const d1z = round(round(d0z - o1z) + g3);
    const d2x = round(round(d0x - o2x) + g3Twice);
    const d2y = round(round(d0y - o2y) + g3Twice);
    const d2z = round(round(d0z - o2z) + g3Twice);
    const d3x = round(round(d0x - 1) + g3Thrice);
    const d3y = round(round(d0y - 1) + g3Thrice);
    const d3z = round(round(d0z - 1) + g3Thrice);
    let total = kernel3(baseX, baseY, baseZ, d0x, d0y, d0z);
    total = round(total + kernel3(baseX + o1x, baseY + o1y, baseZ + o1z, d1x, d1y, d1z));
    total = round(total + kernel3(baseX + o2x, baseY + o2y, baseZ + o2z, d2x, d2y, d2z));
    total = round(total + kernel3(baseX + 1, baseY + 1, baseZ + 1, d3x, d3y, d3z));
    return round(76 * total);
  }

  function fbmSimplex2d(px: number, py: number, octaves: number, lacunarity: number, gain: number): number {
    const count = Math.min(Math.max(Math.trunc(octaves), 1), 16);
    const decay = round(Math.min(Math.max(gain, 0), 1));
    const step = round(lacunarity);
    let sum = 0;
    let amplitude = 1;
    let weight = 0;
    let sampleX = round(px);
    let sampleY = round(py);
    for (let i = 0; i < count; i += 1) {
      sum = round(sum + round(amplitude * simplex2d(sampleX, sampleY)));
      weight = round(weight + amplitude);
      sampleX = round(sampleX * step);
      sampleY = round(sampleY * step);
      amplitude = round(amplitude * decay);
    }
    return round(sum / weight);
  }

  function fbmSimplex3d(px: number, py: number, pz: number, octaves: number, lacunarity: number, gain: number): number {
    const count = Math.min(Math.max(Math.trunc(octaves), 1), 16);
    const decay = round(Math.min(Math.max(gain, 0), 1));
    const step = round(lacunarity);
    let sum = 0;
    let amplitude = 1;
    let weight = 0;
    let sampleX = round(px);
    let sampleY = round(py);
    let sampleZ = round(pz);
    for (let i = 0; i < count; i += 1) {
      sum = round(sum + round(amplitude * simplex3d(sampleX, sampleY, sampleZ)));
      weight = round(weight + amplitude);
      sampleX = round(sampleX * step);
      sampleY = round(sampleY * step);
      sampleZ = round(sampleZ * step);
      amplitude = round(amplitude * decay);
    }
    return round(sum / weight);
  }

  function faceKey2d(px: number, py: number): string {
    const x = round(px);
    const y = round(py);
    const skew = round(round(x + y) * f2);
    const baseX = Math.floor(round(x + skew));
    const baseY = Math.floor(round(y + skew));
    const unskew = round(round(baseX + baseY) * g2);
    const d0x = round(x - round(baseX - unskew));
    const d0y = round(y - round(baseY - unskew));
    return `${baseX}:${baseY}:${d0x > d0y ? 1 : 0}`;
  }

  function faceKey3d(px: number, py: number, pz: number): string {
    const x = round(px);
    const y = round(py);
    const z = round(pz);
    const skew = round(round(round(x + y) + z) * f3);
    const baseX = Math.floor(round(x + skew));
    const baseY = Math.floor(round(y + skew));
    const baseZ = Math.floor(round(z + skew));
    const unskew = round(round(round(baseX + baseY) + baseZ) * g3);
    const d0x = round(x - round(baseX - unskew));
    const d0y = round(y - round(baseY - unskew));
    const d0z = round(z - round(baseZ - unskew));
    const rank = d0x >= d0y
      ? (d0y >= d0z ? 0 : (d0x >= d0z ? 1 : 2))
      : (d0y < d0z ? 3 : (d0x < d0z ? 4 : 5));
    return `${baseX}:${baseY}:${baseZ}:${rank}`;
  }

  return { simplex2d, simplex3d, fbmSimplex2d, fbmSimplex3d, faceKey2d, faceKey3d };
}

/** The shipped reference: f32-exact, kernel radius^2 = 0.5. Goldens and the GPU test use this one. */
const shippedRef = createSimplexRef({ radiusSquared: 0.5, round: Math.fround });
const simplex2dRef = shippedRef.simplex2d;
const simplex3dRef = shippedRef.simplex3d;
const fbmSimplex2dRef = shippedRef.fbmSimplex2d;
const fbmSimplex3dRef = shippedRef.fbmSimplex3d;

// ---------------------------------------------------------------------------------------------
// Sampling helpers
// ---------------------------------------------------------------------------------------------

/** Deterministic mulberry32, so every statistic below is reproducible run to run. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FieldStats {
  readonly max: number;
  readonly mean: number;
  readonly sigma: number;
}

function statsOf(samples: number, seed: number, sample: (random: () => number) => number): FieldStats {
  const random = createRandom(seed);
  let max = 0;
  let sum = 0;
  let sumSquares = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = sample(random);
    const magnitude = Math.abs(value);
    if (magnitude > max) max = magnitude;
    sum += value;
    sumSquares += value * value;
  }
  const mean = sum / samples;
  return { max, mean, sigma: Math.sqrt(sumSquares / samples - mean * mean) };
}

// ---------------------------------------------------------------------------------------------
// Golden points
// ---------------------------------------------------------------------------------------------

/**
 * Includes both simplex-lattice vertices (where the field is exactly 0 by construction) and, in
 * pairs, points straddling a simplex face -- `[0.6, 0.5999]`/`[0.6, 0.6001]` sit either side of the
 * `d0.x == d0.y` face inside one cell, `[1.4, 0.3999]`/`[1.4, 0.4001]` either side of the face one
 * cell over. Those pairs are what catch a swapped corner in the traversal: their values must nearly
 * coincide, and a wrong `second` offset makes them diverge by O(0.1).
 */
const golden2: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.25, 0.75],
  [-0.2, 1.4],
  [-3.5, -2.5],
  [12.25, 34.75],
  [7.125, -13.875],
  [1e-7, 1e-7],
  [10000.5, -10000.25],
  [0.2886751345948129, 0.5],
  [0.6, 0.5999],
  [0.6, 0.6001],
  [1.4, 0.3999],
  [1.4, 0.4001],
];

/**
 * Straddling pairs for all three 3D faces: `d0.x == d0.y` (`[0.4, 0.4 -+ 1e-4, 0.15]`),
 * `d0.y == d0.z` (`[0.7, 0.35, 0.35 -+ 1e-4]`) and `d0.x == d0.z` (`[0.45, 0.1, 0.45 -+ 1e-4]`).
 * Each pair crosses a different branch of the six-way ranking tree.
 */
const golden3: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0.25, 0.75, 0.5],
  [-0.2, 1.4, -0.6],
  [-3.5, -2.5, -1.25],
  [12.25, 34.75, 56.5],
  [4.2, -1.25, 8.5],
  [1e-7, 1e-7, 1e-7],
  [10000.5, -10000.25, 512.125],
  [0.4, 0.3999, 0.15],
  [0.4, 0.4001, 0.15],
  [0.7, 0.35, 0.3499],
  [0.7, 0.35, 0.3501],
  [0.45, 0.1, 0.4499],
  [0.45, 0.1, 0.4501],
];

// ---------------------------------------------------------------------------------------------
// Layer 1 tests: goldens
// ---------------------------------------------------------------------------------------------

describe("f32-exact simplex reference", () => {
  test("simplex2d is golden at lattice vertices, negatives, large coordinates and simplex faces", () => {
    expect(golden2.map(([x, y]) => simplex2dRef(x, y))).toEqual([
      0,
      0.4000730812549591,
      0.6240262389183044,
      -0.6739251017570496,
      -0.09178419411182404,
      -0.6105706095695496,
      -8.662057666697365e-7,
      0.8271506428718567,
      0.3631035089492798,
      -0.00042964567546732724,
      0.0004293584206607193,
      0.2884827256202698,
      0.28930148482322693,
    ]);
  });

  test("simplex3d is golden at lattice vertices, negatives, large coordinates and simplex faces", () => {
    expect(golden3.map(([x, y, z]) => simplex3dRef(x, y, z))).toEqual([
      0,
      0.40201810002326965,
      -0.5358221530914307,
      -0.6990733742713928,
      0.7452815771102905,
      0.012958981096744537,
      0,
      -0.12100674211978912,
      0.5546005964279175,
      0.5548466444015503,
      -0.10783694684505463,
      -0.10835278034210205,
      0.2065739631652832,
      0.20659537613391876,
    ]);
  });

  test("fbmSimplex2d/fbmSimplex3d are golden across octave counts", () => {
    // 1..6 octaves at lacunarity 2, gain 0.5 -- the range the docs recommend for clouds/terrain.
    expect.soft(golden2.slice(0, 6).map(([x, y], index) => fbmSimplex2dRef(x, y, index + 1, 2, 0.5))).toEqual([
      0,
      0.551969051361084,
      0.4179699420928955,
      -0.3521827459335327,
      -0.03140551969408989,
      -0.5764849781990051,
    ]);
    expect.soft(golden3.slice(0, 6).map(([x, y, z], index) => fbmSimplex3dRef(x, y, z, index + 1, 2, 0.5))).toEqual([
      0,
      0.21853291988372803,
      -0.18416650593280792,
      -0.5519418120384216,
      0.3335844874382019,
      0.12764713168144226,
    ]);
  });

  test("simplex is exactly 0 at simplex-lattice vertices but has no zero on the integer grid", () => {
    // At a lattice vertex d0 = 0, so the vertex's own gradient dot vanishes and the other corners
    // sit at squared distance 0.667 (2D) / 0.75 (3D) > 0.5, i.e. outside the kernel.
    expect.soft(simplex2dRef(0, 0), "2D vertex (0,0)").toBe(0);
    expect.soft(simplex3dRef(0, 0, 0), "3D vertex (0,0,0)").toBe(0);
    expect.soft(simplex3dRef(0.5, 0.5, 0.5), "3D vertex (0.5,0.5,0.5)").toBe(0);
    expect.soft(simplex3dRef(-3.5, -2.5, -1.5), "3D vertex (-3.5,-2.5,-1.5)").toBe(0);
    // Unlike Perlin, the *integer* grid carries no invariant: the simplex lattice is sheared, so
    // integer points are generically interior. Do not turn the two zeros above into a lattice test.
    expect.soft(simplex2dRef(2, 7), "2D integer point").toBeCloseTo(0.8691527843475342, 7);
    expect.soft(simplex3dRef(2, 5, 9), "3D integer point").toBeCloseTo(0.7635663747787476, 7);
  });
});

// ---------------------------------------------------------------------------------------------
// The decisive test: C0 crack detector
// ---------------------------------------------------------------------------------------------

interface ScanResult {
  /** Largest first difference of consecutive samples (the design's `lab2.mjs` metric). */
  readonly maxJump: number;
  /**
   * Largest difference quotient measured against the *actual* f32 displacement between the two
   * sampled points, not the nominal step. This matters: the f32 grid spacing at |p| ~ 1000 is
   * ~6e-5, comparable to the coarse step, so a nominal-step denominator would report slopes up to
   * ~2x the real one and a crack threshold expressed in nominal steps would be pure quantization
   * noise. A discontinuity, by contrast, makes this quotient explode (a 0.6-kernel crack is
   * ~9e-3 over a ~1e-4 baseline, i.e. a slope near 100).
   */
  readonly maxSlope: number;
  /** Number of distinct simplices (cell + ranking) the scan passed through. */
  readonly faces: number;
}

/**
 * Dense 1D line scan along an irrational-slope direction (so it crosses cell boundaries, ranking
 * faces and the kernel cutoff at generic angles instead of running parallel to any of them), taking
 * the first difference of consecutive samples. `dir` is a unit vector, so a smooth field of max
 * slope K satisfies `max |dv| <= step * K`, and any excess is a discontinuity.
 */
function lineScan2d(
  simplex: (x: number, y: number) => number,
  faceKey: ((x: number, y: number) => string) | null,
  from: readonly [number, number],
  step: number,
  length: number,
): ScanResult {
  const norm = Math.hypot(1, goldenRatio);
  const dirX = 1 / norm;
  const dirY = goldenRatio / norm;
  const count = Math.round(length / step);
  let previous = simplex(from[0], from[1]);
  let previousX = Math.fround(from[0]);
  let previousY = Math.fround(from[1]);
  let previousKey = faceKey ? faceKey(from[0], from[1]) : "";
  let maxJump = 0;
  let maxSlope = 0;
  let faces = 0;
  for (let index = 1; index <= count; index += 1) {
    const x = Math.fround(from[0] + dirX * index * step);
    const y = Math.fround(from[1] + dirY * index * step);
    const value = simplex(x, y);
    const jump = Math.abs(value - previous);
    if (jump > maxJump) maxJump = jump;
    const travelled = Math.hypot(x - previousX, y - previousY);
    if (travelled > 0) {
      const slope = jump / travelled;
      if (slope > maxSlope) maxSlope = slope;
    }
    previous = value;
    previousX = x;
    previousY = y;
    if (faceKey) {
      const key = faceKey(x, y);
      if (key !== previousKey) faces += 1;
      previousKey = key;
    }
  }
  return { maxJump, maxSlope, faces };
}

function lineScan3d(
  simplex: (x: number, y: number, z: number) => number,
  faceKey: ((x: number, y: number, z: number) => string) | null,
  from: readonly [number, number, number],
  step: number,
  length: number,
): ScanResult {
  const norm = Math.hypot(1, goldenRatio, Math.SQRT2);
  const dirX = 1 / norm;
  const dirY = goldenRatio / norm;
  const dirZ = Math.SQRT2 / norm;
  const count = Math.round(length / step);
  let previous = simplex(from[0], from[1], from[2]);
  let previousX = Math.fround(from[0]);
  let previousY = Math.fround(from[1]);
  let previousZ = Math.fround(from[2]);
  let previousKey = faceKey ? faceKey(from[0], from[1], from[2]) : "";
  let maxJump = 0;
  let maxSlope = 0;
  let faces = 0;
  for (let index = 1; index <= count; index += 1) {
    const x = Math.fround(from[0] + dirX * index * step);
    const y = Math.fround(from[1] + dirY * index * step);
    const z = Math.fround(from[2] + dirZ * index * step);
    const value = simplex(x, y, z);
    const jump = Math.abs(value - previous);
    if (jump > maxJump) maxJump = jump;
    const travelled = Math.hypot(x - previousX, y - previousY, z - previousZ);
    if (travelled > 0) {
      const slope = jump / travelled;
      if (slope > maxSlope) maxSlope = slope;
    }
    previous = value;
    previousX = x;
    previousY = y;
    previousZ = z;
    if (faceKey) {
      const key = faceKey(x, y, z);
      if (key !== previousKey) faces += 1;
      previousKey = key;
    }
  }
  return { maxJump, maxSlope, faces };
}

const goldenRatio = 1.618033988749895;
const scanFrom2: readonly [number, number] = [0.3137, 0.717];
const scanFrom3: readonly [number, number, number] = [0.3137, 0.717, 1.113];
/** The design's own scan resolution (`lab2.mjs`): step 1e-6 over 6 units of arc length. */
const fineStep = 1e-6;
const fineLength = 6;
/** Coarse companion: 1e7 samples covering 1000 units, i.e. several thousand simplex faces. */
const coarseStep = 1e-4;
const coarseLength = 1000;
/** Second reference, identical except for the kernel radius the crack detector is here to reject. */
const canonicalRef = createSimplexRef({ radiusSquared: 0.6, round: Math.fround });

describe("simplexCrackDetector", () => {
  test("kernel radius^2 = 0.5 has no C0 cracks (0.6 does, by ~1000x)", () => {
    // Why this test exists and why it is the decisive one: the 4-corner (3D) / 3-corner (2D)
    // traversal only ever sums the corners of the simplex the sample falls in. Radius^2 = 0.5 is
    // exactly the largest value for which every corner the traversal *drops* is already outside the
    // kernel: on the face where the ranking flips, the dropped corner's squared distance is >= 0.5,
    // with equality at the tightest point (2D: d = (G2 - 0.5, 0.5)). At 0.6 that corner still
    // carries t = 0.1, and dropping it is a genuine C0 discontinuity -- invisible in a flat colour
    // ramp, but a seam in any derivative (normals, high-contrast ramps).
    //
    // Random eps-slope sampling does *not* reliably find this (the chance of landing within eps of a
    // crack is proportional to eps); a dense line scan does, deterministically.
    const fine2 = lineScan2d(simplex2dRef, shippedRef.faceKey2d, scanFrom2, fineStep, fineLength);
    const fine3 = lineScan3d(simplex3dRef, shippedRef.faceKey3d, scanFrom3, fineStep, fineLength);
    const coarse2 = lineScan2d(simplex2dRef, shippedRef.faceKey2d, scanFrom2, coarseStep, coarseLength);
    const coarse3 = lineScan3d(simplex3dRef, shippedRef.faceKey3d, scanFrom3, coarseStep, coarseLength);
    const cracked2 = lineScan2d(canonicalRef.simplex2d, null, scanFrom2, fineStep, fineLength);
    const cracked3 = lineScan3d(canonicalRef.simplex3d, null, scanFrom3, fineStep, fineLength);

    // The design's own bound: 20 * step * K, i.e. 20x the largest first difference a smooth field of
    // slope K can produce at this step. Measured at r^2 = 0.5, normalized field (divide by 98 / 76
    // for the design's raw-field numbers, which are 4.8e-8 / 2.9e-8):
    //   2D 7.21e-6 (raw 7.36e-8) vs bound 1.39e-4   3D 6.63e-6 (raw 8.73e-8) vs bound 1.31e-4
    expect.soft(fine2.maxJump, "simplex2d fine scan").toBeLessThan(20 * fineStep * maxSlope2);
    expect.soft(fine3.maxJump, "simplex3d fine scan").toBeLessThan(20 * fineStep * maxSlope3);
    // The tight form of the same statement: a difference quotient over the *actual* f32 displacement
    // between the two sampled points. Near the origin this is quantization-free and must respect the
    // documented Lipschitz constant itself -- measured 2D 6.647 / 3D 5.677 against 1.05 * K, which
    // also keeps K honest (a slope above the published bound is a docs bug, not a rounding excuse).
    expect.soft(fine2.maxSlope, "simplex2d fine slope").toBeLessThan(1.05 * maxSlope2);
    expect.soft(fine3.maxSlope, "simplex3d fine slope").toBeLessThan(1.05 * maxSlope3);
    // The coarse scan reaches |p| ~ 1000, where the f32 spacing of the *skewed* coordinate (~1.2e-4)
    // exceeds the step, so one position step can advance the unskewed sample by up to two spacings
    // and the quotient reads up to ~1.3x K: quantization of the f32 grid, not a discontinuity (this
    // is the same effect that makes an eps = 1e-5 slope probe useless far from the origin). Hence
    // 2 * K here -- measured 2D 9.134 / 3D 8.435, while a 0.6-kernel crack reads 9546 / 1680.
    expect.soft(coarse2.maxSlope, "simplex2d coarse slope").toBeLessThan(2 * maxSlope2);
    expect.soft(coarse3.maxSlope, "simplex3d coarse slope").toBeLessThan(2 * maxSlope3);
    expect.soft(coarse2.faces, "simplex2d faces crossed").toBeGreaterThan(2500);
    expect.soft(coarse3.faces, "simplex3d faces crossed").toBeGreaterThan(3500);

    // ...and the teeth: the same traversal with the canonical 0.6 kernel cracks by >= 100x. This is
    // asserted in-test (not left as a manual experiment) so CI locks the constant in permanently.
    // Measured on the fine scan: 2D 9.47e-3 vs 7.21e-6 (1314x), 3D 1.88e-3 vs 6.63e-6 (283x). In
    // raw-field units that is 9.66e-5 / 2.47e-5, matching the design's measured 9.5e-5 / 4.6e-5.
    expect.soft(cracked2.maxJump / fine2.maxJump, "0.6/0.5 crack ratio (2D)").toBeGreaterThan(100);
    expect.soft(cracked3.maxJump / fine3.maxJump, "0.6/0.5 crack ratio (3D)").toBeGreaterThan(100);
    expect.soft(cracked2.maxJump, "simplex2d at r^2=0.6 exceeds the smooth bound").toBeGreaterThan(20 * fineStep * maxSlope2);
    expect.soft(cracked3.maxJump, "simplex3d at r^2=0.6 exceeds the smooth bound").toBeGreaterThan(20 * fineStep * maxSlope3);
    // 9546 and 1680 respectively: three orders of magnitude above the field's own slope bound.
    expect.soft(cracked2.maxSlope, "simplex2d at r^2=0.6 breaks the Lipschitz bound").toBeGreaterThan(100 * maxSlope2);
    expect.soft(cracked3.maxSlope, "simplex3d at r^2=0.6 breaks the Lipschitz bound").toBeGreaterThan(100 * maxSlope3);
  }, 120000);

  test("the shipped WGSL uses the 0.5 kernel this file validates", async () => {
    const source = stripComments(await readFile(simplexPath, "utf8"));

    // Both kernels, spelled exactly as the reference evaluates them. If someone edits the constant
    // to 0.6 the crack test above still passes (it carries its own copy) -- this is what fails.
    expect.soft(source.match(/let t = 0\.5 - dot\(d, d\);/gu)?.length, "0.5 kernels in index.wgsl").toBe(2);
    expect.soft(source, "0.6 kernel").not.toMatch(/0\.6\s*-\s*dot/u);
  });

  test("values agree across every simplex face crossing", () => {
    // A directly targeted version of the scan: each pair straddles one face of the ranking tree, so
    // the two sides use different middle corners. Continuity forces the values to agree to within
    // slope * separation; a swapped corner shows up as O(0.1).
    const separation = 2e-4;
    const pairs2: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
      [[0.6, 0.5999], [0.6, 0.6001]],
      [[1.4, 0.3999], [1.4, 0.4001]],
      [[-2.6, -2.6001], [-2.6, -2.5999]],
    ];
    const pairs3: readonly (readonly [readonly [number, number, number], readonly [number, number, number]])[] = [
      [[0.4, 0.3999, 0.15], [0.4, 0.4001, 0.15]],
      [[0.7, 0.35, 0.3499], [0.7, 0.35, 0.3501]],
      [[0.45, 0.1, 0.4499], [0.45, 0.1, 0.4501]],
      [[-1.3, -1.3001, -2.7], [-1.3, -1.2999, -2.7]],
    ];

    for (const [left, right] of pairs2) {
      expect.soft(Math.abs(simplex2dRef(right[0], right[1]) - simplex2dRef(left[0], left[1])), `2D face ${left}`)
        .toBeLessThan(separation * maxSlope2);
      expect.soft(shippedRef.faceKey2d(left[0], left[1]), `2D face ${left} is a real crossing`)
        .not.toBe(shippedRef.faceKey2d(right[0], right[1]));
    }
    for (const [left, right] of pairs3) {
      expect.soft(Math.abs(simplex3dRef(right[0], right[1], right[2]) - simplex3dRef(left[0], left[1], left[2])), `3D face ${left}`)
        .toBeLessThan(separation * maxSlope3);
      expect.soft(shippedRef.faceKey3d(left[0], left[1], left[2]), `3D face ${left} is a real crossing`)
        .not.toBe(shippedRef.faceKey3d(right[0], right[1], right[2]));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Range, contrast floor, mean/sigma
// ---------------------------------------------------------------------------------------------

describe("field statistics", () => {
  // 1e6 samples rather than the design's exploratory 1e7: the properties are identical and the
  // suite stays in the seconds range. Coordinates stay inside |p| <= 256, where f32 still carries
  // full detail (see index.docs.md on the f32 domain).
  const samples = 1_000_000;

  test("simplex2d never clips, keeps its contrast floor, and matches the published sigma", () => {
    const stats = statsOf(samples, 0x51b91e5c, (random) => simplex2dRef((random() - 0.5) * 512, (random() - 0.5) * 512));

    expect.soft(stats.max, "range").toBeLessThan(1);
    expect.soft(stats.max, "contrast floor").toBeGreaterThan(0.85);
    expect.soft(Math.abs(stats.mean), "mean").toBeLessThan(5e-3);
    expect.soft(stats.sigma, "sigma").toBeGreaterThan(sigma2 * 0.9);
    expect.soft(stats.sigma, "sigma").toBeLessThan(sigma2 * 1.1);
  }, 60000);

  test("simplex3d never clips, keeps its contrast floor, and matches the published sigma", () => {
    const stats = statsOf(samples, 0x7f4a1d33, (random) => simplex3dRef((random() - 0.5) * 512, (random() - 0.5) * 512, (random() - 0.5) * 512));

    expect.soft(stats.max, "range").toBeLessThan(1);
    expect.soft(stats.max, "contrast floor").toBeGreaterThan(0.85);
    expect.soft(Math.abs(stats.mean), "mean").toBeLessThan(5e-3);
    expect.soft(stats.sigma, "sigma").toBeGreaterThan(sigma3 * 0.9);
    expect.soft(stats.sigma, "sigma").toBeLessThan(sigma3 * 1.1);
  }, 60000);

  test("the normalizers stay just under 1/sup, so the (-1, 1) guarantee is a proof", () => {
    // 98.0 * 0.0100802047 and 76.0 * 0.0130071572: the shipped normalizers are below 1/sup, which
    // is what makes abs(value) < 1 a proof rather than an observation. Recomputing the suprema is
    // the design's job (noise-lab/lab2.mjs); this pins the arithmetic the WGSL comment claims.
    expect.soft(98 * 0.0100802047).toBeLessThan(1);
    expect.soft(98 * 0.0100802047).toBeGreaterThan(0.98);
    expect.soft(76 * 0.0130071572).toBeLessThan(1);
    expect.soft(76 * 0.0130071572).toBeGreaterThan(0.98);
  });
});

// ---------------------------------------------------------------------------------------------
// Lipschitz continuity
// ---------------------------------------------------------------------------------------------

describe("Lipschitz continuity", () => {
  // Simplex has no lattice-zero invariant to lean on, so slope stability across eps is the main
  // continuity guard besides the crack scan: an instability that grows as eps shrinks is the
  // tell-tale of a discontinuity. Two precautions, both about the documented f32 domain rather than
  // about the field: the sampling box is |p| <= 8, where the f32 spacing (~9.5e-7) is still well
  // under the smallest eps, and the difference quotient divides by the *actual* f32 displacement.
  // Sampling at |p| ~ 256 with eps = 1e-5 instead measures the f32 grid (spacing ~3e-5) and reports
  // slopes several times the real ones -- quantization, not a discontinuity.
  const epsilons: readonly number[] = [1e-2, 1e-3, 1e-4, 1e-5];

  test("simplex2d slope stays under 1.1x the documented 6.95 for every eps", () => {
    for (const epsilon of epsilons) {
      const random = createRandom(0x2f13ab5d);
      let maxSlope = 0;
      for (let index = 0; index < 20000; index += 1) {
        const x = (random() - 0.5) * 16;
        const y = (random() - 0.5) * 16;
        const angle = random() * Math.PI * 2;
        const qx = Math.fround(x + Math.cos(angle) * epsilon);
        const qy = Math.fround(y + Math.sin(angle) * epsilon);
        const distance = Math.hypot(qx - Math.fround(x), qy - Math.fround(y));
        if (distance === 0) continue;
        const slope = Math.abs(simplex2dRef(qx, qy) - simplex2dRef(x, y)) / distance;
        if (slope > maxSlope) maxSlope = slope;
      }
      expect.soft(maxSlope, `eps=${epsilon}`).toBeLessThan(1.1 * maxSlope2);
      expect.soft(maxSlope, `eps=${epsilon} is not degenerate`).toBeGreaterThan(1);
    }
  }, 60000);

  test("simplex3d slope stays under 1.1x the documented 6.53 for every eps", () => {
    for (const epsilon of epsilons) {
      const random = createRandom(0x6c1b7e09);
      let maxSlope = 0;
      for (let index = 0; index < 20000; index += 1) {
        const x = (random() - 0.5) * 16;
        const y = (random() - 0.5) * 16;
        const z = (random() - 0.5) * 16;
        const theta = random() * Math.PI * 2;
        const cosPhi = random() * 2 - 1;
        const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
        const qx = Math.fround(x + sinPhi * Math.cos(theta) * epsilon);
        const qy = Math.fround(y + sinPhi * Math.sin(theta) * epsilon);
        const qz = Math.fround(z + cosPhi * epsilon);
        const distance = Math.hypot(qx - Math.fround(x), qy - Math.fround(y), qz - Math.fround(z));
        if (distance === 0) continue;
        const slope = Math.abs(simplex3dRef(qx, qy, qz) - simplex3dRef(x, y, z)) / distance;
        if (slope > maxSlope) maxSlope = slope;
      }
      expect.soft(maxSlope, `eps=${epsilon}`).toBeLessThan(1.1 * maxSlope3);
      expect.soft(maxSlope, `eps=${epsilon} is not degenerate`).toBeGreaterThan(1);
    }
  }, 60000);
});

// ---------------------------------------------------------------------------------------------
// FBM
// ---------------------------------------------------------------------------------------------

describe("fbmSimplex", () => {
  test("fbm(p, 1, lacunarity, gain) is exactly the base noise", () => {
    const random = createRandom(0x11ce55ad);
    for (let index = 0; index < 2000; index += 1) {
      const x = (random() - 0.5) * 256;
      const y = (random() - 0.5) * 256;
      const z = (random() - 0.5) * 256;
      for (const lacunarity of [1, 2, 2.17, 4]) {
        for (const gain of [0, 0.25, 0.5, 0.75, 1]) {
          expect.soft(fbmSimplex2dRef(x, y, 1, lacunarity, gain)).toBe(simplex2dRef(x, y));
          expect.soft(fbmSimplex3dRef(x, y, z, 1, lacunarity, gain)).toBe(simplex3dRef(x, y, z));
        }
      }
    }
  });

  test("octaves and gain are clamped, so out-of-range arguments stay in range", () => {
    const [x, y, z] = [1.75, -3.25, 6.5];

    expect.soft(fbmSimplex3dRef(x, y, z, 0, 2, 0.5), "octaves 0 -> 1").toBe(simplex3dRef(x, y, z));
    expect.soft(fbmSimplex3dRef(x, y, z, -7, 2, 0.5), "octaves -7 -> 1").toBe(simplex3dRef(x, y, z));
    expect.soft(fbmSimplex3dRef(x, y, z, 999, 2, 0.5), "octaves 999 -> 16").toBe(fbmSimplex3dRef(x, y, z, 16, 2, 0.5));
    expect.soft(fbmSimplex3dRef(x, y, z, 4, 2, -1), "gain -1 -> 0").toBe(fbmSimplex3dRef(x, y, z, 4, 2, 0));
    expect.soft(fbmSimplex3dRef(x, y, z, 4, 2, 5), "gain 5 -> 1").toBe(fbmSimplex3dRef(x, y, z, 4, 2, 1));
    // gain 0 keeps only the first octave (amplitude 0 afterwards), weight stays 1.
    expect.soft(fbmSimplex3dRef(x, y, z, 8, 2, 0), "gain 0").toBe(simplex3dRef(x, y, z));
  });

  test("fbm stays inside (-1, 1) across the octave/gain/lacunarity grid", () => {
    const random = createRandom(0x4d99f001);
    let max = 0;
    for (let index = 0; index < 250; index += 1) {
      const x = (random() - 0.5) * 128;
      const y = (random() - 0.5) * 128;
      const z = (random() - 0.5) * 128;
      for (const octaves of [1, 2, 4, 8, 16]) {
        for (const gain of [0, 0.25, 0.5, 0.75, 1]) {
          for (const lacunarity of [1, 2, 2.17, 4]) {
            const flat = fbmSimplex2dRef(x, y, octaves, lacunarity, gain);
            const solid = fbmSimplex3dRef(x, y, z, octaves, lacunarity, gain);
            max = Math.max(max, Math.abs(flat), Math.abs(solid));
          }
        }
      }
    }

    expect(max).toBeLessThan(1);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------
// Numerical hygiene
// ---------------------------------------------------------------------------------------------

test("simplex stays finite at extreme, exact and negative coordinates", () => {
  const magnitudes = [0, 1e-7, 1, 1e3, 1e5, 1e6, 2 ** 23];
  for (const magnitude of magnitudes) {
    for (const sign of [1, -1]) {
      const p = sign * magnitude;
      expect.soft(Number.isFinite(simplex2dRef(p, p)), `simplex2d(${p})`).toBe(true);
      expect.soft(Number.isFinite(simplex2dRef(p, p + 0.5)), `simplex2d(${p}, +0.5)`).toBe(true);
      expect.soft(Number.isFinite(simplex3dRef(p, p, p)), `simplex3d(${p})`).toBe(true);
      expect.soft(Number.isFinite(simplex3dRef(p + 0.5, p, p - 0.5)), `simplex3d(${p}, half)`).toBe(true);
      expect.soft(Number.isFinite(fbmSimplex3dRef(p, p, p, 6, 2, 0.5)), `fbmSimplex3d(${p})`).toBe(true);
      // The range guarantee has to survive the whole domain, not just the well-behaved part.
      expect.soft(Math.abs(simplex3dRef(p, p, p)), `range at ${p}`).toBeLessThan(1);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Layer 4: plumbing
// ---------------------------------------------------------------------------------------------

describe("module plumbing", () => {
  test("simplex resolves from @vgpu/wgsl-std/noise/simplex with the expected dependency set", async () => {
    const dir = await workspaceFixture();
    const entry = join(dir, "app", "main.wgsl");
    await writeFile(entry, `import { simplex2d, simplex3d, fbmSimplex2d, fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";
fn main() -> f32 {
  let flat = simplex2d(vec2f(0.25, 0.75));
  let solid = simplex3d(vec3f(0.25, 0.75, 0.5));
  let clouds = fbmSimplex3d(vec3f(0.25, 0.75, 0.5), 5, 2.0, 0.5);
  return flat + solid + clouds + fbmSimplex2d(vec2f(0.25, 0.75), 3, 2.0, 0.5);
}`);

    const result = await resolveShader({ entry, validate: false });

    expect.soft(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/noise/simplex/index.wgsl"))).toBe(true);
    expect.soft(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/noise/internal/gradient.wgsl"))).toBe(true);
    expect.soft(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/hash/index.wgsl"))).toBe(true);
    // Tree-shaking by module split (Decision 4): the sibling noise modules are never reachable.
    expect.soft(result.deps.some((dep) => dep.includes("noise/perlin"))).toBe(false);
    // Symbol-level, not text-level: the shared gradient core credits "Perlin 2002" in a comment.
    expect.soft(result.wgsl, "voronoi symbol").not.toMatch(/_vgsl_[0-9a-f]{8}__voronoi/u);
    expect.soft(result.wgsl, "perlin symbol").not.toMatch(/_vgsl_[0-9a-f]{8}__(perlin|fbmPerlin)/u);
    for (const name of ["simplex2d", "simplex3d", "fbmSimplex2d", "fbmSimplex3d", "gradDot2", "gradDot3", "pcg2d", "pcg3d"]) {
      expect.soft(result.wgsl, name).toMatch(new RegExp(`_vgsl_[0-9a-f]{8}__${name}\\b`, "u"));
    }
  });

  test("simplex minified output is deterministic", async () => {
    const dir = await workspaceFixture();
    const entry = join(dir, "app", "main.wgsl");
    await writeFile(entry, `import { fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";
fn main() -> f32 {
  return fbmSimplex3d(vec3f(1.0, 2.0, 3.0), 5, 2.0, 0.5);
}`);

    const first = await resolveShader({ entry, validate: false, minify: true });
    const second = await resolveShader({ entry, validate: false, minify: true });

    expect(first.wgsl).toBe(second.wgsl);
    expect(first.wgsl).not.toContain("\n");
    expect(first.wgsl).not.toContain("//");
    expect(first.wgsl).toContain("for(var");
  });

  test("simplex/index.wgsl inherits the gradient core's determinism contract", async () => {
    const source = stripComments(await readFile(simplexPath, "utf8"));

    expect.soft(source, "array< token (lookup table)").not.toMatch(/array\s*</u);
    expect.soft(source, "transcendental call").not.toMatch(/\b(sin|cos|sqrt|inverseSqrt|pow)\s*\(/u);
    // GLSL's mod() has different sign semantics from WGSL's %; a ported mod289 is a negative-
    // coordinate bug. There is no float modulo in this module at all.
    expect.soft(source, "float modulo").not.toMatch(/%/u);
    // vec2i(floor(...)), never vec2i(position): truncation toward zero would fold the cells around 0.
    expect.soft(source, "cell from floor").toMatch(/let base = floor\(position \+ vec2f\(skew\)\);/u);
    expect.soft(source, "cell from floor 3D").toMatch(/let base = floor\(position \+ vec3f\(skew\)\);/u);
    for (const name of ["simplex2d", "simplex3d", "fbmSimplex2d", "fbmSimplex3d"]) {
      expect.soft(source, name).toMatch(new RegExp(`export\\s+fn\\s+${name}\\b`, "u"));
    }
    // The normalizers are a published contract, not tunable constants.
    expect.soft(source, "2D normalizer").toMatch(/return 98\.0 \* total;/u);
    expect.soft(source, "3D normalizer").toMatch(/return 76\.0 \* total;/u);
  });

  test.skipIf(!dockerTest)("resolved simplex shader validates with naga", async () => {
    const dir = await workspaceFixture();
    const entry = join(dir, "app", "main.wgsl");
    await writeFile(entry, `import { simplex2d, simplex3d, fbmSimplex2d, fbmSimplex3d } from "@vgpu/wgsl-std/noise/simplex";
@compute @workgroup_size(1)
fn main() {
  let flat = simplex2d(vec2f(0.25, 0.75));
  let solid = simplex3d(vec3f(0.25, 0.75, 0.5));
  let clouds = fbmSimplex3d(vec3f(flat, solid, 0.5), 5, 2.0, 0.5);
  let plasma = fbmSimplex2d(vec2f(flat, clouds), 3, 2.0, 0.5);
}`);

    await expect(resolveShader({ entry })).resolves.toHaveProperty("wgsl");
  });
});

// ---------------------------------------------------------------------------------------------
// Layer 2: GPU readback (Docker only) -- the only thing binding the WGSL to the reference above
// ---------------------------------------------------------------------------------------------

/** 16 points per function: lattice vertices, face straddlers, negatives, large coordinates. */
const gpuPoints2: readonly (readonly [number, number])[] = [
  [0, 0], [0.25, 0.75], [-0.2, 1.4], [-3.5, -2.5],
  [12.25, 34.75], [7.125, -13.875], [0.2886751345948129, 0.5], [64.5, -128.25],
  [0.6, 0.5999], [0.6, 0.6001], [1.4, 0.3999], [1.4, 0.4001],
  [-2.6, -2.6001], [-2.6, -2.5999], [0.5, 0.5], [2, 7],
];
const gpuPoints3: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [0.25, 0.75, 0.5], [-0.2, 1.4, -0.6], [-3.5, -2.5, -1.25],
  [12.25, 34.75, 56.5], [4.2, -1.25, 8.5], [0.5, 0.5, 0.5], [64.5, -32.25, 128.125],
  [0.4, 0.3999, 0.15], [0.4, 0.4001, 0.15], [0.7, 0.35, 0.3499], [0.7, 0.35, 0.3501],
  [0.45, 0.1, 0.4499], [0.45, 0.1, 0.4501], [-1.3, -1.3001, -2.7], [2, 5, 9],
];
/** fbmSimplex2d octave/lacunarity/gain triples, one per point. */
const gpuFbmArgs: readonly (readonly [number, number, number])[] = [
  [1, 2, 0.5], [2, 2, 0.5], [3, 2, 0.5], [4, 2, 0.5],
  [5, 2, 0.5], [6, 2, 0.5], [3, 2.17, 0.25], [3, 4, 0.75],
  [16, 2, 0.5], [8, 1, 0.5], [2, 2, 1], [2, 2, 0],
  [5, 2.17, 0.6], [7, 2, 0.45], [3, 2, 0.5], [4, 2.5, 0.55],
];

test.skipIf(!dockerTest)("simplex.wgsl on the GPU matches the f32-exact reference within 1e-5", async () => {
  const outputLength = gpuPoints2.length + gpuPoints3.length + gpuFbmArgs.length;
  const lines: string[] = [];
  gpuPoints2.forEach(([x, y], index) => {
    lines.push(`  out.values[${index}] = simplex2d(vec2f(${wgslFloat(x)}, ${wgslFloat(y)}));`);
  });
  gpuPoints3.forEach(([x, y, z], index) => {
    lines.push(`  out.values[${gpuPoints2.length + index}] = simplex3d(vec3f(${wgslFloat(x)}, ${wgslFloat(y)}, ${wgslFloat(z)}));`);
  });
  gpuFbmArgs.forEach(([octaves, lacunarity, gain], index) => {
    const [x, y] = gpuPoints2[index]!;
    const slot = gpuPoints2.length + gpuPoints3.length + index;
    lines.push(`  out.values[${slot}] = fbmSimplex2d(vec2f(${wgslFloat(x)}, ${wgslFloat(y)}), ${octaves}, ${wgslFloat(lacunarity)}, ${wgslFloat(gain)});`);
  });

  const values = await runNoiseCompute({
    modulePackagePath: simplexPath,
    packageSubpath: simplexSubpath,
    imports: ["simplex2d", "simplex3d", "fbmSimplex2d"],
    outputLength,
    computeBody: lines.join("\n"),
  });

  expect(values).toHaveLength(outputLength);
  const expected: number[] = [
    ...gpuPoints2.map(([x, y]) => simplex2dRef(x, y)),
    ...gpuPoints3.map(([x, y, z]) => simplex3dRef(x, y, z)),
    ...gpuFbmArgs.map(([octaves, lacunarity, gain], index) => {
      const [x, y] = gpuPoints2[index]!;
      return fbmSimplex2dRef(x, y, octaves, lacunarity, gain);
    }),
  ];
  let sumSquares = 0;
  expected.forEach((want, index) => {
    const got = values[index]!;
    // 1e-5 absolute: ~30-60 dependent f32 ops at <=0.5 ulp each, plus permitted FMA contraction,
    // then a x98 amplification of the kernel sum. Any *algorithmic* error (wrong corner, wrong
    // unskew, wrong gradient) is O(1e-2) or larger and cannot hide under this.
    expect.soft(Math.abs(got - want), `slot ${index} (want ${want}, got ${got})`).toBeLessThan(1e-5);
    sumSquares += (got - want) ** 2;
  });
  expect(Math.sqrt(sumSquares / expected.length), "aggregate RMS").toBeLessThan(1e-6);
}, 120000);

/** WGSL needs a decimal point on float literals; emit the exact f32 the reference consumed. */
function wgslFloat(value: number): string {
  const exact = Math.fround(value);
  return Number.isInteger(exact) ? `${exact}.0` : `${exact}`;
}

/** Same comment stripping purity.test.ts uses, so a banned token in a comment is not a failure. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "");
}

async function workspaceFixture(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "vgpu-wgsl-std-simplex-"));
  await mkdir(join(dir, "app"), { recursive: true });
  await mkdir(join(dir, "node_modules", "@vgpu"), { recursive: true });
  await symlink(resolve("packages/wgsl-std"), join(dir, "node_modules", "@vgpu", "wgsl-std"), "dir");
  return dir;
}


