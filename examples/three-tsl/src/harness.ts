// Offscreen verification harness: renders the marble material into a
// RenderTarget with a stubbed canvas context, so it runs in headless
// chromium where WebGPU canvas presentation is unavailable.
import * as THREE from "three/webgpu";
import { createMarbleMaterial } from "./marble-material.ts";

declare global {
  interface Window { __result?: unknown }
}

async function run(): Promise<unknown> {
  const fakeContext = {
    configure() {},
    unconfigure() {},
    getCurrentTexture(): never { throw new Error("harness renders offscreen only"); },
  };
  const renderer = new THREE.WebGPURenderer({ context: fakeContext as unknown as GPUCanvasContext });
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d10);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
  camera.position.set(0, 1.2, 4.2);
  camera.lookAt(0, 0, 0);

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 4, 2);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0x8fb4dd, 0x40342a, 0.8));

  const { material } = createMarbleMaterial();
  scene.add(new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.38, 128, 24), material));

  const size = 128;
  const target = new THREE.RenderTarget(size, size);
  renderer.setRenderTarget(target);
  await renderer.renderAsync(scene, camera);
  const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size)) as Uint8Array;

  let lit = 0;
  const distinct = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4) {
    distinct.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    if (Math.abs(pixels[i]! - 11) + Math.abs(pixels[i + 1]! - 13) + Math.abs(pixels[i + 2]! - 16) > 60) lit++;
  }

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

  return { total: pixels.length / 4, lit, distinct: distinct.size };
}

run().then(
  (result) => { window.__result = result; },
  (error) => { window.__result = { error: String(error && (error as Error).message) }; },
);
