// STAR FIELD SHADER — shaded from the already lensed ray direction.
//
// This uses the Earth experiment's cube-face-cell approach rather than a
// latitude/longitude grid. Cube faces keep cells nearly square near every pole,
// and one jittered point per cell makes a crisp, inexpensive star field.

import { pcg3d, unitFloat } from "@vgpu/wgsl-std/hash";

const STAR_INTENSITY: f32 = 0.16;
// Cube-face angular radius shared by every star. This matches the smallest
// point from the prior field; `starLayer` converts it to each grid's units.
//
// It is SMALLER THAN A PIXEL at every resolution the hero ships at (0.28 px at
// 720p, 0.53 px at 1350p), which is why the field is prefiltered rather than
// point sampled — see `skyFilter`.
const UNIFORM_POINT_RADIUS: f32 = 0.00029;

/**
 * Integral of the squared-smoothstep falloff over a disc of radius R, divided by
 * R^2: `2*pi*integral(u*(1-3u^2+2u^3)^2, u=0..1)` = 0.5385. It converts a star's
 * peak brightness into its total flux, which is what `starLayer` needs to know to
 * fall back on a layer's mean radiance.
 */
const STAR_FLUX_AREA: f32 = 0.5385;

/** Hard cap on the prefilter radius, in pixels. Only reached where the lensing
 * map is locally degenerate (a caustic), where it keeps a divide-by-zero from
 * painting a giant blob. */
const MAX_PREFILTER_PIXELS: f32 = 4.0;

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
 * The same projection as `faceCoords`, but onto a CALLER-CHOSEN axis
 * (0 = x, 1 = y, 2 = z) instead of the dominant one.
 *
 * `skyFilter` differentiates the projection by finite differences, and the
 * neighbouring direction it evaluates can sit on the other side of a cube-face
 * boundary; re-deriving the face there would produce a meaningless jump. Pinning
 * the axis keeps the derivative on one smooth chart. Note the projection is
 * scale invariant (it is a ratio of components), so it does not care that the
 * differentiated direction is no longer unit length.
 */
fn faceProject(direction: vec3f, axis: i32) -> vec2f {
  if (axis == 0) {
    return direction.yz / abs(direction.x);
  }
  if (axis == 1) {
    return direction.xz / abs(direction.y);
  }
  return direction.xy / abs(direction.z);
}

/**
 * PREFILTER STATE for one pixel — the whole antialiasing of the lensed sky.
 *
 * A star is a delta function on the sky and the sky is sampled once per pixel,
 * which is the root of both artifacts this replaced:
 *
 *   * far from the hole a star is 0.28 px across (720p), so point sampling MISSES
 *     ~3 of every 4 of them and the survivors pop in and out as the scene yaws
 *     (`gSky` is rgba16float, whose 4.9e-4 quantum is itself coarser than the
 *     star);
 *   * near the shadow the lensing map compresses tens of star cells into one
 *     pixel, so point sampling returns an uncorrelated cell per pixel: speckle
 *     that reads as an unlensed sky glued to the shadow.
 *
 * The fix is to convolve the sky with the PIXEL instead: draw each star at a
 * radius of at least one pixel and divide its brightness by the area it gained,
 * which conserves flux exactly. `starLod` in shade.wgsl used to fade the sky to
 * black instead — the one thing that is certainly wrong, because radiance is
 * conserved along rays (Liouville): a magnified patch of sky gets fainter per
 * pixel and covers more of them, it never goes dark. That fade deleted an 88 px
 * ring of sky around the shadow at 720p, i.e. exactly the annulus where the
 * lensed images pile up.
 *
 * THE FILTER IS ELLIPTICAL, not a disc in sky space, and that is load-bearing.
 * The lensing map is strongly anisotropic (measured at 32 deg off axis with the
 * shipped camera: ~3x more sky per pixel radially than tangentially), so a disc
 * of radius max(footprint) in FACE units is a 3-10x too wide prefilter along the
 * well-sampled axis; every star came out as a tangential dash. Working in SCREEN
 * space instead — where the pixel is isotropic by construction — makes a far
 * field star a round ~1 px dot again and lets the tangential stretch appear only
 * where the map really produces it.
 *
 * `inverseJacobian` maps a face-space offset to pixels, `radiusPixels` is the
 * prefilter radius in pixels and `gain` is the flux-conserving brightness
 * multiplier. All three are properties of the PIXEL, not of a star layer, so they
 * are computed once per pixel and shared by every layer.
 */
