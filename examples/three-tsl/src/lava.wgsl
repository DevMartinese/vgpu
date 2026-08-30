import { fbm3, perlin3, turbulence3, valueNoise3 } from "./noise.wgsl";
import { voronoi3d } from "@vgpu/wgsl-std/noise";

// Incandescence ramp for molten rock: 0 = cold black crust, 1 = white-hot.
// Piecewise blend through deep red, orange, and yellow, in linear-ish space.
export fn blackbody(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  let ember = mix(vec3f(0.0, 0.0, 0.0), vec3f(0.45, 0.015, 0.0), smoothstep(0.0, 0.30, x));
  let red = mix(ember, vec3f(1.0, 0.16, 0.01), smoothstep(0.28, 0.55, x));
  let orange = mix(red, vec3f(1.0, 0.42, 0.03), smoothstep(0.52, 0.78, x));
  return mix(orange, vec3f(1.0, 0.85, 0.45), smoothstep(0.75, 1.0, x));
}

// Gently warped coordinates shared by every lava field so cracks, relief,
// and albedo stay registered. Slow drift simulates creeping flow.
fn lavaDomain(position: vec3f, t: f32) -> vec3f {
  let drift = vec3f(0.05, 0.012, 0.028) * t;
  let q = vec3f(
    fbm3(position * 1.1 + drift, 3u),
    fbm3(position * 1.1 + vec3f(5.2, 1.3, 2.8) + drift * 0.6, 3u),
    fbm3(position * 1.1 + vec3f(1.7, 9.2, 3.1), 3u),
  );
  return position + (q - 0.5) * 0.9;
}

// Distance to the nearest crust-plate boundary (0 at a crack).
fn plateEdge(position: vec3f) -> f32 {
  let sample = voronoi3d(position);
  return sample.f2 - sample.f1;
}

// Laminar flow striations in the melt skin: thin cooled cords that follow
// the flow, and — like the real wrinkling skin — merge, bifurcate, and
// break into segments instead of running forever.
//
// The cords are level sets of a smooth flow potential, so their direction
// IS the local flow direction; a spatially varying gain changes how many
// level sets fit, which forces merges and bifurcations; and a break field
// stretched along the flow frame (from the potential's gradient) interrupts
// each cord independently of its neighbors.
export fn flowStriations(position: vec3f, t: f32) -> f32 {
  let domain = lavaDomain(position, t);
  let arcOffset = vec3f(4.7, 9.2, 1.3);
  let arc = fbm3(domain * 0.55 + arcOffset, 3u);

  // Flow frame: "across" points across the cords (gradient of the potential).
  let eps = 0.05;
  let grad = vec3f(
    fbm3((domain + vec3f(eps, 0.0, 0.0)) * 0.55 + arcOffset, 3u) - arc,
    fbm3((domain + vec3f(0.0, eps, 0.0)) * 0.55 + arcOffset, 3u) - arc,
    fbm3((domain + vec3f(0.0, 0.0, eps)) * 0.55 + arcOffset, 3u) - arc,
  );
  let across = normalize(grad + vec3f(1e-4, 0.0, 0.0));

  // Variable gain: cord count changes across the field, so level sets must
  // appear, vanish, and split.
  let gain = 260.0 + 80.0 * fbm3(domain * 0.9 + vec3f(14.0, 6.0, 3.0), 2u);
  let jitter = fbm3(domain * 3.4 + vec3f(8.0, 3.0, 21.0), 3u);
  let band = 0.5 + 0.5 * sin(dot(domain, vec3f(1.3, 0.4, 1.0)) * 75.0 + arc * gain + jitter * 5.0);
  // Very narrow crests: thin lines over wide bright gaps.
  let band2 = band * band;
  let crest = band2 * band2 * band2;

  // Anisotropic breaks: slow variation along the cord, fast across it, so
  // segments are elongated dashes and neighboring cords break differently.
  let breakField = fbm3(domain * 5.0 + across * dot(domain, across) * 20.0, 3u);
  let continuity = smoothstep(0.34, 0.52, breakField);
  return crest * continuity;
}

