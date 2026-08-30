import * as THREE from "three/webgpu";
import { float, mix, normalLocal, positionLocal, smoothstep, time, transformNormalToView, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import lavaModule from "./lava.wgsl";
import { tslExports } from "./wgsl-tsl.ts";

const { lavaHeat, blackbody, crustHeight, crustSurface, lavaSink, microDetail } = tslExports(lavaModule, [
  "lavaHeat",
  "blackbody",
  "crustHeight",
  "crustSurface",
  "lavaSink",
  "microDetail",
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
  const surface = crustSurface({ position: p, t });
  const tone = surface.x;
  const oxide = surface.y;
  const glass = surface.z;
  const pits = surface.w;

  // How exposed the melt is: crust occludes low heat completely.
  const molten = smoothstep(0.3, 0.75, heat);

  const material = new THREE.MeshPhysicalNodeMaterial({ metalness: 0 });

  // Basalt skin: graphite grey with a cold blue cast, ridges catching more
  // light than the fissured low ground, rust staining on older patches, and
  // vesicle pits going almost black.
  const graphite = mix(vec3(0.045, 0.045, 0.052), vec3(0.28, 0.28, 0.31), tone);
  const ridgeLight = height.mul(height).mul(0.6).add(0.7);
  const stained = mix(graphite.mul(ridgeLight), vec3(0.20, 0.085, 0.05), oxide.mul(0.5));
  const basalt = mix(stained, stained.mul(0.45), pits);
  material.colorNode = mix(basalt, vec3(0.012, 0.01, 0.009), molten);

  // Incandescence: blackbody ramp over the heat field, crushed slightly so
  // crack cores go yellow-white while edges cool through deep red.
  material.emissiveNode = blackbody({ t: heat.pow(1.35) }).mul(glowIntensity);

  // High-frequency surface detail: mineral grain plus flow-line streaks
  // frozen into the glassy skin. Shared by the roughness map and the micro
  // normal pass below.
  const micro = microDetail({ position: p });
  const grain = micro.x;
  const streaks = micro.y;

  // Roughness map, not a constant: rubble is matte with sharp grain breakup,
  // the glassy skin is polished but streaked by flow lines, vesicle pits and
  // dusty valleys scatter more, and molten rock is a glossy liquid.
  const crustRoughness = mix(float(0.92), float(0.3), glass)
    .add(grain.sub(0.5).mul(0.26))
    .add(streaks.sub(0.5).mul(0.2).mul(glass))
    .add(pits.mul(0.1))
    .add(height.oneMinus().mul(0.06));
  const moltenRoughness = float(0.32).add(streaks.sub(0.5).mul(0.1));
  material.roughnessNode = mix(crustRoughness, moltenRoughness, molten).clamp(0.05, 1);
  material.clearcoatNode = glass.mul(0.7).mul(molten.oneMinus());
  material.clearcoatRoughnessNode = float(0.22).add(grain.sub(0.5).mul(0.15)).clamp(0.05, 1);

  // Plates bulge up, molten channels sink. The sink mask is a separate wide,
  // low-frequency field so coarse meshes sample it without stippling.
  const sink = lavaSink({ position: p, t });
  const relief = height.mul(0.5).sub(sink.mul(0.4)).mul(0.12);
  material.positionNode = positionLocal.add(normalLocal.mul(relief));

  // Bump normals in two registers, both by finite differences projected onto
  // the surface: the crust height field at a coarse epsilon for plates and
  // ropes, and the micro grain at a fine epsilon for crisp mineral detail.
  const eps = 0.03;
  const grad = vec3(
    crustHeight({ position: p.add(vec3(eps, 0, 0)), t }).sub(height),
    crustHeight({ position: p.add(vec3(0, eps, 0)), t }).sub(height),
    crustHeight({ position: p.add(vec3(0, 0, eps)), t }).sub(height),
  ).div(eps);
  const tangentGrad = grad.sub(normalLocal.mul(grad.dot(normalLocal)));

  const microEps = 0.008;
  const microGrad = vec3(
    microDetail({ position: p.add(vec3(microEps, 0, 0)) }).x.sub(grain),
    microDetail({ position: p.add(vec3(0, microEps, 0)) }).x.sub(grain),
    microDetail({ position: p.add(vec3(0, 0, microEps)) }).x.sub(grain),
  ).div(microEps);
  const microTangent = microGrad.sub(normalLocal.mul(microGrad.dot(normalLocal)));

  const bumped = normalLocal
    .sub(tangentGrad.mul(mix(float(0.22), float(0.04), molten)))
    .sub(microTangent.mul(mix(float(0.035), float(0.006), molten)))
    .normalize();
  material.normalNode = transformNormalToView(bumped);

  return { material, glowIntensity, scale };
}
