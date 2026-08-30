import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createDemoCamera, createDemoScene, type DemoMaterialName } from "./scenes.ts";
import { createBloomPipeline } from "./post.ts";

async function main(): Promise<void> {
  if (navigator.gpu === undefined) {
    document.querySelector("#overlay")!.textContent = "WebGPU is not available in this browser.";
    return;
  }

  const materialName = (new URLSearchParams(location.search).get("material") ?? "lava") as DemoMaterialName;

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (materialName === "lava") renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.querySelector("#app")!.append(renderer.domElement);
  await renderer.init();

  const { scene, mesh, usesBloom } = await createDemoScene(materialName);
  const camera = createDemoCamera(window.innerWidth / window.innerHeight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const postProcessing = usesBloom ? createBloomPipeline(renderer, scene, camera) : null;

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
