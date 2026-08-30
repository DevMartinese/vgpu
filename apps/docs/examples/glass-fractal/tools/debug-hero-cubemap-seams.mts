#!/usr/bin/env -S node --experimental-strip-types

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

type Face = {
  readonly size: number;
  readonly pixels: Float32Array;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ATLAS_PATH = resolve(
  HERE,
  "../../../public/examples/glass-fractal/studio-cubemap.png"
);
const FACE_NAMES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"] as const;
const atlas = PNG.sync.read(await readFile(ATLAS_PATH));
if (atlas.width % 3 !== 0 || atlas.height % 2 !== 0) {
  throw new Error("Studio cubemap must be a 3x2 atlas.");
}
const faceSize = atlas.width / 3;
if (faceSize !== atlas.height / 2) {
  throw new Error("Studio cubemap faces must be square.");
}

const baseFaces = extractFaces(atlas, faceSize);
const isolatedLevels: Face[][] = [baseFaces];
const sphericalLevels: Face[][] = [baseFaces];
while (isolatedLevels.at(-1)![0].size > 1) {
  isolatedLevels.push(isolatedLevels.at(-1)!.map(downsampleFace));
  sphericalLevels.push(downsampleCubemap(sphericalLevels.at(-1)!));
}

console.log("Hero cubemap seam diagnostic");
console.log(
  "difference is normalized linear RGB distance across each cube edge"
);
printReport("isolated per-face mip chain (current runtime)", isolatedLevels);
printReport("spherical cross-face mip chain", sphericalLevels);
const writeIndex = process.argv.indexOf("--write");
if (writeIndex >= 0) {
  const outputPath = resolve(
    process.argv[writeIndex + 1] ??
      resolve(
        HERE,
        "../../../public/examples/glass-fractal/studio-cubemap-prefiltered.png"
      )
  );
  await writePackedMipAtlas(outputPath, sphericalLevels);
  console.log(`\nwrote ${outputPath}`);
}

function printReport(label: string, levels: readonly Face[][]) {
  console.log(`\n${label}`);
  console.log("level size mean p95 max worst-edge");
  for (let level = 0; level < levels.length; level++) {
    const report = measureSeams(levels[level]);
    console.log(
      [
        level.toString().padStart(2),
        levels[level][0].size.toString().padStart(4),
        report.mean.toFixed(4),
        report.p95.toFixed(4),
        report.max.toFixed(4),
        report.worstEdge,
      ].join("  ")
    );
  }
}

function extractFaces(png: PNG, size: number): Face[] {
  return Array.from({ length: 6 }, (_, face) => {
    const pixels = new Float32Array(size * size * 3);
    const offsetX = (face % 3) * size;
    const offsetY = Math.floor(face / 3) * size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const source = ((offsetY + y) * png.width + offsetX + x) * 4;
        const target = (y * size + x) * 3;
        for (let channel = 0; channel < 3; channel++) {
          pixels[target + channel] = srgbToLinear(
            png.data[source + channel] / 255
          );
        }
      }
    }
    return { size, pixels };
  });
}

function downsampleFace(source: Face): Face {
  const size = Math.max(1, source.size >> 1);
  const pixels = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const target = (y * size + x) * 3;
      for (let offsetY = 0; offsetY < 2; offsetY++) {
        for (let offsetX = 0; offsetX < 2; offsetX++) {
          const sourceX = Math.min(source.size - 1, x * 2 + offsetX);
          const sourceY = Math.min(source.size - 1, y * 2 + offsetY);
          const sample = (sourceY * source.size + sourceX) * 3;
          for (let channel = 0; channel < 3; channel++) {
            pixels[target + channel] += source.pixels[sample + channel] * 0.25;
          }
        }
      }
    }
  }
  return { size, pixels };
}

