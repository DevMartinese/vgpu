import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { fade2Ref, fade3Ref, gradDot2Ref, gradDot3Ref, gradIndex2Ref, gradIndex3Ref } from "./support/hash-reference.ts";
import { runNoiseCompute } from "./support/gpu-compute.ts";

const dockerTest = process.env.VGPU_DOCKER_TEST === "1";
const perlinPath = resolve("packages/wgsl-std/src/noise/perlin/index.wgsl");
const perlinSubpath = "@vgpu/wgsl-std/noise/perlin";

/**
 * Golden sample set, shared by the literal table below and by the GPU readback test: origin,
 * integer lattice points, the cell centre, half/quarter-lattice points, a point straddling a cell
 * boundary from both sides, negative coordinates, a cell diagonal and large coordinates.
 */
const points2: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [0, 1], [12, 34],
  [0.5, 0.5], [0.25, 0.75], [0.75, 0.25], [0.999999, 0.000001],
  [-0.25, -0.75], [-3.5, 7.25], [1234.5, -6789.25], [10000.5, 10000.5],
  [-1.000001, 2.5], [-0.000001, -0.000001], [7.125, 7.125], [0.125, 0.875],
];
const points3: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 1, 1], [12, 34, 56], [0.5, 0.5, 0.5],
  [0.25, 0.75, 0.5], [0.75, 0.25, 0.125], [0.999999, 0.000001, 0.5], [1.5, 2.5, 3.5],
  [-0.25, -0.75, -0.5], [-3.5, 7.25, -9.125], [1234.5, -6789.25, 42.75], [10000.5, 10000.5, 10000.5],
  [-1.000001, 2.5, -3.5], [-0.000001, -0.000001, -0.000001], [7.125, 7.125, 7.125], [0.125, 0.875, 0.375],
];
/** `[x, y, octaves, lacunarity, gain]`, including the out-of-range octaves/gain the WGSL clamps. */
const fbm2Cases: readonly (readonly [number, number, number, number, number])[] = [
  [0.25, 0.75, 1, 2, 0.5], [0.25, 0.75, 2, 2, 0.5], [0.25, 0.75, 4, 2, 0.5], [0.25, 0.75, 6, 2, 0.5],
  [0.25, 0.75, 4, 2.17, 0.65], [-3.5, 7.25, 5, 2, 0.5], [1234.5, -6789.25, 3, 2, 0.5], [0.5, 0.5, 8, 1.87, 0.4],
  [0.25, 0.75, 0, 2, 0.5], [0.25, 0.75, 32, 2, 0.5], [0.25, 0.75, 3, 2, -1], [0.25, 0.75, 3, 2, 7],
];
/** `[x, y, z, octaves, lacunarity, gain]`, same shape as `fbm2Cases`. */
const fbm3Cases: readonly (readonly [number, number, number, number, number, number])[] = [
  [0.25, 0.75, 0.5, 1, 2, 0.5], [0.25, 0.75, 0.5, 2, 2, 0.5], [0.25, 0.75, 0.5, 4, 2, 0.5], [0.25, 0.75, 0.5, 6, 2, 0.5],
  [0.25, 0.75, 0.5, 4, 2.17, 0.65], [-3.5, 7.25, -9.125, 5, 2, 0.5], [1234.5, -6789.25, 42.75, 3, 2, 0.5], [0.5, 0.5, 0.5, 8, 1.87, 0.4],
  [0.25, 0.75, 0.5, 0, 2, 0.5], [0.25, 0.75, 0.5, 32, 2, 0.5], [0.25, 0.75, 0.5, 3, 2, -1], [0.25, 0.75, 0.5, 3, 2, 7],
  [0.25, 0.75, 0.5, 16, 2, 1], [-19.4, 42.1, 23.8, 5, 2, 0.5], [0.5, 0.5, 0.5, 3, 1, 0.5], [0.5, 0.5, 0.5, 3, 4, 0.75],
];

