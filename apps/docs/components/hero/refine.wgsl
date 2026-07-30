// REFINE PASS — one-shot sub-pixel coverage/span of the photon ring.
//
// Runs immediately after the bake, in the same throttled `if (bake)` block, and
// never per frame. Reads the G-buffer the bake just wrote, finds the ~2% of
// pixels where the lensed disk image is compressed below one pixel, and traces
// 16 sub-rays there with the SAME integrator (`geodesic.wgsl`) to measure two
// numbers the per-frame pass cannot recover on its own:
//
//   covFront  fraction of the pixel covered by the FIRST disk crossing;
//   spanFront how much DISK RADIUS the pixel spans at that crossing.
//
// WHY THIS PASS EXISTS. At the shipped defaults the whole [ISCO, diskOuter]
// annulus is squeezed into ~1.5 px at screen radius r ~ 190 px (720p): measured
// on debug view 2, `diskUv.x` goes 0.12 -> 0.71 between two ADJACENT pixels at
// constant azimuth. One ray per pixel therefore draws a random radius out of the
// whole annulus, and every analytic softness in disk.wgsl (`innerEdge`,
// `outerEdge`, `flux`) is soft in DISK space and a hard step in SCREEN space
// there. The result is a dotted 1 px wire whose brightness jitters 10x between
// neighbouring degrees of azimuth, and a frame that is missing ~24% of the light
// a 3x supersampled reference collects. See gbuffer.md, "AA target".
//
// WHY IT IS A SEPARATE PASS AND A SEPARATE TARGET. The bake's MRT already spends
// exactly 32 B/sample, which is all WebGPU guarantees
// (`maxColorAttachmentBytesPerSample`), so a 5th attachment is not available. A
// second pass with its own 2 B/px `rg8unorm` target is additive, deletable, and
// costs the frame pass one extra texel fetch.
//
// COST. One-shot, and amortised the same way the bake is (the 200 ms re-bake
// throttle, renderer.ts). 25 texel loads per pixel for the mask, plus 16
// geodesics on the ~2% of pixels that fail it. The refined pixels are the
// EXPENSIVE near-b_crit geodesics, so the pass is roughly a third of the bake in
// practice; if a geometry drag ever feels sticky, cut SUB_STEPS 4 -> 3 (9
// sub-rays) before touching MAX_STEPS — a 2x reference is already close to a 3x
// one, so 16 sub-rays is more than converged.

import { ISCO, cameraRay, escapeRadiusFor, traceRay } from "./geodesic.wgsl";

/**
 * Same fields as `Bake` in bake.wgsl, in the same order: `renderer.ts` uploads
 * one geometry description to both passes, so they can never disagree about the
 * camera the sub-rays are traced from.
 */
struct Refine {
  resolution: vec2f,
  yaw: f32,
  pitch: f32,
  orbitRadius: f32,
  diskOuter: f32,
  fov: f32,
  centerY: f32,
}

@group(0) @binding(0) var<uniform> refine: Refine;
/** First-crossing plane position, from the bake pass. `(0,0)` = no hit. */
@group(0) @binding(1) var gHit1: texture_2d<f32>;
/** Only `w` is read here: flag bit 0 = the ray ended in the shadow. */
@group(0) @binding(2) var gSky: texture_2d<f32>;

/** Sub-rays per axis inside one pixel: 4x4 = 16 samples. */
const SUB_STEPS: i32 = 4;
/**
 * Half-width of the neighbourhood the boundary test looks at, in pixels.
 *
 * 5x5 (radius 2), not 3x3: the ring is thinner than a pixel, so a pixel whose
 * CENTRE ray misses it entirely must still be refined or it stays a hole in the
 * wire. Dilating the mask by 2 px is cheap one-shot insurance (25 loads).
 */
const MASK_RADIUS: i32 = 2;
/**
 * Radial-gradient trigger, in normalized annulus units. A pixel whose neighbour
 * sits 12% of the annulus away at the same azimuth is already in the compressed
 * regime even if both of them hit, which is the case coverage alone would miss.
 */
const GRADIENT_LIMIT: f32 = 0.12;