function downsampleCubemap(source: readonly Face[]): Face[] {
  const sourceSize = source[0].size;
  const size = Math.max(1, sourceSize >> 1);
  if (size === 1) {
    const average = [0, 0, 0];
    let samples = 0;
    for (const face of source) {
      for (let offset = 0; offset < face.pixels.length; offset += 3) {
        average[0] += face.pixels[offset];
        average[1] += face.pixels[offset + 1];
        average[2] += face.pixels[offset + 2];
        samples++;
      }
    }
    const pixel = new Float32Array(3);
    for (let channel = 0; channel < 3; channel++) {
      pixel[channel] = average[channel] / samples;
    }
    return Array.from({ length: 6 }, () => ({
      size,
      pixels: pixel.slice(),
    }));
  }
  const radius = 2 / sourceSize;
  return Array.from({ length: 6 }, (_, face) => {
    const pixels = new Float32Array(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const uv: [number, number] =
          size === 1
            ? [0, 0]
            : [(x / (size - 1)) * 2 - 1, (y / (size - 1)) * 2 - 1];
        const direction = faceDirection(face, uv);
        const reference = Math.abs(direction[1]) < 0.98 ? [0, 1, 0] : [1, 0, 0];
        const tangent = normalize3(cross3(reference, direction));
        const bitangent = cross3(direction, tangent);
        const samples = [
          offsetDirection(direction, tangent, bitangent, radius, radius),
          offsetDirection(direction, tangent, bitangent, -radius, radius),
          offsetDirection(direction, tangent, bitangent, radius, -radius),
          offsetDirection(direction, tangent, bitangent, -radius, -radius),
        ];
        const target = (y * size + x) * 3;
        for (const sampleDirection of samples) {
          const color = sampleCubemap(source, sampleDirection);
          for (let channel = 0; channel < 3; channel++) {
            pixels[target + channel] += color[channel] / samples.length;
          }
        }
      }
    }
    return { size, pixels };
  });
}

async function writePackedMipAtlas(path: string, levels: readonly Face[][]) {
  const width = levels.reduce((sum, faces) => sum + faces[0].size * 3, 0);
  const height = levels[0][0].size * 2;
  const output = new PNG({ width, height });
  for (let offset = 3; offset < output.data.length; offset += 4) {
    output.data[offset] = 255;
  }
  let levelOffsetX = 0;
  for (const faces of levels) {
    const size = faces[0].size;
    for (let face = 0; face < faces.length; face++) {
      const offsetX = levelOffsetX + (face % 3) * size;
      const offsetY = Math.floor(face / 3) * size;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const source = (y * size + x) * 3;
          const target = ((offsetY + y) * width + offsetX + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            output.data[target + channel] = Math.round(
              linearToSrgb(faces[face].pixels[source + channel]) * 255
            );
          }
        }
      }
    }
    levelOffsetX += size * 3;
  }
  await writeFile(path, PNG.sync.write(output));
}

function sampleCubemap(faces: readonly Face[], direction: readonly number[]) {
  const sampleLookup = lookup(direction);
  return sampleFace(faces[sampleLookup.face], sampleLookup.uv);
}

function faceDirection(face: number, uv: readonly number[]) {
  switch (face) {
    case 0:
      return normalize3([1, -uv[1], -uv[0]]);
    case 1:
      return normalize3([-1, -uv[1], uv[0]]);
    case 2:
      return normalize3([uv[0], 1, uv[1]]);
    case 3:
      return normalize3([uv[0], -1, -uv[1]]);
    case 4:
      return normalize3([uv[0], -uv[1], 1]);
    default:
      return normalize3([-uv[0], -uv[1], -1]);
  }
}

function offsetDirection(
  direction: readonly number[],
  tangent: readonly number[],
  bitangent: readonly number[],
  offsetX: number,
  offsetY: number
) {
  return normalize3([
    direction[0] + tangent[0] * offsetX + bitangent[0] * offsetY,
    direction[1] + tangent[1] * offsetX + bitangent[1] * offsetY,
    direction[2] + tangent[2] * offsetX + bitangent[2] * offsetY,
  ]);
}

function normalize3(value: readonly number[]) {
  const length = Math.hypot(...value) || 1;
  return value.map((component) => component / length);
}