describe("perlin golden values (f32-exact reference vs pinned literals)", () => {
  // Independent literals a reviewer can eyeball: they are the *contract*, not a snapshot. Changing
  // any of them changes every shader that already shipped with this field, so a diff here must be
  // deliberate. Values below were produced by the reference at the bottom of this file.
  test("perlin2d matches the golden table", () => {
    expect(points2.slice(0, 12).map(([x, y]) => perlin2dRef(x, y))).toEqual([
      0, 0, 0, 0,
      -0.07322259247303009, -0.03503425046801567, 0.14494368433952332, 0.000002129449740095879,
      -0.1992451548576355, 0.2780884802341461, -0.018298974260687828, -0.1767749935388565,
    ]);
  });

  test("perlin3d matches the golden table", () => {
    expect(points3.slice(0, 12).map(([x, y, z]) => perlin3dRef(x, y, z))).toEqual([
      0, 0, 0, 0.24112500250339508,
      0.10844526439905167, -0.02500842697918415, 0.00000148189769788587, 0.12056250125169754,
      -0.1403551697731018, -0.41469407081604004, -0.17957761883735657, -0.24112500250339508,
    ]);
  });

  test("fbmPerlin2d matches the golden table, clamps included", () => {
    expect(fbm2Cases.map(([x, y, octaves, lacunarity, gain]) => fbmPerlin2dRef(x, y, octaves, lacunarity, gain))).toEqual([
      -0.03503425046801567, -0.04776369407773018, -0.03821095451712608, -0.03639138862490654,
      -0.014556477777659893, 0.1702527403831482, -0.04004295915365219, -0.014457226730883121,
      -0.03503425046801567, -0.03582331910729408, -0.03503425046801567, -0.036085616797208786,
    ]);
  });

  test("fbmPerlin3d matches the golden table, clamps included", () => {
    expect(fbm3Cases.slice(0, 12).map(([x, y, z, octaves, lacunarity, gain]) => fbmPerlin3dRef(x, y, z, octaves, lacunarity, gain))).toEqual([
      0.10844526439905167, 0.2732343375682831, 0.2185874730348587, 0.2081785500049591,
      0.1688300371170044, -0.2569374144077301, -0.27484792470932007, 0.1687431037425995,
      0.10844526439905167, 0.20492888987064362, 0.10844526439905167, 0.23708593845367432,
    ]);
  });

  test("the silent clamps land on the documented endpoints", () => {
    // octaves <= 1 collapses to a single octave; octaves >= 16 saturates at 16.
    expect.soft(fbmPerlin3dRef(0.25, 0.75, 0.5, 0, 2, 0.5)).toBe(fbmPerlin3dRef(0.25, 0.75, 0.5, 1, 2, 0.5));
    expect.soft(fbmPerlin3dRef(0.25, 0.75, 0.5, -5, 2, 0.5)).toBe(fbmPerlin3dRef(0.25, 0.75, 0.5, 1, 2, 0.5));
    expect.soft(fbmPerlin3dRef(0.25, 0.75, 0.5, 32, 2, 0.5)).toBe(fbmPerlin3dRef(0.25, 0.75, 0.5, 16, 2, 0.5));
    // gain <= 0 leaves only the first octave contributing; gain >= 1 keeps every amplitude at 1.
    expect.soft(fbmPerlin3dRef(0.25, 0.75, 0.5, 3, 2, -1)).toBe(fbmPerlin3dRef(0.25, 0.75, 0.5, 3, 2, 0));
    expect.soft(fbmPerlin3dRef(0.25, 0.75, 0.5, 3, 2, 7)).toBe(fbmPerlin3dRef(0.25, 0.75, 0.5, 3, 2, 1));
    expect.soft(fbmPerlin2dRef(0.25, 0.75, 3, 2, -1)).toBe(fbmPerlin2dRef(0.25, 0.75, 3, 2, 0));
    expect.soft(fbmPerlin2dRef(0.25, 0.75, 3, 2, 7)).toBe(fbmPerlin2dRef(0.25, 0.75, 3, 2, 1));
    // gain 0 keeps only octave 1, whose amplitude is 1 and whose weight is 1: exactly the base noise.
    expect.soft(fbmPerlin3dRef(0.25, 0.75, 0.5, 4, 2, 0)).toBe(perlin3dRef(0.25, 0.75, 0.5));
  });
});

