// Offscreen verification harness: renders a material into a RenderTarget
// with a stubbed canvas context, so it runs in headless chromium where
// WebGPU canvas presentation is unavailable.
//
// Query params: ?material=lava|marble  &mesh=knot|sphere|plane
//               &t=<seconds, fixed frame time>  &size=<pixels>
import * as THREE from "three/webgpu";
import { float } from "three/tsl";
import { createMarbleMaterial } from "./marble-material.ts";
import { createLavaMaterial } from "./lava-material.ts";
import { applyNightEnvironment } from "./environment.ts";

declare global {
  interface Window { __result?: unknown }
}

function buildMesh(kind: string, material: THREE.Material): THREE.Mesh {
  if (kind === "sphere") return new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 96), material);
  if (kind === "plane") {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4, 256, 256), material);
    plane.rotation.x = -1.05;
    return plane;
  }
  return new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.38, 256, 48), material);
}

async function run(): Promise<unknown> {
  const params = new URLSearchParams(location.search);
  const materialName = params.get("material") ?? "lava";
  const meshKind = params.get("mesh") ?? "knot";
  const frameTime = Number(params.get("t") ?? "0");
  const size = Number(params.get("size") ?? "256");
  const glowOverride = params.get("glow");
  const lightScale = Number(params.get("light") ?? "1");

  const fakeContext = {
    configure() {},
    unconfigure() {},
    getCurrentTexture(): never { throw new Error("harness renders offscreen only"); },
  };
  const renderer = new THREE.WebGPURenderer({ context: fakeContext as unknown as GPUCanvasContext });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07080a);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  camera.position.set(0, 1.2, 4.2);
  camera.lookAt(0, 0, 0);

  if (materialName === "lava") {
    // HDRI ambient plus a moonlight key; the warm floor bounce fakes the
    // glow lighting the crust back.
    await applyNightEnvironment(scene);
    const key = new THREE.DirectionalLight(0xcfd8e6, 3.4 * lightScale);
    key.position.set(3, 2.2, 2);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x1a2030, 0xb33a10, 0.35));
  } else {
    const key = new THREE.DirectionalLight(0xffffff, 2.4 * lightScale);
    key.position.set(3, 4, 2);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x8fb4dd, 0x40342a, 0.8));
  }

  let material: THREE.Material;
  if (materialName === "marble") {
    material = createMarbleMaterial().material;
  } else {
    const lava = createLavaMaterial({ timeNode: float(frameTime) });
    if (glowOverride !== null) lava.glowIntensity.value = Number(glowOverride);
    material = lava.material;
  }
  scene.add(buildMesh(meshKind, material));

  const target = new THREE.RenderTarget(size, size, { samples: 4 });
  renderer.setRenderTarget(target);
  await renderer.renderAsync(scene, camera);
  const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size)) as Uint8Array;

  let lit = 0;
  const distinct = new Set<string>();
  // Average color of dim (crust) pixels in the center band, for tuning.
  let crustSum = [0, 0, 0];
  let crustCount = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    distinct.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    const delta = Math.abs(pixels[i]! - 11) + Math.abs(pixels[i + 1]! - 13) + Math.abs(pixels[i + 2]! - 16);
    if (delta > 60) lit++;
    const y = Math.floor(i / 4 / size);
    if (delta <= 60 && delta > 8 && y > size * 0.3 && y < size * 0.8) {
      crustSum = [crustSum[0]! + pixels[i]!, crustSum[1]! + pixels[i + 1]!, crustSum[2]! + pixels[i + 2]!];
      crustCount++;
    }
  }
  const crust = crustCount ? crustSum.map((v) => Math.round(v / crustCount)) : null;

  // Blit the readback into a plain 2D canvas so the result is visible (and
  // screenshotable) even where WebGPU canvas presentation is unavailable.
  const view = document.createElement("canvas");
  view.width = size;
  view.height = size;
  view.style.width = "512px";
  view.style.imageRendering = "pixelated";
  const context2d = view.getContext("2d")!;
  const image = context2d.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    // readRenderTargetPixelsAsync returns rows bottom-up; 2D canvas is top-down.
    const src = (size - 1 - y) * size * 4;
    image.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
  }
  context2d.putImageData(image, 0, 0);
  document.body.append(view);

  return { material: materialName, mesh: meshKind, total: pixels.length / 4, lit, distinct: distinct.size, crust };
}

run().then(
  (result) => { window.__result = result; },
  (error) => { window.__result = { error: String(error && (error as Error).message) }; },
);
