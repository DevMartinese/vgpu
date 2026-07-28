#!/usr/bin/env node
// Headless debug harness for the hero black hole.
//
// Runs the real pipeline (bake -> shade -> composite) on the Node/Dawn adapter,
// with no browser, and writes PNGs for the final frame plus every G-buffer debug
// view. Use it to iterate on disk.wgsl / stars.wgsl and to prove what the bake
// actually produced.
//
//   node apps/docs/components/hero/debug-render.mjs
//   node apps/docs/components/hero/debug-render.mjs --size 960x540 --time 4
//   node apps/docs/components/hero/debug-render.mjs --views final,flags
//   node apps/docs/components/hero/debug-render.mjs --disk.stretch 3 --disk.detail 1.6
//   node apps/docs/components/hero/debug-render.mjs --set '{"disk":{"brightness":2}}'
//   node apps/docs/components/hero/debug-render.mjs --views final --diskLayers 1 --out /tmp/before
//
// Flags:
//   --out <dir>          output directory (default /home/user/reports/hero-debug)
//   --size <WxH>         render size in pixels (default 1280x720)
//   --time <seconds>     animation clock handed to the shaders (default 2.5)
//   --views <list>       comma list of: final,normals,diskuv,flags,raydir,density,skylod,hit2,all
//   --<key> <value>      any geometry setting: cameraY, distance, diskRadius, fov, centerY
//   --diskLayers <1|2>   1 = front disk hit only, 2 = also the hidden second hit (A/B)
//   --disk.<key> <v>     any DiskLook field (brightness, speed, stretch, detail, ...)
//   --stars.<key> <v>    any StarLook field (brightness, density, twinkle, ...)
//   --set <json>         deep-merged JSON settings patch (wins over flags)
//   --json               print the resolved settings and per-image stats as JSON
//
// The WGSL import graph (shade.wgsl -> gbuffer/disk/stars) is resolved with
// `resolveShader`, the same resolver the webpack/turbopack loader uses in the app.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';
import { resolveShader } from '@vgpu/wgsl/runtime';
import { init } from 'vgpu/node';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Keep in sync with `defaultHeroSettings()` in renderer.ts. */
const DEFAULT_SETTINGS = {
  cameraY: 0.135,
  distance: 16.5,
  diskRadius: 15.5,
  fov: 2.65,
  centerY: 0,
  debugView: 0,
  diskLayers: 2,
  disk: {
    brightness: 0.05,
    speed: 0.26,
    stretch: 4.5,
    detail: 3,
    turbulence: 3,
    density: 1,
    doppler: 1,
    spare0: -0.04,
    spare1: -0.77,
    spare2: -0.15,
    spare3: -0.51,
  },
  stars: {
    brightness: 0.79,
    brightnessMin: 0.05,
    brightnessMax: 1.1,
    density: 2.92,
    twinkle: 0,
  },
};

/** debugView value -> file name. `final` is debugView 0. */
const VIEWS = {
  final: 0,
  normals: 1,
  diskuv: 2,
  flags: 3,
  raydir: 4,
  density: 5,
  skylod: 6,
  hit2: 7,
};

/** hit1, hit2, sky, view. Must match GBUFFER_FORMATS in renderer.ts. */
const GBUFFER_FORMATS = ['rg32float', 'rg32float', 'rgba16float', 'rgba16float'];

function parseArgs(argv) {
  const options = { views: ['all'], size: [1280, 720], time: 2.5, out: '/home/user/reports/hero-debug', json: false };
  const patch = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    const key = (eq === -1 ? token.slice(2) : token.slice(2, eq)).trim();
    const readValue = () => (eq === -1 ? argv[++i] : token.slice(eq + 1));
    if (key === 'json') { options.json = true; continue; }
    const value = readValue();
    if (value === undefined) throw new Error(`missing value for --${key}`);
    if (key === 'out') { options.out = value; continue; }
    if (key === 'size') {
      const [w, h] = value.split(/[x,]/).map(Number);
      options.size = [Math.max(1, w | 0), Math.max(1, h | 0)];
      continue;
    }
    if (key === 'time') { options.time = Number(value); continue; }
    if (key === 'views') { options.views = value.split(',').map((v) => v.trim()).filter(Boolean); continue; }
    if (key === 'set') { deepMerge(patch, JSON.parse(value)); continue; }
    setPath(patch, key.split('.'), Number(value));
  }
  return { options, patch };
}

function setPath(target, path, value) {
  let cursor = target;
  for (let i = 0; i < path.length - 1; i++) {
    cursor[path[i]] ??= {};
    cursor = cursor[path[i]];
  }
  cursor[path[path.length - 1]] = value;
}