describe("perlin field invariants", () => {
  test("perlin2d/perlin3d are exactly zero at every integer lattice point", () => {
    // The single highest-value regression test in this file: every corner offset is a zero vector at
    // a lattice point and fade(0) = 0, so any fade or corner-offset bug shows up here immediately.
    let max2 = 0;
    for (let y = -20; y <= 20; y += 1) {
      for (let x = -20; x <= 20; x += 1) max2 = Math.max(max2, Math.abs(perlin2dRef(x, y)));
    }
    let max3 = 0;
    for (let z = -6; z <= 6; z += 1) {
      for (let y = -6; y <= 6; y += 1) {
        for (let x = -6; x <= 6; x += 1) max3 = Math.max(max3, Math.abs(perlin3dRef(x, y, z)));
      }
    }

    // Measured: exactly 0 over the 41x41 (2D) and 13x13x13 (3D) lattices.
    expect.soft(max2, "perlin2d on a 41x41 lattice").toBeLessThan(1e-7);
    expect.soft(max3, "perlin3d on a 13x13x13 lattice").toBeLessThan(1e-7);
    expect.soft(max2).toBe(0);
    expect.soft(max3).toBe(0);
  });

  test("perlin2d stays inside (-1, 1) and keeps its contrast floor", () => {
    // 1e6 samples, not the design's exploratory 1e7: same property, seconds instead of a minute.
    // Deterministic seed, so the numbers below are fixed rather than flaky.
    const measured = fieldStats(1_000_000, 0x9e3779b9, (random) => perlin2dRef(sample(random), sample(random)));

    // Range is a *proof* (convex blend of corner dots, normalizer below 1/sup = 1.4142), so the
    // upper bound must never be reached; the lower bound is the contrast floor that catches an
    // over-conservative normalizer -- a silent wash-out a one-sided test would miss.
    expect.soft(measured.max, "max |perlin2d|").toBeLessThan(1.0);
    expect.soft(measured.max, "contrast floor").toBeGreaterThan(0.85);
    expect.soft(measured.max, "published max 0.995").toBeCloseTo(0.9937136769294739, 6);
    expect.soft(Math.abs(measured.mean), "|mean|").toBeLessThan(5e-3);
    // sigma within +-10% of the published 0.305 (measured 0.30487).
    expect.soft(measured.sigma, "sigma").toBeGreaterThan(0.305 * 0.9);
    expect.soft(measured.sigma, "sigma").toBeLessThan(0.305 * 1.1);
  });

  test("perlin3d stays inside (-1, 1) and keeps its contrast floor", () => {
    const measured = fieldStats(1_000_000, 0x85ebca6b, (random) => perlin3dRef(sample(random), sample(random), sample(random)));

    expect.soft(measured.max, "max |perlin3d|").toBeLessThan(1.0);
    expect.soft(measured.max, "contrast floor").toBeGreaterThan(0.85);
    expect.soft(measured.max, "published max 0.956").toBeCloseTo(0.9560372233390808, 6);
    expect.soft(Math.abs(measured.mean), "|mean|").toBeLessThan(5e-3);
    // sigma within +-10% of the published 0.260 (measured 0.26017).
    expect.soft(measured.sigma, "sigma").toBeGreaterThan(0.26 * 0.9);
    expect.soft(measured.sigma, "sigma").toBeLessThan(0.26 * 1.1);
  });

  test("finite-difference slope stays bounded and stable as epsilon shrinks", () => {
    // Continuity guard. The sampling box is deliberately small (|p| <= 8): at |p| ~ 256 the f32
    // spacing is 3e-5, so an epsilon of 1e-5 would measure coordinate quantization (apparent slope
    // ~5) instead of the field -- that is the documented f32 domain limit, not a discontinuity.
    const slopes2 = [1e-2, 1e-3, 1e-4, 1e-5].map((epsilon) => maxSlope(20_000, epsilon, 0xc2b2ae35, 2));
    const slopes3 = [1e-2, 1e-3, 1e-4, 1e-5].map((epsilon) => maxSlope(20_000, epsilon, 0x27d4eb2f, 3));

    for (const slope of slopes2) expect.soft(slope, "perlin2d slope < 1.1 * 2.74").toBeLessThan(1.1 * 2.74);
    for (const slope of slopes3) expect.soft(slope, "perlin3d slope < 1.1 * 2.45").toBeLessThan(1.1 * 2.45);
    // Stability across epsilon is the tell-tale a discontinuity would break (measured spread <3%).
    expect.soft(Math.max(...slopes2) / Math.min(...slopes2), "perlin2d slope spread").toBeLessThan(1.2);
    expect.soft(Math.max(...slopes3) / Math.min(...slopes3), "perlin3d slope spread").toBeLessThan(1.2);
  });

  test("fbmPerlin(p, 1, lacunarity, gain) is exactly the base noise", () => {
    const random = mulberry32(0x9e3779b1);

    for (const lacunarity of [1, 2, 2.17, 4]) {
      for (const gain of [0, 0.25, 0.5, 0.75, 1]) {
        for (let index = 0; index < 25; index += 1) {
          const [x, y, z] = [sample(random), sample(random), sample(random)];
          // Exact equality, not a tolerance: one octave is `fround(fround(1 * noise) / 1)`.
          expect.soft(fbmPerlin2dRef(x, y, 1, lacunarity, gain), `fbmPerlin2d(${x}, ${y}, 1, ${lacunarity}, ${gain})`).toBe(perlin2dRef(x, y));
          expect.soft(fbmPerlin3dRef(x, y, z, 1, lacunarity, gain), `fbmPerlin3d(${x}, ${y}, ${z}, 1, ${lacunarity}, ${gain})`).toBe(perlin3dRef(x, y, z));
        }
      }
    }
  });

  test("fbmPerlin stays inside (-1, 1) across the octaves/gain/lacunarity grid", () => {
    const random = mulberry32(0x165667b1);
    let max2 = 0;
    let max3 = 0;

    for (const octaves of [1, 2, 4, 8, 16]) {
      for (const gain of [0, 0.25, 0.5, 0.75, 1]) {
        for (const lacunarity of [1, 2, 2.17, 4]) {
          for (let index = 0; index < 200; index += 1) {
            const [x, y, z] = [sample(random), sample(random), sample(random)];
            max2 = Math.max(max2, Math.abs(fbmPerlin2dRef(x, y, octaves, lacunarity, gain)));
            max3 = Math.max(max3, Math.abs(fbmPerlin3dRef(x, y, z, octaves, lacunarity, gain)));
          }
        }
      }
    }

    // |sum| <= weight by construction, so the amplitude normalization carries the range guarantee
    // through every octave count (measured max 0.90 in 3D).
    expect.soft(max2, "max |fbmPerlin2d|").toBeLessThan(1.0);
    expect.soft(max3, "max |fbmPerlin3d|").toBeLessThan(1.0);
  });

  test("output is finite at extreme magnitudes, exact integers and half-integers", () => {
    for (const magnitude of [0, 1e-7, 1, 1e3, 1e5, 1e6, 2 ** 23]) {
      for (const offset of [0, 0.5, 0.25]) {
        const coordinate = magnitude + offset;
        const cases = {
          [`perlin2d(${coordinate})`]: perlin2dRef(coordinate, -coordinate),
          [`perlin3d(${coordinate})`]: perlin3dRef(coordinate, -coordinate, coordinate),
          [`fbmPerlin2d(${coordinate})`]: fbmPerlin2dRef(coordinate, -coordinate, 6, 2, 0.5),
          [`fbmPerlin3d(${coordinate})`]: fbmPerlin3dRef(coordinate, -coordinate, coordinate, 6, 2, 0.5),
        };

        for (const [name, value] of Object.entries(cases)) {
          expect.soft(Number.isFinite(value), name).toBe(true);
          expect.soft(Math.abs(value), name).toBeLessThan(1.0);
        }
      }
    }
  });
});