/** The bake writes a plain (0,0) for "no crossing"; the annulus starts at ISCO. */
fn isHitAt(plane: vec2f) -> bool {
  return length(plane) > ISCO * 0.5;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec2f {
  let dimensions = vec2i(textureDimensions(gHit1, 0));
  let texel = vec2i(clamp(uv * refine.resolution, vec2f(0.0), refine.resolution - vec2f(1.0)));
  let annulus = max(refine.diskOuter - ISCO, 0.001);

  let centerPlane = textureLoad(gHit1, texel, 0).xy;
  let centerHit = isHitAt(centerPlane);
  let centerHole = (i32(textureLoad(gSky, texel, 0).w + 0.5) & 1) != 0;
  let centerRadiusNorm = clamp((length(centerPlane) - ISCO) / annulus, 0.0, 1.0);

  // --- band detection ---------------------------------------------------------
  // Mixed state in the 5x5 neighbourhood: a different hit/miss answer, a
  // different shadow flag, or a steep radial gradient. Any of the three means
  // the pixel's ray bundle straddles something the single centre ray cannot
  // describe.
  var boundary = false;
  for (var dy = -MASK_RADIUS; dy <= MASK_RADIUS; dy++) {
    for (var dx = -MASK_RADIUS; dx <= MASK_RADIUS; dx++) {
      let neighbor = clamp(texel + vec2i(dx, dy), vec2i(0), dimensions - vec2i(1));
      let plane = textureLoad(gHit1, neighbor, 0).xy;
      let hit = isHitAt(plane);
      let hole = (i32(textureLoad(gSky, neighbor, 0).w + 0.5) & 1) != 0;
      if (hit != centerHit || hole != centerHole) {
        boundary = true;
      }
      if (hit && centerHit) {
        let radiusNorm = clamp((length(plane) - ISCO) / annulus, 0.0, 1.0);
        if (abs(radiusNorm - centerRadiusNorm) > GRADIENT_LIMIT) {
          boundary = true;
        }
      }
    }
  }

  // Everything outside the band is exactly what it is today: full coverage on a
  // hit, none on a miss, and zero span so the frame pass takes its single-tap
  // path. `1.0` and `0.0` are both exact in rg8unorm, so a non-band pixel
  // multiplies its alpha by a literal 1 and stays bit-for-bit unchanged.
  if (!boundary) {
    return vec2f(select(0.0, 1.0, centerHit), 0.0);
  }

  // --- 16 sub-rays ------------------------------------------------------------
  // A regular 4x4 stratified grid inside the pixel, deterministic and identical
  // for every pixel: a fixed pattern makes the residual quantisation of
  // `coverage` vary SMOOTHLY along the ring, which is the whole point of the
  // exercise, where a per-pixel jitter would trade a bias for pixel-to-pixel
  // noise in exactly the band being fixed.
  let escapeRadius = escapeRadiusFor(refine.orbitRadius);
  var hits = 0.0;
  var minRadius = 1e9;
  var maxRadius = -1e9;
  // Shadow coverage is deliberately NOT accumulated: measured, the shadow/sky
  // step is 0 -> 4/255, i.e. invisible, and consuming a fractional shadow would
  // composite stars from the truncated `gSky.xyz` of a swallowed ray — new
  // speckle in a 1 px rim, plus a perturbed derivative field under the star
  // prefilter. If it is ever wanted, it needs an escaped sub-sample's DIRECTION
  // stored alongside it, and a third channel. See gbuffer.md.
  for (var sy = 0; sy < SUB_STEPS; sy++) {
    for (var sx = 0; sx < SUB_STEPS; sx++) {
      let offset = (vec2f(f32(sx), f32(sy)) + vec2f(0.5)) / f32(SUB_STEPS);
      let subUv = (vec2f(texel) + offset) / refine.resolution;
      let ray = cameraRay(subUv, refine.resolution, refine.yaw, refine.pitch, refine.orbitRadius, refine.fov, refine.centerY);
      let traced = traceRay(ray.position, ray.velocity, refine.diskOuter, escapeRadius);
      if (traced.hitCount > 0) {
        let radius = length(traced.hit1Plane);
        hits += 1.0;
        minRadius = min(minRadius, radius);
        maxRadius = max(maxRadius, radius);
      }
    }
  }

  let coverage = hits / f32(SUB_STEPS * SUB_STEPS);
  if (hits < 0.5) {
    return vec2f(0.0, 0.0);
  }

  // --- span, measured SYMMETRICALLY ABOUT THE CENTRE RAY ----------------------
  // The frame pass places its taps on [r0 - span/2, r0 + span/2], anchored at the
  // centre ray's own radius `r0`, because that is the only radius it has. So the
  // useful quantity is not (rmax - rmin) but the smallest interval CENTRED ON r0
  // that contains every sub-ray crossing: with (rmax - rmin), a centre ray
  // sitting at one end of the range would shift the whole tap set off the
  // measured span by up to half of it and bias the radial mean (the plan's
  // risk 2). The price is a span up to 2x wider than the raw range, i.e. a
  // slightly wider prefilter — never a fade, and never a shifted one.
  //
  // When the centre ray missed the disk entirely there is no r0 and no radius to
  // rebuild the sample from, so the frame pass cannot shade the pixel at all;
  // the raw range is written for the diagnostic (debug view 8) instead.
  var span: f32;
  if (centerHit) {
    let r0 = length(centerPlane);
    span = 2.0 * max(abs(maxRadius - r0), abs(r0 - minRadius));
  } else {
    span = maxRadius - minRadius;
  }
  return vec2f(coverage, clamp(span / annulus, 0.0, 1.0));
}