// Final glow composition: x = heat 0..1 (feed the blackbody ramp),
// y = continuous-melt mask 0..1 (liquid gloss, not ember fringe).
//
// Two families, matching reference photos: laminar melt (crack cores and
// washes, textured by flow striations, with white-hot contact rims), and a
// fringe over solid crust (halo + ember speckle) that only seeps through
// the crevices of the micro grain instead of sitting painted on top.
export fn lavaGlow(position: vec3f, t: f32) -> vec2f {
  let domain = lavaDomain(position, t);
  // Fine wiggle so voronoi boundaries stop looking ruler-straight.
  let wiggle = domain + (vec3f(
    valueNoise3(domain * 6.0),
    valueNoise3(domain * 6.0 + 11.7),
    valueNoise3(domain * 6.0 + 23.3),
  ) - 0.5) * 0.22;

  let primary = plateEdge(wiggle * 0.75);
  let secondary = plateEdge(wiggle * 1.9 + vec3f(7.1, 3.7, 1.9));

  // Not every crack is active: many have cooled shut.
  let activity = 0.12 + 0.88 * smoothstep(0.35, 0.8, fbm3(domain * 0.7 + vec3f(0.0, 0.0, 0.02) * t, 3u));

  // --- continuous melt: crack cores plus washes, laminar ---
  let coreWidth = 0.028 + 0.05 * fbm3(domain * 1.3 + vec3f(42.0, 13.0, 27.0), 3u);
  let core = smoothstep(coreWidth, 0.0, primary);
  let window = smoothstep(0.6, 0.78, fbm3(domain * 0.5, 4u));
  let flank = smoothstep(0.28, 0.04, primary) * smoothstep(0.53, 0.76, fbm3(domain * 1.1 + vec3f(17.0, 2.0, 12.0), 3u));
  let wash = clamp(window + flank * 0.9, 0.0, 1.0);
  let islands = smoothstep(0.42, 0.68, fbm3(domain * 2.1 + vec3f(6.0, 21.0, 9.0), 4u));
  let meltMask = clamp(core * (0.4 + 0.6 * activity) + wash * (1.0 - islands * 0.92), 0.0, 1.0);

  // Contact rims burn white where fresh interior is exposed: at the outer
  // edges of washes and around the crust islands floating on them.
  let washRim = smoothstep(0.02, 0.2, wash) * smoothstep(0.75, 0.28, wash);
  let islandRim = islands * (1.0 - islands) * 4.0 * wash;
  let rim = clamp(washRim + islandRim * 0.6, 0.0, 1.0) * (0.4 + 0.6 * activity);

  // The melt skin cools in cords: striation crests drop toward deep red
  // while the troughs stay orange. Crack cores are freshly torn and stay
  // nearly uniform white-hot.
  let striae = flowStriations(position, t);
  let coreHeat = core * (0.4 + 0.6 * activity) * (1.0 - striae * 0.2);
  let washHeat = wash * (1.0 - islands * 0.92) * (1.0 - striae * 0.6);
  let meltHeat = clamp(coreHeat + washHeat, 0.0, 1.0) * (0.72 + 0.28 * activity) + rim * 0.55;

  // --- fringe over solid crust: halo + embers, seeped through the grain ---
  let fine = smoothstep(0.035, 0.0, secondary) * 0.4 * activity * activity;
  let halo = smoothstep(0.22, 0.0, primary) * 0.16 * (0.3 + 0.7 * activity);
  let creviceFine = smoothstep(0.52, 0.24, fbm3(position * 13.0, 4u));
  let creviceCoarse = smoothstep(0.48, 0.28, fbm3(position * 5.5 + vec3f(3.0, 9.0, 1.0), 3u)) * 0.6;
  let crevice = max(creviceFine, creviceCoarse);
  let warmth = clamp(smoothstep(0.3, 0.0, primary) + wash, 0.0, 1.0);
  let embers = crevice * warmth * (0.25 + 0.75 * activity) * 0.7;
  // Same grain register as microDetail, so the seep sits in the crevices of
  // the micro normals you actually see.
  let grain = turbulence3(position * 19.0, 5u);
  let seep = smoothstep(0.62, 0.25, grain);
  let fringeHeat = (fine + halo + embers) * seep * (1.0 - meltMask);

  // Slow breathing so the melt looks alive.
  let pulse = 0.9 + 0.1 * sin(t * 0.7 + fbm3(domain, 2u) * 6.2831853);
  let heat = clamp((meltHeat + fringeHeat) * pulse, 0.0, 1.0);
  return vec2f(heat, clamp(meltMask + rim * 0.5, 0.0, 1.0));
}

// Wide, smooth channel mask for vertex displacement: 1 inside molten
// channels and pools, 0 on plate interiors. Kept low-frequency so coarse
// meshes sample it without stippling.
export fn lavaSink(position: vec3f, t: f32) -> f32 {
  let domain = lavaDomain(position, t);
  let wiggle = domain + (vec3f(
    valueNoise3(domain * 6.0),
    valueNoise3(domain * 6.0 + 11.7),
    valueNoise3(domain * 6.0 + 23.3),
  ) - 0.5) * 0.22;
  let channel = smoothstep(0.3, 0.0, plateEdge(wiggle * 0.75));
  let pools = smoothstep(0.64, 0.82, fbm3(domain * 0.5, 4u));
  return clamp(channel * 0.7 + pools, 0.0, 1.0);
}