describe("perlin module plumbing", () => {
  test("perlin/index.wgsl uses no lookup tables and no implementation-defined transcendentals", async () => {
    const source = stripComments(await readFile(perlinPath, "utf8"));

    // Same determinism contract as internal/gradient.wgsl: a table or a sin/cos gradient would make
    // the goldens above driver-dependent.
    expect.soft(source, "array< token (lookup table)").not.toMatch(/array\s*</u);
    expect.soft(source, "transcendental call").not.toMatch(/\b(sin|cos|sqrt|inverseSqrt|pow)\s*\(/u);
    // The two measured normalizers are the field's contract; they must not drift.
    expect.soft(source, "perlin2d normalizer").toMatch(/const\s+perlinNormalize2\s*:\s*f32\s*=\s*1\.4142\s*;/u);
    expect.soft(source, "perlin3d normalizer").toMatch(/const\s+perlinNormalize3\s*:\s*f32\s*=\s*0\.9645\s*;/u);
    // Both clamps are what keep the range guarantee and bound the loop.
    expect.soft(source, "octaves clamp").toMatch(/clamp\(octaves,\s*1,\s*16\)/u);
    expect.soft(source, "gain clamp").toMatch(/clamp\(gain,\s*0\.0,\s*1\.0\)/u);
  });

  test("perlin helpers resolve from @vgpu/wgsl-std/noise/perlin and drag in only the gradient core", async () => {
    const dir = await workspaceFixture();
    const entry = join(dir, "app", "main.wgsl");
    await writeFile(entry, `import { fbmPerlin2d, fbmPerlin3d, perlin2d, perlin3d } from "${perlinSubpath}";
fn main() -> vec4f {
  let flat = perlin2d(vec2f(0.25, 0.75));
  let solid = perlin3d(vec3f(0.25, 0.75, 0.5));
  let clouds = fbmPerlin3d(vec3f(0.25, 0.75, 0.5), 5, 2.0, 0.5);
  return vec4f(flat, solid, clouds, fbmPerlin2d(vec2f(0.25, 0.75), 3, 2.0, 0.5));
}`);

    const result = await resolveShader({ entry, validate: false });

    expect(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/noise/perlin/index.wgsl"))).toBe(true);
    expect(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/noise/internal/gradient.wgsl"))).toBe(true);
    expect(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/hash/index.wgsl"))).toBe(true);
    for (const name of ["perlin2d", "perlin3d", "fbmPerlin2d", "fbmPerlin3d"]) {
      expect.soft(result.wgsl, name).toMatch(new RegExp(`_vgsl_[0-9a-f]{8}__${name}`, "u"));
    }
    // Module-per-family layout (design Decision 4): importing perlin must never pull in simplex or
    // the Voronoi module, whatever the DCE precondition on entry points happens to be. Comments are
    // stripped first because the gradient core's prose legitimately mentions both by name.
    const emitted = stripComments(result.wgsl);
    expect.soft(result.deps.some((dep) => dep.includes("noise/simplex")), "simplex in deps").toBe(false);
    expect.soft(result.deps.some((dep) => dep.endsWith("wgsl-std/src/noise/index.wgsl")), "voronoi in deps").toBe(false);
    expect.soft(emitted, "simplex declaration in source").not.toMatch(/simplex/iu);
    expect.soft(emitted, "voronoi declaration in source").not.toMatch(/voronoi/iu);
  });

  test("perlin minified output is deterministic", async () => {
    const dir = await workspaceFixture();
    const entry = join(dir, "app", "main.wgsl");
    await writeFile(entry, `import { fbmPerlin3d } from "${perlinSubpath}";
fn main() -> f32 {
  return fbmPerlin3d(vec3f(1.0, 2.0, 3.0), 5, 2.0, 0.5);
}`);

    const first = await resolveShader({ entry, validate: false, minify: true });
    const second = await resolveShader({ entry, validate: false, minify: true });

    expect(first.wgsl).toBe(second.wgsl);
    expect(first.wgsl).not.toContain("\n");
    expect(first.wgsl).not.toContain("//");
    expect(first.wgsl).toContain("for(var");
  });

  test.skipIf(!dockerTest)("resolved perlin shader validates with naga", async () => {
    const dir = await workspaceFixture();
    const entry = join(dir, "app", "main.wgsl");
    await writeFile(entry, `import { fbmPerlin2d, fbmPerlin3d, perlin2d, perlin3d } from "${perlinSubpath}";
@compute @workgroup_size(1)
fn main() {
  let flat = perlin2d(vec2f(0.25, 0.75));
  let solid = perlin3d(vec3f(0.25, 0.75, 0.5));
  let clouds = fbmPerlin3d(vec3f(0.25, 0.75, 0.5), 5, 2.0, 0.5);
  let flatClouds = fbmPerlin2d(vec2f(0.25, 0.75), 3, 2.0, 0.5);
}`);

    await expect(resolveShader({ entry })).resolves.toHaveProperty("wgsl");
  });
});

test.skipIf(!dockerTest)("perlin.wgsl on the GPU matches the f32-exact reference within 1e-5", async () => {
  // Layer 2 of the design's verification battery, and the *only* thing that binds the WGSL above to
  // the reference below: 48 values (16 per function), absolute tolerance 1e-5, aggregate RMS < 1e-6.
  // The budget comes from an ulp analysis: ~30-60 dependent f32 ops at magnitude <= 1 is ~100 ulp of
  // headroom, while any algorithmic error (wrong corner, wrong gradient, wrong normalizer) is
  // O(1e-2) or larger and cannot hide under it.
  const slots3 = points2.length;
  const slotsFbm3 = slots3 + points3.length;
  const outputLength = slotsFbm3 + fbm3Cases.length;
  const values = await runNoiseCompute({
    modulePackagePath: perlinPath,
    packageSubpath: perlinSubpath,
    imports: ["perlin2d", "perlin3d", "fbmPerlin3d"],
    outputLength,
    computeBody: [
      ...points2.map(([x, y], index) => `  out.values[${index}] = perlin2d(vec2f(${wgslFloat(x)}, ${wgslFloat(y)}));`),
      ...points3.map(([x, y, z], index) => `  out.values[${slots3 + index}] = perlin3d(vec3f(${wgslFloat(x)}, ${wgslFloat(y)}, ${wgslFloat(z)}));`),
      ...fbm3Cases.map(([x, y, z, octaves, lacunarity, gain], index) => `  out.values[${slotsFbm3 + index}] = fbmPerlin3d(vec3f(${wgslFloat(x)}, ${wgslFloat(y)}, ${wgslFloat(z)}), ${octaves}, ${wgslFloat(lacunarity)}, ${wgslFloat(gain)});`),
    ].join("\n"),
  });

  expect(values).toHaveLength(outputLength);
  const errors: number[] = [];
  points2.forEach(([x, y], index) => {
    const expected = perlin2dRef(x, y);
    errors.push(values[index]! - expected);
    expect.soft(values[index], `perlin2d(${x}, ${y})`).toBeCloseTo(expected, 5);
  });
  points3.forEach(([x, y, z], index) => {
    const expected = perlin3dRef(x, y, z);
    errors.push(values[slots3 + index]! - expected);
    expect.soft(values[slots3 + index], `perlin3d(${x}, ${y}, ${z})`).toBeCloseTo(expected, 5);
  });
  fbm3Cases.forEach(([x, y, z, octaves, lacunarity, gain], index) => {
    const expected = fbmPerlin3dRef(x, y, z, octaves, lacunarity, gain);
    errors.push(values[slotsFbm3 + index]! - expected);
    expect.soft(values[slotsFbm3 + index], `fbmPerlin3d(${x}, ${y}, ${z}, ${octaves}, ${lacunarity}, ${gain})`).toBeCloseTo(expected, 5);
  });

  const rms = Math.sqrt(errors.reduce((total, error) => total + error * error, 0) / errors.length);
  expect(errors, "48 values compared").toHaveLength(48);
  expect(Math.max(...errors.map((error) => Math.abs(error))), "max absolute GPU error").toBeLessThan(1e-5);
  expect(rms, "aggregate RMS error").toBeLessThan(1e-6);
});

// ---------------------------------------------------------------------------------------------
// f32-exact TS reference for src/noise/perlin/index.wgsl.
//
// Every float step is wrapped in `Math.fround` and evaluated in the *same order* as the WGSL
// expression, so each intermediate is the f32 value a GPU would hold. Do not reassociate and do not
// drop a `fround` "because it cannot matter": that silently turns the goldens above into f64
// goldens, and the GPU comparison then fails for the wrong reason.
// ---------------------------------------------------------------------------------------------

/** `perlinNormalize2` / `perlinNormalize3` as f32, matching the two `const`s in the WGSL. */
const perlinNormalize2Ref = Math.fround(1.4142);
const perlinNormalize3Ref = Math.fround(0.9645);

/**
 * WGSL's `mix(e1, e2, e3)` is normatively `e1 * (1 - e3) + e2 * e3`; every step is rounded here so
 * the reference holds the same f32 intermediates. A backend is free to evaluate the algebraically
 * equivalent `e1 + e3 * (e2 - e1)` (and to contract it into an FMA), which is one of the few-ulp
 * sources the GPU test's 1e-5 tolerance covers.
 */
function mixRef(left: number, right: number, weight: number): number {
  return Math.fround(Math.fround(left * Math.fround(1 - weight)) + Math.fround(right * weight));
}

/** Bit-exact `perlin2d`, evaluated in the WGSL's own order. */
export function perlin2dRef(px: number, py: number): number {
  const x = Math.fround(px);
  const y = Math.fround(py);
  // floor of an f32 is exact, and so is `position - base` (Sterbenz), so neither needs rounding.
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  const fx = x - baseX;
  const fy = y - baseY;
  const [ux, uy] = fade2Ref(fx, fy);
  const d00 = gradDot2Ref(gradIndex2Ref([baseX, baseY]), fx, fy);
  const d10 = gradDot2Ref(gradIndex2Ref([baseX + 1, baseY]), fx - 1, fy);
  const d01 = gradDot2Ref(gradIndex2Ref([baseX, baseY + 1]), fx, fy - 1);
  const d11 = gradDot2Ref(gradIndex2Ref([baseX + 1, baseY + 1]), fx - 1, fy - 1);
  return Math.fround(perlinNormalize2Ref * mixRef(mixRef(d00, d10, ux), mixRef(d01, d11, ux), uy));
}

/** Bit-exact `perlin3d`, evaluated in the WGSL's own order (x pairs, then y, then z). */
export function perlin3dRef(px: number, py: number, pz: number): number {
  const x = Math.fround(px);
  const y = Math.fround(py);
  const z = Math.fround(pz);
  const baseX = Math.floor(x);
  const baseY = Math.floor(y);
  const baseZ = Math.floor(z);
  const fx = x - baseX;
  const fy = y - baseY;
  const fz = z - baseZ;
  const [ux, uy, uz] = fade3Ref(fx, fy, fz);
  const d000 = gradDot3Ref(gradIndex3Ref([baseX, baseY, baseZ]), fx, fy, fz);
  const d100 = gradDot3Ref(gradIndex3Ref([baseX + 1, baseY, baseZ]), fx - 1, fy, fz);
  const d010 = gradDot3Ref(gradIndex3Ref([baseX, baseY + 1, baseZ]), fx, fy - 1, fz);
  const d110 = gradDot3Ref(gradIndex3Ref([baseX + 1, baseY + 1, baseZ]), fx - 1, fy - 1, fz);
  const d001 = gradDot3Ref(gradIndex3Ref([baseX, baseY, baseZ + 1]), fx, fy, fz - 1);
  const d101 = gradDot3Ref(gradIndex3Ref([baseX + 1, baseY, baseZ + 1]), fx - 1, fy, fz - 1);
  const d011 = gradDot3Ref(gradIndex3Ref([baseX, baseY + 1, baseZ + 1]), fx, fy - 1, fz - 1);
  const d111 = gradDot3Ref(gradIndex3Ref([baseX + 1, baseY + 1, baseZ + 1]), fx - 1, fy - 1, fz - 1);
  const x00 = mixRef(d000, d100, ux);
  const x10 = mixRef(d010, d110, ux);
  const x01 = mixRef(d001, d101, ux);
  const x11 = mixRef(d011, d111, ux);
  return Math.fround(perlinNormalize3Ref * mixRef(mixRef(x00, x10, uy), mixRef(x01, x11, uy), uz));
}

/** Bit-exact `fbmPerlin2d`, including both silent clamps. */
export function fbmPerlin2dRef(px: number, py: number, octaves: number, lacunarity: number, gain: number): number {
  const count = Math.min(Math.max(Math.trunc(octaves), 1), 16);
  const decay = Math.min(Math.max(Math.fround(gain), 0), 1);
  const step = Math.fround(lacunarity);
  let sum = 0;
  let amplitude = 1;
  let weight = 0;
  let sampleX = Math.fround(px);
  let sampleY = Math.fround(py);
  for (let index = 0; index < count; index += 1) {
    sum = Math.fround(sum + Math.fround(amplitude * perlin2dRef(sampleX, sampleY)));
    weight = Math.fround(weight + amplitude);
    sampleX = Math.fround(sampleX * step);
    sampleY = Math.fround(sampleY * step);
    amplitude = Math.fround(amplitude * decay);
  }
  return Math.fround(sum / weight);
}

/** Bit-exact `fbmPerlin3d`, including both silent clamps. */
export function fbmPerlin3dRef(px: number, py: number, pz: number, octaves: number, lacunarity: number, gain: number): number {
  const count = Math.min(Math.max(Math.trunc(octaves), 1), 16);
  const decay = Math.min(Math.max(Math.fround(gain), 0), 1);
  const step = Math.fround(lacunarity);
  let sum = 0;
  let amplitude = 1;
  let weight = 0;
  let sampleX = Math.fround(px);
  let sampleY = Math.fround(py);
  let sampleZ = Math.fround(pz);
  for (let index = 0; index < count; index += 1) {
    sum = Math.fround(sum + Math.fround(amplitude * perlin3dRef(sampleX, sampleY, sampleZ)));
    weight = Math.fround(weight + amplitude);
    sampleX = Math.fround(sampleX * step);
    sampleY = Math.fround(sampleY * step);
    sampleZ = Math.fround(sampleZ * step);
    amplitude = Math.fround(amplitude * decay);
  }
  return Math.fround(sum / weight);
}

// ---------------------------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------------------------

interface FieldStats {
  readonly max: number;
  readonly mean: number;
  readonly sigma: number;
}

/** Deterministic PRNG, so every statistic in this file is a fixed number rather than a flake. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coordinate in [-256, 256): wide enough to cross many cells, far from the f32 detail limit. */
function sample(random: () => number): number {
  return (random() - 0.5) * 512;
}

function fieldStats(samples: number, seed: number, evaluate: (random: () => number) => number): FieldStats {
  const random = mulberry32(seed);
  let max = 0;
  let total = 0;
  let totalSquares = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = evaluate(random);
    const magnitude = Math.abs(value);
    if (magnitude > max) max = magnitude;
    total += value;
    totalSquares += value * value;
  }
  const mean = total / samples;
  return { max, mean, sigma: Math.sqrt(totalSquares / samples - mean * mean) };
}

/** Max finite-difference slope along random unit directions, sampled inside |p| <= 8. */
function maxSlope(samples: number, epsilon: number, seed: number, dimensions: 2 | 3): number {
  const random = mulberry32(seed);
  let max = 0;
  for (let index = 0; index < samples; index += 1) {
    const x = (random() - 0.5) * 16;
    const y = (random() - 0.5) * 16;
    const z = (random() - 0.5) * 16;
    const dirX = random() - 0.5;
    const dirY = random() - 0.5;
    const dirZ = random() - 0.5;
    const length = Math.hypot(dirX, dirY, dirZ) || 1;
    const stepX = (dirX / length) * epsilon;
    const stepY = (dirY / length) * epsilon;
    const stepZ = (dirZ / length) * epsilon;
    const slope = dimensions === 2
      ? Math.abs(perlin2dRef(x + stepX, y + stepY) - perlin2dRef(x, y)) / epsilon
      : Math.abs(perlin3dRef(x + stepX, y + stepY, z + stepZ) - perlin3dRef(x, y, z)) / epsilon;
    if (slope > max) max = slope;
  }
  return max;
}

/** WGSL needs a decimal point on float literals; every coordinate here round-trips exactly to f32. */
function wgslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

/** Same comment stripping purity.test.ts uses, so a banned token in a comment is not a failure. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "");
}

async function workspaceFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vgpu-wgsl-std-perlin-"));
  await mkdir(join(dir, "app"), { recursive: true });
  await mkdir(join(dir, "node_modules", "@vgpu"), { recursive: true });
  await symlink(resolve("packages/wgsl-std"), join(dir, "node_modules", "@vgpu", "wgsl-std"), "dir");
  return dir;
}
