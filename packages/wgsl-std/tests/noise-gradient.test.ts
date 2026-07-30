import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { fade2Ref, fade3Ref, gradDot2Ref, gradDot3Ref, gradIndex2Ref, gradIndex3Ref, pcg2dRef, pcg3dRef } from "./support/hash-reference.ts";
import { runNoiseCompute } from "./support/gpu-compute.ts";

const dockerTest = process.env.VGPU_DOCKER_TEST === "1";
const gradientPath = resolve("packages/wgsl-std/src/noise/internal/gradient.wgsl");
const gradientSubpath = "@vgpu/wgsl-std/noise/internal/gradient";

/** Cells whose gradient index the GPU test and the golden table both pin down. */
const cells2: readonly (readonly [number, number])[] = [[0, 0], [12, 34], [-1, 2], [-7, -13]];
const cells3: readonly (readonly [number, number, number])[] = [[0, 0, 0], [12, 34, 56], [-1, 2, -3], [5, -9, 17]];
/** Offsets used for the dot-product sweeps: one interior point, one straddling negative axes. */
const dot2Offset: readonly [number, number] = [0.25, 0.75];
const dot3Offset: readonly [number, number, number] = [0.25, 0.75, -0.5];

describe("gradient core determinism contract", () => {
  test("gradient.wgsl uses no lookup tables and no implementation-defined transcendentals", async () => {
    const source = stripComments(await readFile(gradientPath, "utf8"));

    expect.soft(source, "array< token (lookup table)").not.toMatch(/array\s*</u);
    expect.soft(source, "transcendental call").not.toMatch(/\b(sin|cos|sqrt|inverseSqrt|pow)\s*\(/u);
  });

  test("gradient.wgsl exports the shared symbols perlin/simplex import relatively", async () => {
    const source = stripComments(await readFile(gradientPath, "utf8"));

    for (const name of ["noiseInvSqrt2", "gradIndex2", "gradIndex3", "gradDot2", "gradDot3", "noiseFade2", "noiseFade3"]) {
      // The `export` keyword is what the resolver's import graph is keyed off
      // (packages/wgsl/src/runtime/parser.ts); privacy comes from the missing package.json export.
      expect.soft(source, name).toMatch(new RegExp(`export\\s+(fn|const)\\s+${name}\\b`, "u"));
    }
  });
});

test("gradient helpers resolve through a relative import from inside an installed package", async () => {
  const dir = await installedPackageFixture();
  const smokeDir = join(dir, "node_modules", "@vgpu", "wgsl-std", "src", "noise", "_tmp-gradient-smoke");
  await mkdir(smokeDir, { recursive: true });
  await writeFile(join(smokeDir, "index.wgsl"), `import { gradIndex2, gradIndex3, gradDot2, gradDot3, noiseFade2, noiseFade3 } from "../internal/gradient.wgsl";

export fn smoke(position: vec2f, volume: vec3f) -> f32 {
  let flat = gradDot2(gradIndex2(vec2i(floor(position))), noiseFade2(position));
  let solid = gradDot3(gradIndex3(vec3i(floor(volume))), noiseFade3(volume));
  return flat + solid;
}`);
  const entry = join(dir, "app", "main.wgsl");
  await writeFile(entry, `import { smoke } from "../node_modules/@vgpu/wgsl-std/src/noise/_tmp-gradient-smoke/index.wgsl";
fn main() -> f32 {
  return smoke(vec2f(0.25, 0.75), vec3f(0.25, 0.75, 0.5));
}`);

  const result = await resolveShader({ entry, validate: false });

  expect(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/noise/internal/gradient.wgsl"))).toBe(true);
  expect(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/noise/_tmp-gradient-smoke/index.wgsl"))).toBe(true);
  expect(result.deps.some((dep) => dep.endsWith("node_modules/@vgpu/wgsl-std/src/hash/index.wgsl"))).toBe(true);
  for (const name of ["noiseInvSqrt2", "gradIndex2", "gradIndex3", "gradDot2", "gradDot3", "noiseFade2", "noiseFade3"]) {
    expect.soft(result.wgsl, name).toMatch(new RegExp(`_vgsl_[0-9a-f]{8}__${name}`, "u"));
  }
});

describe("f32-exact gradient reference", () => {
  test("gradIndex2Ref/gradIndex3Ref agree with the pinned pcg2d/pcg3d hashes", () => {
    // Cross-check against the hashes hash.test.ts already pins, so an extraction bug in
    // support/hash-reference.ts fails here instead of silently poisoning every noise golden.
    expect.soft(pcg2dRef([0, 0])).toEqual([417608103, 90043601]);
    expect.soft(pcg2dRef([12, 34])).toEqual([2014198264, 1804320464]);
    expect.soft(pcg3dRef([0, 0, 0])).toEqual([2611956841, 2833785475, 1058371385]);
    expect.soft(pcg3dRef([12, 34, 56])).toEqual([2329867099, 1935890346, 3960488285]);

    expect.soft(gradIndex2Ref([0, 0])).toBe(417608103 & 7);
    expect.soft(gradIndex2Ref([12, 34])).toBe(2014198264 & 7);
    expect.soft(gradIndex3Ref([0, 0, 0])).toBe(2611956841 % 12);
    expect.soft(gradIndex3Ref([12, 34, 56])).toBe(2329867099 % 12);
    // Negative cells go through bitcast<vec2u>/bitcast<vec3u>, i.e. two's complement.
    expect.soft(gradIndex2Ref([-1, 2])).toBe(pcg2dRef([0xffffffff, 2])[0] & 7);
    expect.soft(gradIndex3Ref([-1, 2, -3])).toBe(pcg3dRef([0xffffffff, 2, 0xfffffffd])[0] % 12);
  });

  test("gradient indices are golden for the shared cell set", () => {
    expect.soft(cells2.map((cell) => gradIndex2Ref(cell))).toEqual([7, 0, 3, 5]);
    expect.soft(cells3.map((cell) => gradIndex3Ref(cell))).toEqual([1, 7, 5, 1]);
    expect.soft(cells2.every((cell) => gradIndex2Ref(cell) < 8)).toBe(true);
    expect.soft(cells3.every((cell) => gradIndex3Ref(cell) < 12)).toBe(true);
  });

  test("gradDot2Ref reproduces the 8 unit gradients exactly", () => {
    const [dx, dy] = dot2Offset;

    expect(Array.from({ length: 8 }, (_unused, index) => gradDot2Ref(index, dx, dy))).toEqual([
      0.25, -0.25, 0.75, -0.75,
      0.7071067690849304, 0.3535533845424652, -0.3535533845424652, -0.7071067690849304,
    ]);
    // Unit length: the diagonal gradients must not exceed the axis-aligned ones on the unit circle.
    expect.soft(gradDot2Ref(4, 1, 0)).toBeCloseTo(0.7071067690849304, 7);
    expect.soft(gradDot2Ref(4, -0.5, 0.5)).toBe(0);
  });

  test("gradDot3Ref reproduces the 12 cube-edge gradients exactly", () => {
    const [dx, dy, dz] = dot3Offset;

    expect(Array.from({ length: 12 }, (_unused, index) => gradDot3Ref(index, dx, dy, dz))).toEqual([
      1, 0.5, -0.5, -1,
      -0.25, -0.75, 0.75, 0.25,
      0.25, -1.25, 1.25, -0.25,
    ]);
    // index/4 selects the pair (0 -> xy, 1 -> xz, 2 -> yz): a transposed pair breaks these three.
    expect.soft(gradDot3Ref(0, 1, 2, 4), "pair xy").toBe(3);
    expect.soft(gradDot3Ref(4, 1, 2, 4), "pair xz").toBe(5);
    expect.soft(gradDot3Ref(8, 1, 2, 4), "pair yz").toBe(6);
  });

  test("fadeRef is the quintic 6t^5-15t^4+10t^3 with exact endpoints and midpoint", () => {
    expect.soft(fade2Ref(0, 1)).toEqual([0, 1]);
    expect.soft(fade2Ref(0.5, 0.25)).toEqual([0.5, 0.103515625]);
    expect.soft(fade3Ref(0.25, 0.5, 0.75)).toEqual([0.103515625, 0.5, 0.896484375]);
    // Symmetry fade(t) + fade(1-t) == 1 holds exactly on dyadic inputs.
    expect.soft(fade2Ref(0.25, 0.75)[0] + fade2Ref(0.25, 0.75)[1]).toBe(1);
  });
});

test.skipIf(!dockerTest)("gradient.wgsl on the GPU matches the f32-exact reference", async () => {
  const cellSlots2 = cells2.length;
  const cellSlots3 = cellSlots2 + cells3.length;
  const dotSlots2 = cellSlots3 + 8;
  const dotSlots3 = dotSlots2 + 12;
  const fadeSlots2 = dotSlots3 + 2;
  const outputLength = fadeSlots2 + 3;
  const values = await runNoiseCompute({
    modulePackagePath: gradientPath,
    packageSubpath: gradientSubpath,
    imports: ["gradIndex2", "gradIndex3", "gradDot2", "gradDot3", "noiseFade2", "noiseFade3"],
    outputLength,
    computeBody: `${cells2.map((cell, index) => `  out.values[${index}] = f32(gradIndex2(vec2i(${cell[0]}, ${cell[1]})));`).join("\n")}
${cells3.map((cell, index) => `  out.values[${cellSlots2 + index}] = f32(gradIndex3(vec3i(${cell[0]}, ${cell[1]}, ${cell[2]})));`).join("\n")}
  for (var i = 0u; i < 8u; i = i + 1u) {
    out.values[${cellSlots3}u + i] = gradDot2(i, vec2f(${wgslFloat(dot2Offset[0])}, ${wgslFloat(dot2Offset[1])}));
  }
  for (var j = 0u; j < 12u; j = j + 1u) {
    out.values[${dotSlots2}u + j] = gradDot3(j, vec3f(${wgslFloat(dot3Offset[0])}, ${wgslFloat(dot3Offset[1])}, ${wgslFloat(dot3Offset[2])}));
  }
  let fade2 = noiseFade2(vec2f(0.25, 0.75));
  out.values[${dotSlots3}] = fade2.x;
  out.values[${dotSlots3 + 1}] = fade2.y;
  let fade3 = noiseFade3(vec3f(0.1, 0.5, 0.9));
  out.values[${fadeSlots2}] = fade3.x;
  out.values[${fadeSlots2 + 1}] = fade3.y;
  out.values[${fadeSlots2 + 2}] = fade3.z;`,
  });

  expect(values).toHaveLength(outputLength);
  // Gradient *selection* is integer-exact on every backend: compare with no tolerance at all.
  cells2.forEach((cell, index) => {
    expect.soft(values[index], `gradIndex2(${cell})`).toBe(gradIndex2Ref(cell));
  });
  cells3.forEach((cell, index) => {
    expect.soft(values[cellSlots2 + index], `gradIndex3(${cell})`).toBe(gradIndex3Ref(cell));
  });
  // Interpolation may differ by a few ulp (FMA contraction is permitted), hence 1e-6 here; any
  // algorithmic error (wrong pair, wrong sign) is O(1e-1) and cannot hide under it.
  for (let index = 0; index < 8; index += 1) {
    expect.soft(values[cellSlots3 + index], `gradDot2(${index})`).toBeCloseTo(gradDot2Ref(index, dot2Offset[0], dot2Offset[1]), 6);
  }
  for (let index = 0; index < 12; index += 1) {
    expect.soft(values[dotSlots2 + index], `gradDot3(${index})`).toBeCloseTo(gradDot3Ref(index, dot3Offset[0], dot3Offset[1], dot3Offset[2]), 6);
  }
  const [fade2x, fade2y] = fade2Ref(0.25, 0.75);
  expect.soft(values[dotSlots3], "noiseFade2.x").toBeCloseTo(fade2x, 6);
  expect.soft(values[dotSlots3 + 1], "noiseFade2.y").toBeCloseTo(fade2y, 6);
  const [fade3x, fade3y, fade3z] = fade3Ref(0.1, 0.5, 0.9);
  expect.soft(values[fadeSlots2], "noiseFade3.x").toBeCloseTo(fade3x, 6);
  expect.soft(values[fadeSlots2 + 1], "noiseFade3.y").toBeCloseTo(fade3y, 6);
  expect.soft(values[fadeSlots2 + 2], "noiseFade3.z").toBeCloseTo(fade3z, 6);
});

/** WGSL needs a decimal point on float literals. */
function wgslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

/**
 * A *copy* of the package under `node_modules/@vgpu/wgsl-std` (not the symlink `noise.test.ts`
 * uses), so the throwaway smoke module written into it never lands in the real source tree.
 */
async function installedPackageFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vgpu-wgsl-std-gradient-"));
  const installed = join(dir, "node_modules", "@vgpu", "wgsl-std");
  await mkdir(join(dir, "app"), { recursive: true });
  await mkdir(installed, { recursive: true });
  await cp(resolve("packages/wgsl-std/package.json"), join(installed, "package.json"));
  await cp(resolve("packages/wgsl-std/src"), join(installed, "src"), { recursive: true });
  return dir;
}

/** Same comment stripping purity.test.ts uses, so a banned token in a comment is not a failure. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/\/\/.*$/gmu, "");
}