function deepMerge(base, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      base[key] = deepMerge({ ...(base[key] ?? {}) }, value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

async function loadShader(name) {
  const resolved = await resolveShader({ entry: resolve(HERE, name), rootDir: HERE, validate: false });
  return resolved.wgsl;
}

function writePng(path, width, height, rgba) {
  const png = new PNG({ width, height });
  rgba.forEach((byte, index) => { png.data[index] = byte; });
  return new Promise((done, fail) => {
    const chunks = [];
    png.pack()
      .on('data', (chunk) => chunks.push(chunk))
      .on('error', fail)
      .on('end', () => { writeFile(path, Buffer.concat(chunks)).then(done, fail); });
  });
}

function stats(rgba) {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const luma = (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
    sum += luma;
    sumSquares += luma * luma;
    count++;
  }
  const mean = sum / Math.max(count, 1);
  return { mean: Number(mean.toFixed(4)), std: Number(Math.sqrt(Math.max(sumSquares / Math.max(count, 1) - mean * mean, 0)).toFixed(4)) };
}

async function main() {
  const { options, patch } = parseArgs(process.argv.slice(2));
  const settings = deepMerge(structuredClone(DEFAULT_SETTINGS), patch);
  const names = options.views.includes('all') ? Object.keys(VIEWS) : options.views;
  for (const name of names) {
    if (!(name in VIEWS)) throw new Error(`unknown view "${name}"; expected ${Object.keys(VIEWS).join(', ')} or all`);
  }

  const [bakeWgsl, shadeWgsl, compositeWgsl] = await Promise.all([
    loadShader('bake.wgsl'),
    loadShader('shade.wgsl'),
    loadShader('composite.wgsl'),
  ]);

  await mkdir(options.out, { recursive: true });
  const gpu = await init();
  const [width, height] = options.size;

  const gbuffer = gpu.target({
    size: [width, height],
    colors: GBUFFER_FORMATS.map((format) => ({ format })),
    label: 'hero-debug-gbuffer',
  });
  const scene = gpu.target({ size: [width, height], format: 'rgba16float', label: 'hero-debug-scene' });
  const output = gpu.target({ size: [width, height], format: 'rgba8unorm', label: 'hero-debug-output' });

  const bake = gpu.effect(bakeWgsl, { label: 'hero-debug-bake' });
  const shade = gpu.effect(shadeWgsl, { label: 'hero-debug-shade' });
  const composite = gpu.effect(compositeWgsl, { label: 'hero-debug-composite' });
  const sampler = gpu.sampler({ minFilter: 'linear', magFilter: 'linear' });

  const [hit1Texture, hit2Texture, skyTexture, viewTexture] = gbuffer.colors;
  bake.set({ bake: {
    resolution: gbuffer.size,
    yaw: 0,
    pitch: settings.cameraY,
    orbitRadius: settings.distance,
    diskOuter: settings.diskRadius,
    fov: settings.fov,
    centerY: settings.centerY,
  } });
  shade.set({
    gHit1: hit1Texture,
    gHit2: hit2Texture,
    gSky: skyTexture,
    gView: viewTexture,
    disk: settings.disk,
    stars: settings.stars,
  });
  composite.set({ scene, samp: sampler, composite: { exposure: 1.15, debug: 0 } });

  // One bake for every view: that is the whole point of the split.
  gpu.frame((frame) => {
    frame.pass({ target: gbuffer, clear: [0, 0, 0, 1] }, (pass) => pass.draw(bake));
  });

  const results = [];
  for (const name of names) {
    const debugView = VIEWS[name];
    shade.set({ shade: {
      resolution: scene.size,
      time: options.time,
      diskOuter: settings.diskRadius,
      debugView,
      diskLayers: settings.diskLayers,
    } });
    composite.set({ composite: { exposure: 1.15, debug: debugView > 0 ? 1 : 0 } });
    gpu.frame((frame) => {
      frame.pass({ target: scene, clear: [0, 0, 0, 1] }, (pass) => pass.draw(shade));
      frame.pass({ target: output, clear: [0, 0, 0, 1] }, (pass) => pass.draw(composite));
    });
    const pixels = await output.read();
    const path = join(options.out, `${name}.png`);
    await writePng(path, width, height, pixels);
    results.push({ view: name, debugView, path, ...stats(pixels) });
  }

  gpu.dispose();

  if (options.json) {
    console.log(JSON.stringify({ size: options.size, time: options.time, settings, images: results }, null, 2));
    return;
  }
  console.log(`hero debug render ${width}x${height} @ t=${options.time}s -> ${options.out}`);
  for (const result of results) {
    console.log(`  ${result.view.padEnd(8)} debugView=${result.debugView}  mean=${result.mean}  std=${result.std}  ${result.path}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
