import * as THREE from "three/webgpu";
import { float, mix, positionLocal, time, uniform, vec3 } from "three/tsl";
import marbleModule from "./marble.wgsl";
import { tslExports } from "./wgsl-tsl.ts";

// One import gives the whole flattened module graph (marble.wgsl plus its
// @vgpu/wgsl-std/hash import); tslExports turns the functions we need into
// callable TSL nodes.
const { marble, fbm3 } = tslExports(marbleModule, ["marble", "fbm3"]);

export interface MarbleMaterial {
  readonly material: THREE.MeshPhysicalNodeMaterial;
  /** Domain-warp strength of the marble veins, tweakable at runtime. */
  readonly warp: ReturnType<typeof uniform<number>>;
}

/**
 * A physical material whose color and roughness are driven by WGSL functions
 * imported through the vgpu loader. TSL uniforms feed the WGSL functions as
 * plain parameters instead of @group/@binding resources: three manages the
 * actual bindings when it builds the shader.
 */
export function createMarbleMaterial(): MarbleMaterial {
  const warp = uniform(6.0);
  const veinColor = uniform(new THREE.Color(0x2a1f16));
  const baseColor = uniform(new THREE.Color(0xe8e3da));

  const material = new THREE.MeshPhysicalNodeMaterial({ clearcoat: 1, clearcoatRoughness: 0.15 });
  const samplePosition = positionLocal.add(vec3(0, 0, time.mul(0.05)));
  const veins = marble({ position: samplePosition, warp });
  const grain = fbm3({ position: positionLocal.mul(24.0), octaves: 3 });
  material.colorNode = mix(baseColor, veinColor, veins).mul(grain.mul(0.25).add(0.85));
  material.roughnessNode = mix(float(0.55), float(0.12), veins);

  return { material, warp };
}