function cross3(a: readonly number[], b: readonly number[]) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function measureSeams(faces: readonly Face[]) {
  const differences: number[] = [];
  const edgeDifferences = new Map<string, number[]>();
  const axisPairs = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 2, 0],
  ] as const;
  const epsilon = 1e-5;
  for (const [axisA, axisB, remainingAxis] of axisPairs) {
    for (const signA of [-1, 1]) {
      for (const signB of [-1, 1]) {
        for (let sampleIndex = 0; sampleIndex < 63; sampleIndex++) {
          const alongEdge = -0.94 + (sampleIndex / 62) * 1.88;
          const sideA = [0, 0, 0];
          const sideB = [0, 0, 0];
          sideA[axisA] = signA * (1 + epsilon);
          sideA[axisB] = signB * (1 - epsilon);
          sideA[remainingAxis] = alongEdge;
          sideB[axisA] = signA * (1 - epsilon);
          sideB[axisB] = signB * (1 + epsilon);
          sideB[remainingAxis] = alongEdge;
          const lookupA = lookup(sideA);
          const lookupB = lookup(sideB);
          if (lookupA.face === lookupB.face) continue;
          const colorA = sampleFace(faces[lookupA.face], lookupA.uv);
          const colorB = sampleFace(faces[lookupB.face], lookupB.uv);
          const difference = Math.hypot(
            colorA[0] - colorB[0],
            colorA[1] - colorB[1],
            colorA[2] - colorB[2]
          );
          differences.push(difference);
          const edge = [FACE_NAMES[lookupA.face], FACE_NAMES[lookupB.face]]
            .sort()
            .join("/");
          const values = edgeDifferences.get(edge) ?? [];
          values.push(difference);
          edgeDifferences.set(edge, values);
        }
      }
    }
  }
  differences.sort((a, b) => a - b);
  const edgeMeans = [...edgeDifferences].map(([edge, values]) => [
    edge,
    average(values),
  ]) as [string, number][];
  edgeMeans.sort((a, b) => b[1] - a[1]);
  return {
    mean: average(differences),
    p95: differences[Math.floor(differences.length * 0.95)] ?? 0,
    max: differences.at(-1) ?? 0,
    worstEdge: `${edgeMeans[0]?.[0] ?? "none"} ${
      edgeMeans[0]?.[1].toFixed(4) ?? "0"
    }`,
  };
}

function lookup(directionInput: readonly number[]) {
  const length = Math.hypot(...directionInput) || 1;
  const direction = directionInput.map((value) => value / length);
  const magnitude = direction.map(Math.abs);
  let face = 0;
  let faceUv: [number, number] = [0, 0];
  if (magnitude[0] >= magnitude[1] && magnitude[0] >= magnitude[2]) {
    if (direction[0] >= 0) {
      face = 0;
      faceUv = [-direction[2] / magnitude[0], -direction[1] / magnitude[0]];
    } else {
      face = 1;
      faceUv = [direction[2] / magnitude[0], -direction[1] / magnitude[0]];
    }
  } else if (magnitude[1] >= magnitude[2]) {
    if (direction[1] >= 0) {
      face = 2;
      faceUv = [direction[0] / magnitude[1], direction[2] / magnitude[1]];
    } else {
      face = 3;
      faceUv = [direction[0] / magnitude[1], -direction[2] / magnitude[1]];
    }
  } else if (direction[2] >= 0) {
    face = 4;
    faceUv = [direction[0] / magnitude[2], -direction[1] / magnitude[2]];
  } else {
    face = 5;
    faceUv = [-direction[0] / magnitude[2], -direction[1] / magnitude[2]];
  }
  return { face, uv: faceUv.map((value) => value * 0.5 + 0.5) };
}

function sampleFace(face: Face, uv: readonly number[]) {
  const x = Math.min(face.size - 1, Math.max(0, uv[0] * face.size - 0.5));
  const y = Math.min(face.size - 1, Math.max(0, uv[1] * face.size - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(face.size - 1, x0 + 1);
  const y1 = Math.min(face.size - 1, y0 + 1);
  const blendX = x - x0;
  const blendY = y - y0;
  const result = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    const top = mix(
      read(face, x0, y0, channel),
      read(face, x1, y0, channel),
      blendX
    );
    const bottom = mix(
      read(face, x0, y1, channel),
      read(face, x1, y1, channel),
      blendX
    );
    result[channel] = mix(top, bottom, blendY);
  }
  return result;
}

function read(face: Face, x: number, y: number, channel: number) {
  return face.pixels[(y * face.size + x) * 3 + channel];
}

function mix(a: number, b: number, amount: number) {
  return a + (b - a) * amount;
}

function average(values: readonly number[]) {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  );
}

function srgbToLinear(value: number) {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number) {
  const linear = Math.max(0, Math.min(1, value));
  return linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}
