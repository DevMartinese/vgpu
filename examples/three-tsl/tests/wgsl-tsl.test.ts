import { fileURLToPath } from "node:url";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { vec3 } from "three/tsl";
import { describe, expect, it } from "vitest";
import { forwardingWrapper, parseFunctionHeader, tslExports } from "../src/wgsl-tsl.ts";

const SOURCE = `
// A helper the wrapper must skip: fn decoy(x: f32) -> f32
fn valueNoise3(position: vec3f) -> f32 { return position.x; }

/* block comment with fn inside(a: f32) -> f32 */
fn fbm3(position: vec3f, octaves: u32) -> f32 {
  return valueNoise3(position) * f32(octaves);
}

fn remap(inRange: vec2<f32>, outRange: vec2<f32>, value: f32) -> f32 {
  return outRange.x + (value - inRange.x) * (outRange.y - outRange.x) / (inRange.y - inRange.x);
}

fn logOnly() { return; }
`;

describe("parseFunctionHeader", () => {
  it("reads name, params, and return type", () => {
    const header = parseFunctionHeader(SOURCE, "fbm3");
    expect(header.params).toBe("position: vec3f, octaves: u32");
    expect(header.paramNames).toEqual(["position", "octaves"]);
    expect(header.returnType).toBe("f32");
  });

  it("keeps generic parameter types intact", () => {
    const header = parseFunctionHeader(SOURCE, "remap");
    expect(header.paramNames).toEqual(["inRange", "outRange", "value"]);
    expect(header.returnType).toBe("f32");
  });

  it("supports functions without a return type", () => {
    const header = parseFunctionHeader(SOURCE, "logOnly");
    expect(header.params).toBe("");
    expect(header.paramNames).toEqual([]);
    expect(header.returnType).toBe("");
  });

  it("ignores fn mentions inside comments", () => {
    expect(() => parseFunctionHeader(SOURCE, "decoy")).toThrow(/no function named decoy/);
    expect(() => parseFunctionHeader(SOURCE, "inside")).toThrow(/no function named inside/);
  });
});

describe("forwardingWrapper", () => {
  it("forwards every parameter to the wrapped function", () => {
    const wrapper = forwardingWrapper(parseFunctionHeader(SOURCE, "fbm3"));
    expect(wrapper).toBe(
      "fn fbm3_vtsl(position: vec3f, octaves: u32) -> f32 { return fbm3(position, octaves); }",
    );
  });
});