struct SkyFilter {
  inverseJacobian: mat2x2f,
  radiusPixels: f32,
  gain: f32,
  /**
   * LONGEST axis of the sky footprint of one pixel, in FACE units. Multiplied by a
   * layer's `cells` it says how many cells that pixel covers along the direction
   * the lensing compresses hardest, which is what decides whether the layer can
   * still be resolved star by star or has to fall back to its mean radiance
   * (`starLayer`).
   *
   * The MAJOR axis and not the determinant, on purpose: near the shadow the
   * footprint is a sliver (dozens of cells radially, a fraction of one
   * tangentially) whose area — and therefore whose geometric mean — still looks
   * perfectly resolvable while the radial direction is aliasing badly.
   */
  faceMajor: f32,
}

/**
 * Builds the per-pixel prefilter from the screen-space derivatives of the lensed
 * ray direction (`dpdx`/`dpdy`, taken in shade.wgsl where the control flow is
 * uniform).
 *
 * `starPixels` — the star's own radius, in pixels — is the geometric mean of the
 * two principal directions, i.e. it is derived from the DETERMINANT of the map:
 * `area on the sky per pixel = |det J|`, so a star of radius r covers
 * `(r / sqrt(|det J|))^2` pixels. That single number carries both the local
 * magnification and the resolution, and it is the same for every layer (a star's
 * angular size does not depend on which grid it lives in).
 *
 * `gain = min(1, starPixels^2)` is that coverage, clamped: once a star is bigger
 * than a pixel it is properly resolved and keeps its full surface brightness.
 */
fn skyFilter(direction: vec3f, ddx: vec3f, ddy: vec3f) -> SkyFilter {
  let axis = i32(faceCoords(direction).z) / 2;
  let base = faceProject(direction, axis);
  let jx = faceProject(direction + ddx, axis) - base;
  let jy = faceProject(direction + ddy, axis) - base;

  let determinant = jx.x * jy.y - jx.y * jy.x;
  // A vanishing determinant is a caustic (or a pixel where the derivatives
  // underflowed). Clamping it keeps the inverse finite; `gain` is clamped to 1
  // independently, so no configuration can produce a brighter-than-a-star pixel.
  let safeDeterminant = select(determinant, 1.0e-24, abs(determinant) < 1.0e-24);
  // inverse of the column matrix [jx jy].
  let inverse = mat2x2f(vec2f(jy.y, -jx.y), vec2f(-jy.x, jx.x)) * (1.0 / safeDeterminant);

  let starPixels = UNIFORM_POINT_RADIUS / sqrt(max(abs(determinant), 1.0e-24));

  var prefilter: SkyFilter;
  prefilter.inverseJacobian = inverse;
  prefilter.radiusPixels = clamp(starPixels, 1.0, MAX_PREFILTER_PIXELS);
  prefilter.gain = min(1.0, starPixels * starPixels);
  prefilter.faceMajor = max(length(jx), length(jy));
  return prefilter;
}

/**
 * How well the sky is resolved at this pixel: 1 = the star is at least a pixel
 * wide and keeps its full brightness, -> 0 = one pixel swallows many star cells
 * and every star is dimmed by the SQUARE of this. Exported for debug view 6.
 *
 * Unlike the `starLod` it replaced, 0 does not mean "no sky here": the flux is
 * still rendered, spread over the pixels the lensing map spread it over.
 */
