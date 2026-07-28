// STAR FIELD SHADER — shaded from the already lensed ray direction.
//
// This uses the Earth experiment's cube-face-cell approach rather than a
// latitude/longitude grid. Cube faces keep cells nearly square near every pole,
// and one jittered point per cell makes a crisp, inexpensive star field.

import { pcg3d, unitFloat } from "@vgpu/wgsl-std/hash";

const STAR_INTENSITY: f32 = 0.16;
// Cube-face angular radius shared by every star. This matches the smallest
// point from the prior field; `starLayer` converts it to each grid's units.
const UNIFORM_POINT_RADIUS: f32 = 0.00029;

/** Per-frame star tuning, uploaded as `stars` by renderer.ts. */
export struct StarLook {
  /** Global multiplier applied after each star's hash-mapped brightness. */
  brightness: f32,
  /** Emission of the faintest star before the global brightness multiplier. */
  brightnessMin: f32,
  /** Emission of the strongest star before the global brightness multiplier. */
  brightnessMax: f32,
  /** Population multiplier; 1.0 matches the Earth-derived field. */
  density: f32,
  /** Optional slow, per-star temporal modulation; 0.0 keeps the sky still. */
  twinkle: f32,
}

/**
 * Cube-face parameterization copied from the Earth sky shader. A cell grid on
 * this parameterization remains near-square across the sky, avoiding the
 * stretched stars a spherical UV grid produces at its poles.
 */
fn faceCoords(direction: vec3f) -> vec3f {
  let magnitude = abs(direction);
  if (magnitude.x >= magnitude.y && magnitude.x >= magnitude.z) {
    return vec3f(direction.yz / magnitude.x, select(1.0, 0.0, direction.x > 0.0));
  }
  if (magnitude.y >= magnitude.z) {
    return vec3f(direction.xz / magnitude.y, select(3.0, 2.0, direction.y > 0.0));
  }
  return vec3f(direction.xy / magnitude.z, select(5.0, 4.0, direction.z > 0.0));
}

/**
 * One Earth-style density layer: at most one jittered star per cube-face cell.
 * The squared radial falloff leaves compact, antialiased pinpoints instead of
 * broad core-and-halo blobs. Every layer uses the same angular radius, so
 * brightness—not diameter—is the only visual hierarchy between stars.
 */
fn starLayer(
  direction: vec3f,
  cells: f32,
  density: f32,
  brightnessMin: f32,
  brightnessMax: f32,
  seed: i32,
  time: f32,
  twinkle: f32,
) -> f32 {
  let face = faceCoords(direction);
  let grid = face.xy * cells;
  let cell = floor(grid);
  let hashed = pcg3d(bitcast<vec3u>(vec3i(vec2i(cell), i32(face.z) * 131 + seed)));
  let presence = unitFloat(hashed.x);
  if (presence > density) {
    return 0.0;
  }

  let jitter = vec2f(unitFloat(hashed.y), unitFloat(hashed.z)) - vec2f(0.5);
  let center = cell + vec2f(0.5) + jitter * 0.8;
  // Grid units scale with `cells`, so multiply by the grid resolution to make
  // every layer use one shared angular point radius.
  let radius = UNIFORM_POINT_RADIUS * cells;
  let falloff = 1.0 - smoothstep(0.0, radius, length(grid - center));

  // The same stable per-cell hash that decides whether this star exists maps
  // linearly to the user-selected [brightnessMin, brightnessMax] interval.
  // Normalizing by density keeps that interval represented at every population.
  let brightnessHash = presence / max(density, 1.0e-4);
  let magnitude = mix(brightnessMin, brightnessMax, clamp(brightnessHash, 0.0, 1.0));

  // Kept deliberately gentler than the old field: at twinkle = 1 this varies
  // by only +/- 6%, and every star has a stable hash-derived phase.
  let phase = unitFloat(hashed.y) * 6.2831853;
  let shimmer = 1.0 + clamp(twinkle, 0.0, 1.0) * 0.06 * sin(time * (0.35 + unitFloat(hashed.z) * 0.4) + phase);
  return falloff * falloff * magnitude * shimmer;
}

/** Entry point used by shade.wgsl for every escaped, non-horizon ray. */
export fn shadeStars(direction: vec3f, look: StarLook, time: f32) -> vec3f {
  let population = clamp(max(0.0, look.density), 0.0, 1.0);
  let dimmest = max(0.0, look.brightnessMin);
  let brightest = max(dimmest, look.brightnessMax);
  let d = normalize(direction);

  // Ported from apps/docs/examples/earth/sky.wgsl: sparse anchors, a main
  // field, and a small unresolved wash. All stars share the same angular size;
  // the layer weights and hash-mapped emission create the visual hierarchy.
  let luminance = (
    starLayer(d, 34.0, population * 0.55, dimmest, brightest, 17, time, look.twinkle) * 1.35
      + starLayer(d, 92.0, population * 0.42, dimmest, brightest, 71, time, look.twinkle) * 0.85
      + starLayer(d, 210.0, population * 0.26, dimmest, brightest, 149, time, look.twinkle) * 0.30
  ) * STAR_INTENSITY;

  return vec3f(luminance * max(0.0, look.brightness));
}
