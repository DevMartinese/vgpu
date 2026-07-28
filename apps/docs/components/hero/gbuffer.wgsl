// Shared G-buffer contract for the hero black hole.
//
// INFRASTRUCTURE MODULE — read it, do not edit it. `disk.wgsl` and `stars.wgsl`
// are the files meant to be iterated on. See GBUFFER.md for the full contract.
//
// WGSL modules must stay pure: no @group/@binding here (the entry shader
// `shade.wgsl` owns every binding), only exported constants, structs and
// functions.

/** Event horizon radius. The whole scene uses r_s = 1 units. */
export const HORIZON: f32 = 1.0;
/** Innermost stable circular orbit = inner edge of the accretion disk. */
export const ISCO: f32 = 3.0;
export const TAU: f32 = 6.28318530718;
export const PI_CONST: f32 = 3.14159265359;

/**
 * One decoded G-buffer texel, for ONE disk layer. Produced by `decodeGBuffer()`
 * in the frame pass and handed to the disk / star shaders.
 *
 * Its shape is deliberately unchanged from the single-hit version: `shadeDisk`
 * shades one layer at a time and does not need to know whether it is looking at
 * the front crossing or the one hidden behind it.
 */
export struct GBufferSample {
  /** World-space position of the disk hit; y is always 0. Zero when `isHit` is false. */
  position: vec3f,
  /** Surface normal at the hit: (0, +1, 0) hit from above, (0, -1, 0) from below, 0 when no hit. */
  normal: vec3f,
  /** Normalized disk coordinates: x = radius 0 at ISCO -> 1 at the outer rim, y = azimuth 0..1. */
  diskUv: vec2f,
  /** Polar disk coordinates: x = world radius (>= ISCO), y = azimuth in radians (-PI..PI). */
  diskPolar: vec2f,
  /** Final ray direction after lensing (unit). Use it to sample the sky. */
  rayDirection: vec3f,
  /** Ray direction at the moment it hit the disk (unit). Use it for Doppler beaming. */
  viewDirection: vec3f,
  /** +1 hit from above, -1 from below, 0 no hit. Same sign as `normal.y`. */
  side: f32,
  /** True when this pixel sees the accretion disk. */
  isHit: bool,
  /** True when the ray ended inside the event horizon (render black). */
  isBlackHole: bool,
  /** True when the ray escaped to infinity (render stars). */
  escaped: bool,
}

/**
 * The two disk crossings a single geodesic can record, nearest first.
 *
 * `front` is the crossing closest to the camera — the band that visually sits in
 * front. `back` is the next crossing along the same ray: the lensed image of the
 * disk that the front band partly hides. `back.isHit` is only ever true when
 * `front.isHit` is, so composite it *under* the front layer.
 *
 * Everything that is a property of the ray rather than of a crossing
 * (`rayDirection`, `isBlackHole`, `escaped`) is duplicated into both layers.
 */
export struct GBufferLayers {
  front: GBufferSample,
  back: GBufferSample,
}

/**
 * Unpacks a unit direction stored as (y, azimuth of xz) by bake.wgsl.
 * Reconstruction is exactly unit-length, which matters because disk.wgsl feeds
 * it straight into a dot product for the Doppler term.
 */
fn decodeDirection(encoded: vec2f) -> vec3f {
  let horizontal = sqrt(max(1.0 - encoded.x * encoded.x, 0.0));
  return vec3f(cos(encoded.y) * horizontal, encoded.x, sin(encoded.y) * horizontal);
}

/** Decodes one crossing. `flags` and `sky` are shared by both layers. */
fn decodeLayer(plane: vec2f, encodedDirection: vec2f, sky: vec4f, flags: i32, diskOuter: f32) -> GBufferSample {
  var sample: GBufferSample;
  let planeRadius = length(plane);
  // The bake only ever writes crossings inside [ISCO, diskOuter] and leaves a
  // plain (0, 0) otherwise, so the radius alone separates hit from miss and no
  // flag channel has to be spent on it.
  let isHit = planeRadius > ISCO * 0.5;
  let radius = max(planeRadius, ISCO);
  let azimuth = atan2(plane.y, plane.x);
  let direction = decodeDirection(encodedDirection);
  // Which face the photon sees. A photon that lands on the TOP face is by
  // definition travelling downward, so the side is just -sign(dir.y) and the
  // bake does not need to store it. select() keeps it strictly +/-1 so a
  // perfectly tangent ray cannot produce a 0 that would read as "no hit".
  let side = select(1.0, -1.0, direction.y > 0.0);

  sample.position = select(vec3f(0.0), vec3f(plane.x, 0.0, plane.y), isHit);
  sample.normal = select(vec3f(0.0), vec3f(0.0, side, 0.0), isHit);
  // Radial coordinate recomputed from the f32 hit position instead of being
  // stored: same formula the bake used, one fewer channel, and slightly more
  // accurate than the f16 copy it replaces.
  sample.diskUv = vec2f(
    clamp((radius - ISCO) / max(diskOuter - ISCO, 0.001), 0.0, 1.0),
    (azimuth + PI_CONST) / TAU,
  );
  sample.diskPolar = vec2f(radius, azimuth);
  sample.rayDirection = sky.xyz;
  sample.viewDirection = direction;
  sample.side = select(0.0, side, isHit);
  sample.isHit = isHit;
  sample.isBlackHole = (flags & 1) != 0;
  sample.escaped = (flags & 2) != 0;
  return sample;
}

/**
 * Decodes the four raw G-buffer texels written by `bake.wgsl` into both disk
 * layers. `diskOuter` must be the same disk radius the bake ran with.
 */
export fn decodeGBuffer(hit1: vec2f, hit2: vec2f, sky: vec4f, view: vec4f, diskOuter: f32) -> GBufferLayers {
  let flags = i32(sky.w + 0.5);
  var layers: GBufferLayers;
  layers.front = decodeLayer(hit1, view.xy, sky, flags, diskOuter);
  layers.back = decodeLayer(hit2, view.zw, sky, flags, diskOuter);
  // The bake already guarantees this ordering; enforcing it here too means a
  // second layer can never be shaded without a first one in front of it.
  if (!layers.front.isHit) {
    layers.back.isHit = false;
    layers.back.side = 0.0;
    layers.back.normal = vec3f(0.0);
  }
  return layers;
}
