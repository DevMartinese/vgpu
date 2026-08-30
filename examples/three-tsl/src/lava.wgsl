import { fbm3, perlin3, valueNoise3 } from "./noise.wgsl";
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

// Heat of the molten network, 0..1. Thin polygonal cracks between crust
// plates, a faint ember halo around them, and occasional molten pools.
export fn lavaHeat(position: vec3f, t: f32) -> f32 {
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

  // Crack width varies along the crack: pinches, and widenings that expose melt.
  let coreWidth = 0.028 + 0.05 * fbm3(domain * 1.3 + vec3f(42.0, 13.0, 27.0), 3u);
  let core = smoothstep(coreWidth, 0.0, primary);              // white-hot crack center
  let fine = smoothstep(0.035, 0.0, secondary) * 0.4;          // secondary hairline cracks
  let halo = smoothstep(0.22, 0.0, primary) * 0.16;            // ember glow bleeding into crust
  // Occasional exposed melt windows, streaked along the flow direction.
  let window = smoothstep(0.64, 0.82, fbm3(domain * 0.5, 4u));
  let streaks = 0.75 + 0.25 * valueNoise3(domain * vec3f(2.2, 6.5, 2.2) + vec3f(0.0, 0.1, 0.0) * t);
  let pools = window * streaks;

  let heat = core * (0.55 + 0.45 * activity) + fine * activity * activity + halo * (0.3 + 0.7 * activity) + pools * 0.95;
  // Slow breathing so the melt looks alive.
  let pulse = 0.9 + 0.1 * sin(t * 0.7 + fbm3(domain, 2u) * 6.2831853);
  return clamp(heat * pulse, 0.0, 1.0);
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
  let rough = fbm3(domain * 4.2, 5u) * 0.2;
  let fine = fbm3(domain * 9.5 + vec3f(2.0, 12.0, 6.0), 4u) * 0.1;
  let ropes = ropeFolds(domain) * lobes * 0.38;
  let rubble = fbm3(position * 13.0, 4u) * (1.0 - lobes) * 0.3;
  let pits = vesiclePits(position) * 0.08;
  return clamp(dome * 0.45 + rough + fine + ropes + rubble - pits + 0.06, 0.0, 1.0);
}

// High-frequency surface detail, cheap enough to finite-difference at a
// small epsilon for micro normals:
// x = sharp mineral grain, y = flow-line streaks frozen into the glassy skin.
export fn microDetail(position: vec3f) -> vec2f {
  let grain = fbm3(position * 17.0, 5u);
  let streaks = perlin3(position * vec3f(24.0, 7.0, 24.0) + vec3f(4.0, 8.0, 15.0));
  return vec2f(grain, streaks);
}

// Shading masks for the crust skin:
// x = tone mottling, y = oxide staining, z = glassy-sheen mask, w = vesicle pits.
export fn crustSurface(position: vec3f, t: f32) -> vec4f {
  let domain = lavaDomain(position, t);
  let tone = fbm3(domain * 2.4 + vec3f(3.3, 7.7, 5.1), 4u);
  let oxide = smoothstep(0.55, 0.8, fbm3(domain * 1.7 + vec3f(13.0, 3.0, 8.0), 4u));
  // Fresh pahoehoe skin cools into volcanic glass; rubble stays matte.
  let glass = smoothstep(0.45, 0.72, fbm3(domain * 1.1 + vec3f(23.0, 15.0, 2.0), 3u)) * ropeMask(domain);
  return vec4f(tone, oxide, glass, vesiclePits(position));
}
