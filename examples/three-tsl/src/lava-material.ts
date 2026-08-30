import * as THREE from "three/webgpu";
import { float, mix, normalLocal, positionLocal, smoothstep, time, transformNormalToView, uniform, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import lavaModule from "./lava.wgsl";
import { tslExports } from "./wgsl-tsl.ts";

const { lavaGlow, blackbody, crustHeight, crustSurface, crustPbr, lavaSink, microDetail, flowStriations } = tslExports(lavaModule, [
  "lavaGlow",
  "blackbody",
  "crustHeight",
  "crustSurface",
  "crustPbr",
  "lavaSink",
  "microDetail",
  "flowStriations",
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
  const glowIntensity = uniform(2.4);
  const scale = uniform(1.0);
  const t = options.timeNode ?? time;

  const p = positionLocal.mul(scale);
  // The whole glow composition (laminar melt with striations and contact
  // rims, plus the grain-seeped ember fringe) lives in lava.wgsl: x = heat,
  // y = continuous-melt mask.
  const glow = lavaGlow({ position: p, t });
  const heat = glow.x;
  const molten = glow.y;
  const height = crustHeight({ position: p, t });
  const surface = crustSurface({ position: p, t });
  const tone = surface.x;
  const oxide = surface.y;
  const glass = surface.z;
  const pits = surface.w;

  // High-frequency surface detail: mineral grain plus flow-line streaks
  // frozen into the glassy skin. Shared by the roughness map and the micro
  // normal pass below.
  const micro = microDetail({ position: p });
  const grain = micro.x;
  const streaks = micro.y;

  const material = new THREE.MeshPhysicalNodeMaterial({ metalness: 0 });

  // Basalt skin: graphite grey with a cold blue cast, ridges catching more
  // light than the fissured low ground, rust staining on older patches, and
  // vesicle pits going almost black.
  const graphite = mix(vec3(0.03, 0.03, 0.036), vec3(0.17, 0.17, 0.19), tone);
  const ridgeLight = height.mul(height).mul(0.6).add(0.6);
  const stained = mix(graphite.mul(ridgeLight), vec3(0.20, 0.085, 0.05), oxide.mul(0.5));
  const basalt = mix(stained, stained.mul(0.45), pits);
  material.colorNode = mix(basalt, vec3(0.012, 0.01, 0.009), molten);

  // Incandescence: blackbody ramp over the composed heat field, crushed
  // slightly so contact rims go yellow-white while striation crests cool
  // through deep red.
  material.emissiveNode = blackbody({ t: heat.pow(1.35) }).mul(glowIntensity);

  // Roughness map, not a constant: rubble is matte with sharp grain breakup,
  // the glassy skin is polished but streaked by flow lines, vesicle pits and
  // dusty valleys scatter more, and molten rock is a glossy liquid.
  const crustRoughness = mix(float(0.86), float(0.26), glass)
    .add(grain.sub(0.5).mul(0.22))
    .add(streaks.sub(0.5).mul(0.2).mul(glass))
    .add(pits.mul(0.1))
    .add(height.oneMinus().mul(0.06));
  const moltenRoughness = float(0.32).add(streaks.sub(0.5).mul(0.1));
  material.roughnessNode = mix(crustRoughness, moltenRoughness, molten).clamp(0.05, 1);
  material.clearcoatNode = glass.mul(0.75).mul(molten.oneMinus());
  material.clearcoatRoughnessNode = float(0.22).add(grain.sub(0.5).mul(0.15)).clamp(0.05, 1);

  // PBR refinement, all from WGSL: cavity occlusion keeps crevices dark
  // under the environment light, specular mottling breaks up the sheen,
  // glinting mineral facets read as tiny metallic flakes, and the glassy
  // skin gets a faint thin-film iridescence.
  const pbr = crustPbr({ position: p, t });
  const cavity = pbr.x;
  const irid = pbr.y;
  const specMottle = pbr.z;
  const facets = pbr.w;
  material.aoNode = cavity;
  material.specularIntensityNode = mix(specMottle, float(1), molten);
  material.metalnessNode = facets.mul(glass.mul(0.4).add(0.1)).mul(molten.oneMinus());
  material.iridescenceNode = irid.mul(glass).mul(0.3);
  material.iridescenceIORNode = float(2.0);
  material.iridescenceThicknessNode = irid.mul(250).add(150);

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

  const microEps = 0.005;
  const microGrad = vec3(
    microDetail({ position: p.add(vec3(microEps, 0, 0)) }).x.sub(grain),
    microDetail({ position: p.add(vec3(0, microEps, 0)) }).x.sub(grain),
    microDetail({ position: p.add(vec3(0, 0, microEps)) }).x.sub(grain),
  ).div(microEps);
  const microTangent = microGrad.sub(normalLocal.mul(microGrad.dot(normalLocal)));

  // The flow cords are physical wrinkles in the melt skin: finite-difference
  // the striation field so each cord raises a small ridge, molten areas only.
  const striaeEps = 0.004;
  const striaeBase = flowStriations({ position: p, t });
  const striaeGrad = vec3(
    flowStriations({ position: p.add(vec3(striaeEps, 0, 0)), t }).sub(striaeBase),
    flowStriations({ position: p.add(vec3(0, striaeEps, 0)), t }).sub(striaeBase),
    flowStriations({ position: p.add(vec3(0, 0, striaeEps)), t }).sub(striaeBase),
  ).div(striaeEps);
  const striaeTangent = striaeGrad.sub(normalLocal.mul(striaeGrad.dot(normalLocal)));

  const bumped = normalLocal
    .sub(tangentGrad.mul(mix(float(0.16), float(0.04), molten)))
    .sub(microTangent.mul(mix(float(0.022), float(0.008), molten)))
    .sub(striaeTangent.mul(mix(float(0.006), float(0.012), molten)))
    .normalize();
  material.normalNode = transformNormalToView(bumped);

  // The clearcoat is the frozen glass skin draped over the rock: it follows
  // the plates but not the mineral grain, so it gets its own smoother normal.
  const skinNormal = normalLocal.sub(tangentGrad.mul(0.1)).normalize();
  material.clearcoatNormalNode = transformNormalToView(skinNormal);

  return { material, glowIntensity, scale };
}