export fn starPrefilterRatio(direction: vec3f, ddx: vec3f, ddy: vec3f) -> f32 {
  return min(1.0, sqrt(skyFilter(direction, ddx, ddy).gain));
}

/**
 * One star, from the cell it lives in. Returns its contribution to this pixel.
 *
 * `cell` is the integer cell coordinate, `grid` the pixel's continuous position
 * on the same grid, and the falloff is evaluated in SCREEN space: the offset from
 * the star is pushed through the prefilter's inverse Jacobian, so a pixel-sized
 * prefilter stays a pixel-sized prefilter no matter how anisotropically the lensing map
 * stretches the sky there.
 */
fn starPoint(
  cell: vec2f,
  grid: vec2f,
  cells: f32,
  faceIndex: i32,
  density: f32,
  brightnessMin: f32,
  brightnessMax: f32,
  seed: i32,
  time: f32,
  twinkle: f32,
  prefilter: SkyFilter,
) -> f32 {
  let hashed = pcg3d(bitcast<vec3u>(vec3i(vec2i(cell), faceIndex * 131 + seed)));
  let presence = unitFloat(hashed.x);
  if (presence > density) {
    return 0.0;
  }

  let jitter = vec2f(unitFloat(hashed.y), unitFloat(hashed.z)) - vec2f(0.5);
  let center = cell + vec2f(0.5) + jitter * 0.8;
  // Grid -> face -> pixels. `inverseJacobian` is in face units, so the grid
  // offset is divided by `cells` before it is transformed; that is the only
  // place a layer's resolution enters, and it is why one prefilter serves all
  // three layers.
  let offsetPixels = prefilter.inverseJacobian * ((grid - center) / cells);
  let falloff = 1.0 - smoothstep(0.0, prefilter.radiusPixels, length(offsetPixels));

  // The same stable per-cell hash that decides whether this star exists maps
  // linearly to the user-selected [brightnessMin, brightnessMax] interval.
  // Normalizing by density keeps that interval represented at every population.
  let brightnessHash = presence / max(density, 1.0e-4);
  let magnitude = mix(brightnessMin, brightnessMax, clamp(brightnessHash, 0.0, 1.0));

  // Kept deliberately gentler than the old field: at twinkle = 1 this varies
  // by only +/- 6%, and every star has a stable hash-derived phase.
  let phase = unitFloat(hashed.y) * 6.2831853;
  let shimmer = 1.0 + clamp(twinkle, 0.0, 1.0) * 0.06 * sin(time * (0.35 + unitFloat(hashed.z) * 0.4) + phase);
  return falloff * falloff * magnitude * shimmer * prefilter.gain;
}

