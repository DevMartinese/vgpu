import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createMarbleMaterial } from "./marble-material.ts";
import { createLavaMaterial } from "./lava-material.ts";
import { applyNightEnvironment } from "./environment.ts";
import { createBloomPipeline } from "./post.ts";

async function main(): Promise<void> {
  if (navigator.gpu === undefined) {
    document.querySelector("#overlay")!.textContent = "WebGPU is not available in this browser.";
    return;
  }

  const materialName = new URLSearchParams(location.search).get("material") ?? "lava";

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (materialName === "lava") renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.querySelector("#app")!.append(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(materialName === "lava" ? 0x07080a : 0x0b0d10);
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
  camera.position.set(0, 1.2, 4.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  if (materialName === "lava") {
    // HDRI ambient plus a cool moonlight key; the warm floor bounce stands
    // in for the glow lighting the crust back.
    await applyNightEnvironment(scene);
    const key = new THREE.DirectionalLight(0xcfd8e6, 3.4);
    key.position.set(3, 2.2, 2);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x1a2030, 0xb33a10, 0.35));
  } else {
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 4, 2);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x8fb4dd, 0x40342a, 0.8));
  }

  const { material } = materialName === "lava" ? createLavaMaterial() : createMarbleMaterial();
  const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.38, 400, 64), material);
  scene.add(mesh);

  const postProcessing = materialName === "lava" ? createBloomPipeline(renderer, scene, camera) : null;

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    mesh.rotation.y += 0.0012;
    controls.update();
    if (postProcessing) postProcessing.render();
    else renderer.render(scene, camera);
  });
}

void main();
