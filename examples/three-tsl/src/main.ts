import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createMarbleMaterial } from "./marble-material.ts";

async function main(): Promise<void> {
  if (navigator.gpu === undefined) {
    document.querySelector("#overlay")!.textContent = "WebGPU is not available in this browser.";
    return;
  }

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.querySelector("#app")!.append(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d10);
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
  camera.position.set(0, 1.2, 4.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 4, 2);
  scene.add(key);
  const fill = new THREE.HemisphereLight(0x8fb4dd, 0x40342a, 0.8);
  scene.add(fill);

  const { material } = createMarbleMaterial();
  const mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.38, 256, 48), material);
  scene.add(mesh);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    mesh.rotation.y += 0.002;
    controls.update();
    renderer.render(scene, camera);
  });
}

void main();
