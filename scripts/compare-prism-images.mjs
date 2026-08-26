#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const [baselinePath, candidatePath, diffPath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) {
  console.error(
    "usage: node scripts/compare-prism-images.mjs baseline.png candidate.png [diff.png]"
  );
  process.exit(2);
}

const [baseline, candidate] = await Promise.all([
  readPng(baselinePath),
  readPng(candidatePath),
]);
if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
  throw new Error(
    `image dimensions differ: ${baseline.width}x${baseline.height} vs ${candidate.width}x${candidate.height}`
  );
}

const diff = new PNG({ width: baseline.width, height: baseline.height });
const mismatched = pixelmatch(
  baseline.data,
  candidate.data,
  diff.data,
  baseline.width,
  baseline.height,
  { threshold: 0.1, includeAA: true }
);
const pixels = baseline.width * baseline.height;
const report = {
  width: baseline.width,
  height: baseline.height,
  mismatchedPixels: mismatched,
  mismatchRatio: mismatched / pixels,
  rgbRmse: rgbRmse(baseline.data, candidate.data),
  tiledSsim: tiledSsim(
    baseline.data,
    candidate.data,
    baseline.width,
    baseline.height
  ),
};

if (diffPath) await writeFile(diffPath, PNG.sync.write(diff));
console.log(JSON.stringify(report, null, 2));

function readPng(path) {
  return readFile(path).then((bytes) => PNG.sync.read(bytes));
}

function rgbRmse(a, b) {
  let sum = 0;
  for (let pixel = 0; pixel < a.length; pixel += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const delta = (a[pixel + channel] - b[pixel + channel]) / 255;
      sum += delta * delta;
    }
  }
  return Math.sqrt(sum / ((a.length / 4) * 3));
}

function tiledSsim(a, b, width, height, tileSize = 8) {
  let score = 0;
  let tiles = 0;
  for (let top = 0; top < height; top += tileSize) {
    for (let left = 0; left < width; left += tileSize) {
      score += tileSsim(a, b, width, height, left, top, tileSize);
      tiles++;
    }
  }
  return score / Math.max(tiles, 1);
}

function tileSsim(a, b, width, height, left, top, size) {
  let meanA = 0;
  let meanB = 0;
  let count = 0;
  const values = [];
  for (let y = top; y < Math.min(top + size, height); y++) {
    for (let x = left; x < Math.min(left + size, width); x++) {
      const index = (y * width + x) * 4;
      const valueA = luminance(a, index);
      const valueB = luminance(b, index);
      values.push([valueA, valueB]);
      meanA += valueA;
      meanB += valueB;
      count++;
    }
  }
  meanA /= count;
  meanB /= count;
  let varianceA = 0;
  let varianceB = 0;
  let covariance = 0;
  for (const [valueA, valueB] of values) {
    const deltaA = valueA - meanA;
    const deltaB = valueB - meanB;
    varianceA += deltaA * deltaA;
    varianceB += deltaB * deltaB;
    covariance += deltaA * deltaB;
  }
  const divisor = Math.max(count - 1, 1);
  varianceA /= divisor;
  varianceB /= divisor;
  covariance /= divisor;
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  return (
    ((2 * meanA * meanB + c1) * (2 * covariance + c2)) /
    ((meanA * meanA + meanB * meanB + c1) *
      (varianceA + varianceB + c2))
  );
}

function luminance(data, index) {
  return (
    0.2126 * data[index] +
    0.7152 * data[index + 1] +
    0.0722 * data[index + 2]
  ) / 255;
}
