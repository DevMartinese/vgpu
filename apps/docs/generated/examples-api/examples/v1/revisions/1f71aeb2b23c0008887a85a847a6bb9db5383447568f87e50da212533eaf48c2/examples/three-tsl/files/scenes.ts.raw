import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { createLavaMaterial } from "./lava-material";
import { applyNightEnvironment } from "./environment";

export type DemoMeshKind = "knot" | "sphere" | "plane";

export interface DemoSceneOptions {
  readonly mesh?: DemoMeshKind;
  /** Fixed frame time for deterministic stills; defaults to the live clock. */
  readonly timeNode?: Node;
  /** Where to fetch the HDRI from; defaults to the public asset URL. */
  readonly hdriUrl?: string;
  /** Already-decoded HDRI, used by the offline thumbnail run. */
  readonly hdriTexture?: THREE.Texture;
}

export interface DemoScene {
  readonly scene: THREE.Scene;
  readonly mesh: THREE.Mesh;
  dispose(): void;
}

export function buildDemoMesh(
  kind: DemoMeshKind,
  material: THREE.Material
): THREE.Mesh {
  if (kind === "sphere")
    return new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 96), material);
  if (kind === "plane") {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4, 256, 256),
      material
    );
    plane.rotation.x = -1.05;
    return plane;
  }
  return new THREE.Mesh(
    new THREE.TorusKnotGeometry(1, 0.38, 400, 64),
    material
  );
}

/** The demo camera: slightly above, looking at the origin. */
export function createDemoCamera(aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 50);
  camera.position.set(0, 1.2, 4.2);
  camera.lookAt(0, 0, 0);
  return camera;
}

/** Scene, lights, environment, and mesh for the lava demo. */
export async function createDemoScene(
  options: DemoSceneOptions = {}
): Promise<DemoScene> {
  const scene = new THREE.Scene();

  // HDRI ambient (backdrop stays black) plus a soft warm-neutral key; the
  // warm floor bounce fakes the glow lighting the crust back.
  const environment = await applyNightEnvironment(
    scene,
    options.hdriTexture ?? options.hdriUrl
  );
  const key = new THREE.DirectionalLight(0xf2e4d2, 1.8);
  key.position.set(3, 2.2, 2);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0x3a3230, 0xb33a10, 0.25));

  const lava = createLavaMaterial({ timeNode: options.timeNode });
  const mesh = buildDemoMesh(options.mesh ?? "knot", lava.material);
  scene.add(mesh);

  return {
    scene,
    mesh,
    dispose() {
      mesh.geometry.dispose();
      lava.material.dispose();
      environment.dispose();
    },
  };
}