// Pahoehoe rope folds: curved parallel cords, 0..1 with rounded crests.
// The arc term bends the bands the way drapes of skin wrinkle ahead of a
// slowly advancing lobe.
fn ropeFolds(domain: vec3f) -> f32 {
  let arc = fbm3(domain * 0.7 + vec3f(8.4, 2.2, 6.6), 3u);
  let phase = dot(domain, vec3f(2.1, 0.6, 1.6)) * 7.0 + arc * 11.0;
  let band = 0.5 + 0.5 * sin(phase + fbm3(domain * 2.6, 3u) * 2.0);
  return band * band;
}

// Where the crust is ropy pahoehoe skin vs broken clinkery rubble, 0..1.
fn ropeMask(domain: vec3f) -> f32 {
  return smoothstep(0.38, 0.62, fbm3(domain * 0.32 + vec3f(19.0, 5.0, 11.0), 3u));
}

// Clustered vesicle pits (frozen gas bubbles) in the crust skin, 1 inside a
// pit. Pits only appear in patches, the way outgassed skin does.
fn vesiclePits(position: vec3f) -> f32 {
  let cluster = smoothstep(0.52, 0.68, fbm3(position * 1.4 + vec3f(9.0, 27.0, 4.0), 3u));
  let sample = voronoi3d(position * 26.0);
  return smoothstep(0.14, 0.03, sample.f1) * cluster;
}

// Crust relief height, 0..1: domed plates that sink toward the cracks,
// wrinkled into ropes on pahoehoe lobes and broken into rubble elsewhere.
export fn crustHeight(position: vec3f, t: f32) -> f32 {
  let domain = lavaDomain(position, t);
  let dome = smoothstep(0.0, 0.45, plateEdge(domain * 0.75));
  let lobes = ropeMask(domain);
  let rough = turbulence3(domain * 4.2, 6u) * 0.2;
  let fine = turbulence3(domain * 9.5 + vec3f(2.0, 12.0, 6.0), 5u) * 0.12;
  let ropes = ropeFolds(domain) * lobes * 0.38;
  let rubble = turbulence3(position * 13.0, 5u) * (1.0 - lobes) * 0.3;
  let pits = vesiclePits(position) * 0.08;
  return clamp(dome * 0.45 + rough + fine + ropes + rubble - pits + 0.06, 0.0, 1.0);
}

// High-frequency surface detail, cheap enough to finite-difference at a
// small epsilon for micro normals:
// x = sharp mineral grain, y = flow-line streaks frozen into the glassy skin.
export fn microDetail(position: vec3f) -> vec2f {
  let grain = turbulence3(position * 19.0, 5u);
  let streaks = perlin3(position * vec3f(24.0, 7.0, 24.0) + vec3f(4.0, 8.0, 15.0));
  return vec2f(grain, streaks);
}

// PBR refinement masks:
// x = cavity occlusion (crevices and pits trap ambient light),
// y = iridescence patches of the glassy skin,
// z = specular-intensity mottling, w = glinting mineral facets.
export fn crustPbr(position: vec3f, t: f32) -> vec4f {
  let domain = lavaDomain(position, t);
  let crevice = smoothstep(0.52, 0.24, fbm3(position * 13.0, 4u));
  let cavity = clamp(1.0 - crevice * 0.5 - vesiclePits(position) * 0.35, 0.0, 1.0);
  let irid = smoothstep(0.5, 0.8, fbm3(domain * 1.6 + vec3f(31.0, 7.0, 19.0), 3u));
  let spec = 0.55 + 0.45 * fbm3(domain * 3.0 + vec3f(9.0, 1.0, 25.0), 3u);
  let facets = smoothstep(0.72, 0.92, perlin3(position * 21.0 + vec3f(11.0, 3.0, 29.0)));
  return vec4f(cavity, irid, spec, facets);
}

// Shading masks for the crust skin:
// x = tone mottling, y = oxide staining, z = glassy-sheen mask, w = vesicle pits.
export fn crustSurface(position: vec3f, t: f32) -> vec4f {
  let domain = lavaDomain(position, t);
  let tone = turbulence3(domain * 2.4 + vec3f(3.3, 7.7, 5.1), 5u);
  let oxide = smoothstep(0.55, 0.8, fbm3(domain * 1.7 + vec3f(13.0, 3.0, 8.0), 4u));
  // Fresh pahoehoe skin cools into volcanic glass; rubble stays matte.
  let glass = smoothstep(0.45, 0.72, fbm3(domain * 1.1 + vec3f(23.0, 15.0, 2.0), 3u)) * ropeMask(domain);
  return vec4f(tone, oxide, glass, vesiclePits(position));
}
