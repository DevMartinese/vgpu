import * as THREE from "three/webgpu";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
// CC0 Poly Haven HDRI packaged as a data URI by @pmndrs/assets.
import nightHdri from "@pmndrs/assets/hdri/night.exr.js";

/**
 * Night-sky image-based lighting for the lava scene. The HDRI only drives
 * ambient light and reflections — the backdrop stays pure black.
 */
export async function applyNightEnvironment(scene: THREE.Scene): Promise<void> {
  const texture = await new EXRLoader().loadAsync(nightHdri);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = texture;
  scene.environmentIntensity = 0.4;
  scene.background = new THREE.Color(0x000000);
}
