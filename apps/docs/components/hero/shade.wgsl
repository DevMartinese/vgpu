// FRAME PASS ENTRY — thin dispatcher, runs every frame.
//
// INFRASTRUCTURE FILE — avoid editing it. It owns the bindings, decodes the
// G-buffer written by bake.wgsl, computes the noise footprints (derivatives need
// uniform control flow, so they cannot happen inside the disk branches) and
// composites, back to front:
//
//   stars.wgsl   (shadeStars, with the baked lensed direction) or black
//   disk.wgsl    (shadeDisk on the SECOND disk crossing — the hidden image)
//   disk.wgsl    (shadeDisk on the FIRST disk crossing — the front band)
//
// No raymarching happens here: the geodesics were solved once by bake.wgsl.
// See GBUFFER.md for the full contract.

import { GBufferSample, GBufferLayers, decodeGBuffer, ISCO, PI_CONST } from "./gbuffer.wgsl";
import { DiskLook, DiskSample, shadeDisk } from "./disk.wgsl";
import { StarLook, shadeStars } from "./stars.wgsl";

struct Shade {
  resolution: vec2f,
  /** Seconds since start; the only animation clock. The camera never moves. */
  time: f32,
  /** Outer disk radius the G-buffer was baked with. */
  diskOuter: f32,
  /** 0 = final image, 1..7 = G-buffer debug views (see GBUFFER.md). */
  debugView: f32,
  /** 1 = front disk crossing only, 2 = also composite the second crossing. */
  diskLayers: f32,
}

/**
 * Angular size of the finest star layer in stars.wgsl (210 cells per cube face).
 * Used as the Nyquist limit for the lensed sky; see `starLod` in fs_main.
 */
const STAR_CELL: f32 = 1.0 / 210.0;

/**
 * Extra weight on disk emission, carried over from the single-layer version
 * (which composited `mix(bg, S, a) + S*a*0.35`). Applied identically to both
 * layers so adding the second one does not change how bright the front band is.
 */
const DISK_GAIN: f32 = 1.35;

@group(0) @binding(0) var<uniform> shade: Shade;
@group(0) @binding(1) var gHit1: texture_2d<f32>;
@group(0) @binding(2) var gHit2: texture_2d<f32>;
@group(0) @binding(3) var gSky: texture_2d<f32>;
@group(0) @binding(4) var gView: texture_2d<f32>;
@group(0) @binding(5) var<uniform> disk: DiskLook;
@group(0) @binding(6) var<uniform> stars: StarLook;

/**
 * Screen-space footprint of the disk noise for one layer, in noise units per
 * pixel. MUST be called from uniform control flow: it takes derivatives, which
 * are undefined inside the `isHit` branches, so both layers are measured for
 * every pixel and the results are only *used* on hits.
 */
fn diskFootprint(g: GBufferSample) -> f32 {
  let angular = max(disk.stretch, 0.05);
  let noiseAngle = g.diskPolar.y - shade.time * (disk.speed * 0.55 / pow(g.diskPolar.x, 1.5));
  let noiseCoords = vec3f(
    cos(noiseAngle) * angular,
    sin(noiseAngle) * angular,
    g.diskPolar.x * disk.detail,
  );
  return min(
    max(max(fwidth(noiseCoords.x), fwidth(noiseCoords.y)), fwidth(noiseCoords.z)),
    4.0,
  );
}

/** A layer that contributes nothing, so it can be composited unconditionally. */
fn emptyDiskSample() -> DiskSample {
  var sample: DiskSample;
  sample.color = vec3f(0.0);
  sample.alpha = 0.0;
  sample.density = 0.0;
  return sample;
}

/**
 * Emission-absorption "over": the layer adds its own emergent intensity
 * (`color * alpha`, i.e. S * (1 - exp(-tau)) — see disk.wgsl) and transmits
 * `1 - alpha` of whatever is behind it.
 *
 * Compositing strictly back to front with this is what keeps the two disk
 * layers energy-correct: the hidden image is attenuated by exactly the front
 * band's opacity, so neither layer can contribute twice, and a layer with
 * alpha = 0 is an exact no-op.
 */