/**
 * One Earth-style density layer: at most one jittered star per cube-face cell.
 * The squared radial falloff leaves compact, antialiased pinpoints instead of
 * broad core-and-halo blobs. Every layer uses the same angular radius, so
 * brightness—not diameter—is the only visual hierarchy between stars.
 *
 * The FOUR nearest cells are accumulated, not just the one the pixel falls in.
 * A prefiltered star is at least a pixel wide, which is wider than the margin the
 * jitter leaves inside a cell, so a single-cell lookup clipped every star that
 * sat near a cell edge into a half moon. The extra three taps also start to sum
 * the several stars a single pixel really contains where the lensing map is
 * compressed — still an undercount there (a pixel can span dozens of cells near
 * the shadow), but a monotonic improvement rather than a lottery.
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
  prefilter: SkyFilter,
) -> f32 {
  let face = faceCoords(direction);
  let faceIndex = i32(face.z);
  let grid = face.xy * cells;
  // Cells of the 2x2 block whose centres straddle this pixel.
  let base = floor(grid - vec2f(0.5));

  var total = 0.0;
  for (var index = 0; index < 4; index++) {
    let cell = base + vec2f(f32(index & 1), f32(index >> 1));
    total += starPoint(
      cell, grid, cells, faceIndex, density, brightnessMin, brightnessMax, seed, time, twinkle, prefilter,
    );
  }

  // MEAN RADIANCE LIMIT — what the four taps converge to once a pixel swallows
  // more cells than they can visit.
  //
  // Near the shadow the lensing map squeezes dozens of cells into one pixel, so a
  // 4-tap sum is a fraction of the light that is really there and the sky fades
  // out towards the shadow edge for no physical reason (measured: 3-5x too dark
  // between 1.3 and 2x the shadow radius). The exact band-limited value in that
  // regime is analytic, because it no longer depends on WHICH stars land in the
  // pixel: every star contributes `magnitude * gain * STAR_FLUX_AREA *
  // radiusPixels^2` spread over the pixels it covers, and a pixel holds
  // `density * (cells * faceSpan)^2` of them, so with `gain = (r0/faceSpan)^2` the
  // footprint cancels out completely:
  //
  //   mean = magnitude * density * STAR_FLUX_AREA * (r0 * cells)^2
  //
  // i.e. a CONSTANT — the layer's own surface brightness. That is Liouville's
  // theorem falling out of the algebra: lensing moves sky brightness around, it
  // cannot dilute it. (This is also the number the old `starLod` comment called
  // "essentially black" before fading to zero; it is small, but it is exactly the
  // brightness the unlensed sky already has, which is why the fade was visible.)
  let averageMagnitude = 0.5 * (brightnessMin + brightnessMax);
  let pointRadius = UNIFORM_POINT_RADIUS * cells;
  let mean = averageMagnitude * density * STAR_FLUX_AREA * pointRadius * pointRadius;
  // Cross-fade over 1..3 cells per pixel: below that the taps resolve individual
  // stars (and must, or the sky loses its stars), above it they only alias. Each
  // layer crosses over at its own footprint — the coarse 34-cell grid stays
  // resolved much closer to the shadow than the 210-cell one — which is the
  // per-layer behaviour a single global `starLod` threshold could not express.
  let cellsPerPixel = cells * prefilter.faceMajor;
  return mix(total, mean, smoothstep(1.0, 3.0, cellsPerPixel));
}

/**
 * Entry point used by shade.wgsl for every escaped, non-horizon ray.
 *
 * `ddx` / `ddy` are the screen-space derivatives of the LENSED ray direction, one
 * pixel apart, taken in shade.wgsl (derivatives need uniform control flow) and
 * rotated by the scene yaw together with `direction`. They are what turns the
 * field from a point sample into a prefiltered, flux-conserving one — see
 * `skyFilter`. Pass zero vectors to get the raw, aliased point field.
 */
export fn shadeStars(direction: vec3f, look: StarLook, time: f32, ddx: vec3f, ddy: vec3f) -> vec3f {
  let population = clamp(max(0.0, look.density), 0.0, 1.0);
  let dimmest = max(0.0, look.brightnessMin);
  let brightest = max(dimmest, look.brightnessMax);
  let d = normalize(direction);
  let prefilter = skyFilter(d, ddx, ddy);

  // Ported from apps/docs/examples/earth/sky.wgsl: sparse anchors, a main
  // field, and a small unresolved wash. All stars share the same angular size;
  // the layer weights and hash-mapped emission create the visual hierarchy.
  let luminance = (
    starLayer(d, 34.0, population * 0.55, dimmest, brightest, 17, time, look.twinkle, prefilter) * 1.35
      + starLayer(d, 92.0, population * 0.42, dimmest, brightest, 71, time, look.twinkle, prefilter) * 0.85
      + starLayer(d, 210.0, population * 0.26, dimmest, brightest, 149, time, look.twinkle, prefilter) * 0.30
  ) * STAR_INTENSITY;

  return vec3f(luminance * max(0.0, look.brightness));
}
