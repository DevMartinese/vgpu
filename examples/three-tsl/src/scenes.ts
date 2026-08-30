import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { createMarbleMaterial } from "./marble-material.ts";
import { createLavaMaterial } from "./lava-material.ts";
import { applyNightEnvironment } from "./environment.ts";

export type DemoMaterialName = "lava" | "marble";
export type DemoMeshKind = "knot" | "sphere" | "plane";

export interface DemoSceneOptions {
  readonly mesh?: DemoMeshKind;
  /** Fixed frame time for deterministic stills; defaults to the live clock. */
  readonly timeNode?: Node;
  /** Debug multiplier for the key light. */
  readonly lightScale?: number;
  /** Debug override for the lava glow intensity. */
  readonly glowIntensity?: number;
}

export interface DemoScene {
  readonly scene: THREE.Scene;
  readonly mesh: THREE.Mesh;
  /** The lava scene expects the bloom post chain and ACES tone mapping. */
  readonly usesBloom: boolean;
}

export function buildDemoMesh(kind: DemoMeshKind, material: THREE.Material): THREE.Mesh {
  if (kind === "sphere") return new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 96), material);
  if (kind === "plane") {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4, 256, 256), material);
    plane.rotation.x = -1.05;
    return plane;
  }
  return new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.38, 400, 64), material);
}

/** The demo camera: slightly above, looking at the origin. */
export function createDemoCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 50);
  camera.position.set(0, 1.2, 4.2);
  camera.lookAt(0, 0, 0);
  return camera;
}

/** Scene, lights, environment, and mesh for one demo material. */
export async function createDemoScene(
  materialName: DemoMaterialName,
  options: DemoSceneOptions = {},
): Promise<DemoScene> {
  const lightScale = options.lightScale ?? 1;
  const scene = new THREE.Scene();

  let material: THREE.Material;
  if (materialName === "marble") {
    scene.background = new THREE.Color(0x0b0d10);
    const key = new THREE.DirectionalLight(0xffffff, 2.4 * lightScale);
    key.position.set(3, 4, 2);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x8fb4dd, 0x40342a, 0.8));
    material = createMarbleMaterial().material;
  } else {
    // HDRI ambient (backdrop stays black) plus a moonlight key; the warm
    // floor bounce fakes the glow lighting the crust back.
    await applyNightEnvironment(scene);
    const key = new THREE.DirectionalLight(0xcfd8e6, 2.2 * lightScale);
    key.position.set(3, 2.2, 2);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0x1a2030, 0xb33a10, 0.22));
    const lava = createLavaMaterial({ timeNode: options.timeNode });
    if (options.glowIntensity !== undefined) lava.glowIntensity.value = options.glowIntensity;
    material = lava.material;
  }

  const mesh = buildDemoMesh(options.mesh ?? "knot", material);
  scene.add(mesh);
  return { scene, mesh, usesBloom: materialName === "lava" };
}