fn compositeDisk(under: vec3f, sample: DiskSample) -> vec3f {
  return sample.color * sample.alpha * DISK_GAIN + under * (1.0 - sample.alpha);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // The camera is frozen by the bake and there is no pointer parallax: one
  // G-buffer texel per pixel, read straight through.
  let dimensions = vec2f(textureDimensions(gHit1, 0));
  let texel = vec2i(clamp(uv * dimensions, vec2f(0.0), dimensions - vec2f(1.0)));

  let layers = decodeGBuffer(
    textureLoad(gHit1, texel, 0).xy,
    textureLoad(gHit2, texel, 0).xy,
    textureLoad(gSky, texel, 0),
    textureLoad(gView, texel, 0),
    shade.diskOuter,
  );
  let g = layers.front;

  // Both footprints, in uniform control flow. The second layer sits at a
  // different radius and azimuth, so it needs its own measurement.
  let frontFootprint = diskFootprint(layers.front);
  let backFootprint = diskFootprint(layers.back);

  // Angular footprint of the LENSED direction map, in radians per pixel. Also
  // derivatives, so also uniform control flow.
  //
  // Gravitational lensing compresses the whole sky into ever thinner rings as
  // the impact parameter approaches the photon sphere, so `rayDirection` sweeps
  // faster and faster across the screen near the shadow. Past ~1 star cell per
  // pixel, point sampling the star field returns an essentially uncorrelated
  // cell per pixel and the lensed sky collapses into uniform speckle that reads
  // as "unlensed stars" in a band hugging the shadow — the opposite of what
  // should be there. Same class of bug as the disk moire, same class of fix:
  // measure the footprint and fade the detail that no longer fits in a pixel.
  let skyFootprint = max(
    max(fwidth(g.rayDirection.x), fwidth(g.rayDirection.y)),
    fwidth(g.rayDirection.z),
  );
  // The correct band-limited value is the sky's MEAN radiance, which for a
  // sparse star field is essentially black, so fading out is the right limit.
  // Fade range measured with debug view 6 (see GBUFFER.md): the speckle band
  // sits where a pixel spans 1..4 of the finest star cells, so the field is
  // fully gone by 4 and untouched below 1. Do not widen this without re-reading
  // that view -- fading too early eats real stars, too late leaves the speckle.
  let starLod = 1.0 - smoothstep(STAR_CELL, STAR_CELL * 4.0, skyFootprint);

  var background = vec3f(0.0);
  if (!g.isBlackHole && g.escaped) {
    background = shadeStars(g.rayDirection, stars, shade.time) * starLod;
  }

  // The same shadeDisk, called twice with two different crossings. disk.wgsl
  // shades one layer at a time and never has to know which one it is looking at.
  var backSample = emptyDiskSample();
  var frontSample = emptyDiskSample();
  if (layers.back.isHit && shade.diskLayers > 1.5) {
    backSample = shadeDisk(layers.back, disk, shade.time, backFootprint);
  }
  if (layers.front.isHit) {
    frontSample = shadeDisk(layers.front, disk, shade.time, frontFootprint);
  }

  // Back to front. Both composites are unconditional: an empty layer has
  // alpha = 0 and leaves `color` bit-for-bit untouched, so a pixel with a single
  // crossing produces exactly what the single-layer version produced.
  var color = background;
  color = compositeDisk(color, backSample);
  color = compositeDisk(color, frontSample);

  // Debug visualisations of the baked G-buffer (lil-gui "debug view"). The
  // composite pass skips tone mapping and desaturation while one is active.
  // Views 1..5 describe the FRONT crossing; view 7 is the second one.
  let mode = i32(shade.debugView + 0.5);
  if (mode == 1) {
    return vec4f(g.normal * 0.5 + vec3f(0.5), 1.0);
  }
  if (mode == 2) {
    return vec4f(select(vec3f(0.0), vec3f(g.diskUv, 0.35), g.isHit), 1.0);
  }
  if (mode == 3) {
    return vec4f(f32(g.isHit), f32(g.isBlackHole), f32(g.escaped), 1.0);
  }
  if (mode == 4) {
    return vec4f(g.rayDirection * 0.5 + vec3f(0.5), 1.0);
  }
  if (mode == 5) {
    return vec4f(vec3f(frontSample.density), 1.0);
  }
  // Sky aliasing diagnostic. R = star cells crossed per pixel / 16 (so 255 means
  // 16+ cells per pixel, i.e. hopeless undersampling), G = the star LOD weight
  // actually applied, B = 1 on pixels that sample the star field at all.
  if (mode == 6) {
    return vec4f(
      skyFootprint / (STAR_CELL * 16.0),
      starLod,
      select(0.0, 1.0, !g.isBlackHole && g.escaped),
      1.0,
    );
  }
  // Second disk crossing. B = 1 exactly where a hidden second image exists, so
  // its extent is readable at a glance; R/G carry that crossing's normalized
  // disk coordinates (radius, azimuth) to confirm the geometry is sane.
  if (mode == 7) {
    return vec4f(select(vec3f(0.0), vec3f(layers.back.diskUv, 1.0), layers.back.isHit), 1.0);
  }

  // Linear HDR output; tone mapping happens in the composite pass.
  return vec4f(color, 1.0);
}