describe("tslExports over a vgpu-resolved module", () => {
  it("wraps every lava.wgsl export, including functions from imported modules", async () => {
    const entry = fileURLToPath(new URL("../src/lava.wgsl", import.meta.url));
    const resolved = await resolveShader({ entry });

    const names = ["lavaGlow", "meltSkin", "blackbody", "crustHeight", "crustSurface", "crustPbr", "lavaSink", "bakeMicroDetail", "bakeSharpDetail"] as const;
    const nodes = tslExports(resolved.wgsl, names);
    for (const name of names) expect(typeof nodes[name]).toBe("function");

    // lavaGlow's signature survives the flatten+mangle round trip.
    const header = parseFunctionHeader(resolved.wgsl, "lavaGlow");
    expect(header.paramNames).toEqual(["position", "t"]);
    expect(header.returnType).toBe("vec2f");

    const microBake = parseFunctionHeader(resolved.wgsl, "bakeMicroDetail");
    expect(microBake.paramNames).toEqual(["tileUv"]);
    expect(microBake.returnType).toBe("vec4f");

    const sharpBake = parseFunctionHeader(resolved.wgsl, "bakeSharpDetail");
    expect(sharpBake.paramNames).toEqual(["tileUv"]);
    expect(sharpBake.returnType).toBe("vec4f");
    expect(() => parseFunctionHeader(resolved.wgsl, "sharpDetail")).toThrow(/no function named sharpDetail/);
    expect(() => parseFunctionHeader(resolved.wgsl, "sharpScabs")).toThrow(/no function named sharpScabs/);
  });

  it("wraps the flattened module graph by authored names", async () => {
    const entry = fileURLToPath(new URL("../src/lava.wgsl", import.meta.url));
    const resolved = await resolveShader({ entry });

    // Non-entry-point functions are mangled per module; export keywords are gone.
    expect(resolved.wgsl).toMatch(/fn _vgsl_[0-9a-f]{8}__lavaGlow\(/);
    expect(resolved.wgsl).toMatch(/_vgsl_[0-9a-f]{8}__voronoi3d/);
    expect(resolved.wgsl).not.toMatch(/\bexport\b/);

    // The helper resolves functions by their authored names.
    const header = parseFunctionHeader(resolved.wgsl, "blackbody");
    expect(header.resolvedName).toMatch(/^_vgsl_[0-9a-f]{8}__blackbody$/);
    expect(header.paramNames).toEqual(["t"]);
    expect(forwardingWrapper(header)).toContain(`return ${header.resolvedName}(t);`);

    // wgslFn returns a callable; invoking it with named inputs builds a call node.
    const nodes = tslExports(resolved.wgsl, ["lavaGlow", "blackbody"]);
    expect(typeof nodes.blackbody).toBe("function");
    const call = nodes.lavaGlow({ position: vec3(0, 0, 0), t: 6 });
    expect(call.isNode).toBe(true);
  });
});

// f32 shader arithmetic is not required for these topology checks: wrapping
// the hashed lattice makes the identities exact before backend rounding.
function wrapCell(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function pcg2dRef(seedX: number, seedY: number): readonly [number, number] {
  const multiply = (a: number, b: number) => Math.imul(a, b) >>> 0;
  let x = (multiply(seedX >>> 0, 1664525) + 1013904223) >>> 0;
  let y = (multiply(seedY >>> 0, 1664525) + 1013904223) >>> 0;
  x = (x + multiply(y, 1664525)) >>> 0;
  y = (y + multiply(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  x = (x + multiply(y, 1664525)) >>> 0;
  y = (y + multiply(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  return [x, y];
}

function gradientDot2Ref(
  cell: readonly [number, number],
  offset: readonly [number, number],
  period: readonly [number, number],
): number {
  const wrappedX = wrapCell(cell[0], period[0]);
  const wrappedY = wrapCell(cell[1], period[1]);
  const index = pcg2dRef(wrappedX, wrappedY)[0] & 7;
  const axis = (index & 2) !== 0 ? offset[1] : offset[0];
  const axisDot = (index & 1) !== 0 ? -axis : axis;
  const sx = (index & 1) !== 0 ? -offset[0] : offset[0];
  const sy = (index & 2) !== 0 ? -offset[1] : offset[1];
  return index >= 4 ? 0.7071067811865476 * (sx + sy) : axisDot;
}

function periodicPerlin2Ref(
  position: readonly [number, number],
  period: readonly [number, number],
): number {
  const cellX = Math.floor(position[0]);
  const cellY = Math.floor(position[1]);
  const x = position[0] - cellX;
  const y = position[1] - cellY;
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const d00 = gradientDot2Ref([cellX, cellY], [x, y], period);
  const d10 = gradientDot2Ref([cellX + 1, cellY], [x - 1, y], period);
  const d01 = gradientDot2Ref([cellX, cellY + 1], [x, y - 1], period);
  const d11 = gradientDot2Ref([cellX + 1, cellY + 1], [x - 1, y - 1], period);
  return 1.4142 * mix(mix(d00, d10, fade(x)), mix(d01, d11, fade(x)), fade(y));
}

function periodicTurbulence2Ref(
  position: readonly [number, number],
  period: readonly [number, number],
): number {
  let sample: [number, number] = [...position];
  let samplePeriod: [number, number] = [...period];
  let amplitude = 0.5;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < 4; octave++) {
    total += Math.abs(periodicPerlin2Ref(sample, samplePeriod)) * amplitude;
    normalization += amplitude;
    amplitude *= 0.55;
    sample = [sample[1] * 2 + 11, sample[0] * 2 + 7];
    samplePeriod = [samplePeriod[1] * 2, samplePeriod[0] * 2];
  }
  return total / normalization;
}

function periodicFbm2Ref(
  position: readonly [number, number],
  period: readonly [number, number],
  octaves = 3,
): number {
  let sample: [number, number] = [...position];
  let samplePeriod: [number, number] = [...period];
  let amplitude = 0.5;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += periodicPerlin2Ref(sample, samplePeriod) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    sample = [sample[1] * 2 + 11, sample[0] * 2 + 7];
    samplePeriod = [samplePeriod[1] * 2, samplePeriod[0] * 2];
  }
  return Math.min(1, Math.max(0, total / normalization * 0.5 + 0.5));
}

function unitFloatRef(value: number): number {
  return (value >>> 0) / 0xffffffff;
}

function periodicVoronoi2Ref(
  position: readonly [number, number],
  period: readonly [number, number],
): readonly [number, number, number] {
  const baseX = Math.floor(position[0]);
  const baseY = Math.floor(position[1]);
  const localX = position[0] - baseX;
  const localY = position[1] - baseY;
  let nearest = Number.POSITIVE_INFINITY;
  let secondNearest = Number.POSITIVE_INFINITY;
  let cellValue = 0;

  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const wrappedX = wrapCell(baseX + x, period[0]);
      const wrappedY = wrapCell(baseY + y, period[1]);
      const hashed = pcg2dRef(wrappedX, wrappedY);
      const dx = x + unitFloatRef(hashed[0]) - localX;
      const dy = y + unitFloatRef(hashed[1]) - localY;
      const distance = Math.hypot(dx, dy);
      if (distance < nearest) {
        secondNearest = nearest;
        nearest = distance;
        cellValue = unitFloatRef(pcg2dRef(hashed[0], hashed[1])[0]);
      } else if (distance < secondNearest) {
        secondNearest = distance;
      }
    }
  }

  return [nearest, secondNearest, cellValue];
}

describe("periodic detail-bake contract", () => {
  it("resolves the periodic WGSL helpers", async () => {
    const entry = fileURLToPath(new URL("../src/noise.wgsl", import.meta.url));
    const resolved = await resolveShader({ entry });
    expect(parseFunctionHeader(resolved.wgsl, "periodicPerlin2").returnType).toBe("f32");
    expect(parseFunctionHeader(resolved.wgsl, "periodicTurbulence2").returnType).toBe("f32");
    expect(parseFunctionHeader(resolved.wgsl, "periodicFbm2").returnType).toBe("f32");
    expect(parseFunctionHeader(resolved.wgsl, "periodicVoronoi2").returnType).toBe("vec3f");
  });

  it("keeps Voronoi values and gradients continuous across either tile axis", () => {
    const period: readonly [number, number] = [34, 34];
    const epsilon = 1 / 1024;
    const points = [[0.125, 0.875], [-3.75, 11.125], [33.999, -0.001]] as const;
    const component = (p: readonly [number, number], index: 0 | 1 | 2) =>
      periodicVoronoi2Ref(p, period)[index];
    const derivative = (p: readonly [number, number], componentIndex: 0 | 1, axis: 0 | 1) => {
      const before: [number, number] = [...p];
      const after: [number, number] = [...p];
      before[axis] -= epsilon;
      after[axis] += epsilon;
      return (component(after, componentIndex) - component(before, componentIndex)) / (2 * epsilon);
    };

    for (const point of points) {
      for (const translated of [
        [point[0] + period[0], point[1]],
        [point[0], point[1] - period[1]],
      ] as const) {
        for (const componentIndex of [0, 1, 2] as const) {
          expect(component(translated, componentIndex)).toBeCloseTo(component(point, componentIndex), 10);
        }
        for (const componentIndex of [0, 1] as const) {
          expect(derivative(translated, componentIndex, 0)).toBeCloseTo(derivative(point, componentIndex, 0), 8);
          expect(derivative(translated, componentIndex, 1)).toBeCloseTo(derivative(point, componentIndex, 1), 8);
        }
      }
    }
  });

  it("keeps the low-frequency sharp-detail warp periodic for negative UVs", () => {
    const period: readonly [number, number] = [5, 5];
    const points = [[0.17, 0.83], [-2.4, 7.1], [4.999, -0.001]] as const;
    for (const point of points) {
      const value = periodicFbm2Ref(point, period);
      expect(periodicFbm2Ref([point[0] + 5, point[1]], period)).toBeCloseTo(value, 10);
      expect(periodicFbm2Ref([point[0], point[1] - 5], period)).toBeCloseTo(value, 10);
    }
  });

  it("repeats values and finite-difference gradients across positive and negative tiles", () => {
    const period: readonly [number, number] = [48, 48];
    const epsilon = 1 / 1024;
    const points = [[0.125, 0.875], [-3.75, 11.125], [47.999, -0.001]] as const;
    const derivative = (p: readonly [number, number], axis: 0 | 1) => {
      const before: [number, number] = [...p];
      const after: [number, number] = [...p];
      before[axis] -= epsilon;
      after[axis] += epsilon;
      return (periodicTurbulence2Ref(after, period) - periodicTurbulence2Ref(before, period)) / (2 * epsilon);
    };

    for (const point of points) {
      for (const translated of [
        [point[0] + period[0], point[1]],
        [point[0], point[1] - period[1]],
      ] as const) {
        expect(periodicPerlin2Ref(translated, period)).toBeCloseTo(periodicPerlin2Ref(point, period), 10);
        expect(periodicTurbulence2Ref(translated, period)).toBeCloseTo(periodicTurbulence2Ref(point, period), 10);
        expect(derivative(translated, 0)).toBeCloseTo(derivative(point, 0), 8);
        expect(derivative(translated, 1)).toBeCloseTo(derivative(point, 1), 8);
      }
    }
  });

  it("keeps value variance and bump RMS within 5% of the former live field", () => {
    const resolution = 256;
    const tileEpsilon = 1 / 1024;
    let grainSum = 0;
    let grainSquaredSum = 0;
    let streakSum = 0;
    let streakSquaredSum = 0;
    let gradientSquaredSum = 0;

    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const objectX = ((x + 0.5) / resolution - 0.5) * 4.8;
        const objectY = (0.5 - (y + 0.5) / resolution) * 4.8;
        const grainUv: [number, number] = [
          objectX * (19 / 48) + 0.37,
          objectY * (19 / 48) + 0.79,
        ];
        const grainAt = (u: number, v: number) =>
          periodicTurbulence2Ref([u * 48, v * 48], [48, 48]);
        const rawGrain = grainAt(grainUv[0], grainUv[1]);
        const grain = Math.min(1, Math.max(0, rawGrain * 0.8827 - 0.0093));
        const derivativeU = (
          grainAt(grainUv[0] + tileEpsilon, grainUv[1]) -
          grainAt(grainUv[0] - tileEpsilon, grainUv[1])
        ) / (2 * tileEpsilon);
        const derivativeV = (
          grainAt(grainUv[0], grainUv[1] + tileEpsilon) -
          grainAt(grainUv[0], grainUv[1] - tileEpsilon)
        ) / (2 * tileEpsilon);
        const objectGradientScale = 19 / 48;

        const streakUv: [number, number] = [
          objectX * (24 / 64) + 4 / 64 + 0.37,
          objectY * (7 / 64) + 8 / 64 + 0.79,
        ];
        const rawStreak = periodicPerlin2Ref(
          [streakUv[0] * 64, streakUv[1] * 64],
          [64, 64],
        ) * 0.5 + 0.5;
        const streak = Math.min(1, Math.max(0, (rawStreak - 0.5) * 0.83 + 0.5));

        grainSum += grain;
        grainSquaredSum += grain * grain;
        streakSum += streak;
        streakSquaredSum += streak * streak;
        gradientSquaredSum += (
          derivativeU * derivativeU + derivativeV * derivativeV
        ) * objectGradientScale * objectGradientScale;
      }
    }

    const sampleCount = resolution * resolution;
    const grainMean = grainSum / sampleCount;
    const grainVariance = grainSquaredSum / sampleCount - grainMean * grainMean;
    const streakMean = streakSum / sampleCount;
    const streakVariance = streakSquaredSum / sampleCount - streakMean * streakMean;
    const bumpRms = Math.sqrt(gradientSquaredSum / sampleCount);
    const relativeError = (actual: number, expected: number) =>
      Math.abs(actual - expected) / expected;

    // Reference moments are a fixed 512^2 sample of the removed 3D live
    // microDetail field over the same object-space domain.
    expect(relativeError(grainMean, 0.211628)).toBeLessThanOrEqual(0.05);
    expect(relativeError(grainVariance, 0.093244 ** 2)).toBeLessThanOrEqual(0.05);
    expect(relativeError(streakMean, 0.499660)).toBeLessThanOrEqual(0.05);
    expect(relativeError(streakVariance, 0.127524 ** 2)).toBeLessThanOrEqual(0.05);
    expect(relativeError(bumpRms, Math.hypot(17.9397, 7.7645))).toBeLessThanOrEqual(0.05);
  });
});
