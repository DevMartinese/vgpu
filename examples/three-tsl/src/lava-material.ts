import * as THREE from "three/webgpu";
import { float, mix, normalLocal, positionLocal, smoothstep, time, transformNormalToView, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import lavaModule from "./lava.wgsl";
import { tslExports } from "./wgsl-tsl.ts";

const { lavaHeat, blackbody, crustHeight, crustTone, lavaSink } = tslExports(lavaModule, [
  "lavaHeat",
  "blackbody",
  "crustHeight",
  "crustTone",
  "lavaSink",
]);

export interface LavaMaterialOptions {
  /** Drives the flow animation; defaults to the TSL `time` node. */
  readonly timeNode?: Node;
}

export interface LavaMaterial {
  readonly material: THREE.MeshPhysicalNodeMaterial;
  /** Emissive strength of the molten channels. */
  readonly glowIntensity: ReturnType<typeof uniform<number>>;
  /** Spatial frequency of the lava field on the mesh. */
  readonly scale: ReturnType<typeof uniform<number>>;
}

/**
 * Cooling basalt crust over an incandescent molten interior. The heat field,
 * crust relief, and blackbody ramp all come from lava.wgsl through the vgpu
 * loader; three only sees TSL nodes.
 */
export function createLavaMaterial(options: LavaMaterialOptions = {}): LavaMaterial {
  const glowIntensity = uniform(3.0);
  const scale = uniform(1.0);
  const t = options.timeNode ?? time;

  const p = positionLocal.mul(scale);
  const heat = lavaHeat({ position: p, t });
  const height = crustHeight({ position: p, t });
  const tone = crustTone({ position: p, t });

  // How exposed the melt is: crust occludes low heat completely.
  const molten = smoothstep(0.3, 0.75, heat);

  const material = new THREE.MeshPhysicalNodeMaterial({ metalness: 0 });

  // Solidified basalt: dark grey-brown plates with mottled tone, so the
  // crust reads as rock under dim light instead of a void.
  const basalt = mix(vec3(0.06, 0.055, 0.052), vec3(0.3, 0.26, 0.235), tone)
    .mul(height.mul(0.6).add(0.55));
  material.colorNode = mix(basalt, vec3(0.012, 0.01, 0.009), molten);

  // Incandescence: blackbody ramp over the heat field, crushed slightly so
  // crack cores go yellow-white while edges cool through deep red.
  material.emissiveNode = blackbody({ t: heat.pow(1.35) }).mul(glowIntensity);

  // Fresh crust is matte rubble; molten rock is a glossy liquid skin.
  material.roughnessNode = mix(float(0.95), float(0.35), molten);

  // Plates bulge up, molten channels sink. The sink mask is a separate wide,
  // low-frequency field so coarse meshes sample it without stippling.
  const sink = lavaSink({ position: p, t });
  const relief = height.mul(0.5).sub(sink.mul(0.4)).mul(0.12);
  material.positionNode = positionLocal.add(normalLocal.mul(relief));

  // Bump normals from the crust height field by finite differences, so the
  // plates catch raking light. The gradient is projected onto the surface.
  const eps = 0.03;
  const grad = vec3(
    crustHeight({ position: p.add(vec3(eps, 0, 0)), t }).sub(height),
    crustHeight({ position: p.add(vec3(0, eps, 0)), t }).sub(height),
    crustHeight({ position: p.add(vec3(0, 0, eps)), t }).sub(height),
  ).div(eps);
  const tangentGrad = grad.sub(normalLocal.mul(grad.dot(normalLocal)));
  const bumped = normalLocal.sub(tangentGrad.mul(mix(float(0.22), float(0.04), molten))).normalize();
  material.normalNode = transformNormalToView(bumped);

  return { material, glowIntensity, scale };
}
