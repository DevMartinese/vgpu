// FRAME PASS ENTRY — thin dispatcher, runs every frame, draws straight to the
// swap chain.
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
// ...and then tone maps the result in place (exposure, ACES, vignette, gamma,
// desaturation — see `tonemap`). There is NO separate composite pass and no
// intermediate HDR target: the linear HDR value never leaves a register, which
// saves one full-screen pass plus an rgba16float write + filtered read per pixel.
// The G-buffer debug views return BEFORE the tone map, so their channels stay raw.
//
// No raymarching happens here: the geodesics were solved once by bake.wgsl.
// See gbuffer.md for the full contract.

import { GBufferSample, GBufferLayers, decodeGBuffer, ISCO, PI_CONST, TAU } from "./gbuffer.wgsl";
import { DiskLook, DiskSample, shadeDisk, SHEAR_PERIOD } from "./disk.wgsl";
import { StarLook, shadeStars, starPrefilterRatio } from "./stars.wgsl";

struct Shade {
  resolution: vec2f,
  /** Seconds since start; the only animation clock. The camera never moves. */
  time: f32,
  /** Outer disk radius the G-buffer was baked with. */
  diskOuter: f32,
  /** 0 = final image, 1..7 = G-buffer debug views (see gbuffer.md). */
  debugView: f32,
  /** 1 = front disk crossing only, 2 = also composite the second crossing. */
  diskLayers: f32,
  /**
   * ACTIVE rotation of the whole scene around the Y axis, in radians.
   *
   * The camera is frozen by the bake and never moves; the scene (disk + lensed
   * sky) is rotated instead, which is exact because the geometry is
   * axisymmetric: Schwarzschild gravity plus a ring centered on `y = 0`. So the
   * baked G-buffer stays valid and a mouse move costs ONE uniform, never a bake.
   *
   * PRECONDITION: it stops being exact the moment anything breaks that symmetry
   * (a warped/tilted disk, an occluder, non-spherical gravity, world lighting
   * that does not rotate with the scene).
   *
   * Sign: rotating the scene by `+theta` is the same as rotating the camera by
   * `-theta` (`Bake.yaw` is camera yaw, opposite sign — hence the different
   * name). The frame pass therefore evaluates the baked samples in the inverse
   * frame: `R_y(-sceneYaw)`.
   */
  sceneYaw: f32,
}

/**
 * Angular size of the finest star layer in stars.wgsl (210 cells per cube face).
 * The sampling reference for the lensed sky: `skyFootprint` is reported in units
 * of it by debug view 6. Nothing in the final image keys off it any more — the
 * sky is prefiltered per layer inside stars.wgsl instead of being faded out by a
 * single global threshold.
 */
const STAR_CELL: f32 = 1.0 / 210.0;

/**
 * Extra weight on disk emission, carried over from the single-layer version
 * (which composited `mix(bg, S, a) + S*a*0.35`). Applied identically to both
 * layers so adding the second one does not change how bright the front band is.
 */
const DISK_GAIN: f32 = 1.35;

// --- Tone map (absorbed from the former composite.wgsl pass) -----------------
//
// These three used to be a separate full-screen pass reading an rgba16float
// scene target. They are constants, not uniforms: nothing in the panel or the
// harness ever varied them, and a uniform would have kept the composite bind
// group alive for no reason.

/** Linear exposure applied before the tone curve. */
const EXPOSURE: f32 = 1.15;
/** The hero is monochrome by design — do not fight it with hue work. */
const SATURATION: f32 = 0.0;

@group(0) @binding(0) var<uniform> shade: Shade;
@group(0) @binding(1) var gHit1: texture_2d<f32>;
@group(0) @binding(2) var gHit2: texture_2d<f32>;
@group(0) @binding(3) var gSky: texture_2d<f32>;
@group(0) @binding(4) var gView: texture_2d<f32>;
@group(0) @binding(5) var<uniform> disk: DiskLook;
@group(0) @binding(6) var<uniform> stars: StarLook;
/**
 * Tiled 3D value-noise lattice for disk.wgsl, and its sampler.
 *
 * The disk's smoke used to hash its noise lattice inline, eight `hash31` calls
 * per sample and ~26 samples per pixel per layer. The lattice is now baked once
 * into an `r8unorm` `texture_3d` (`noise-volume.mjs`) and read with a single
 * trilinear fetch. They live HERE and not in disk.wgsl because WGSL modules in
 * this project never declare bindings — the entry shader owns the bind group
 * and passes resources down, exactly like `disk` and `stars` above.
 *
 * The sampler MUST be linear min/mag with `repeat` on all three axes: `noise3`
 * wraps the integer cell itself but relies on `repeat` to close the tile
 * between the last texel and the first.
 */
@group(0) @binding(7) var noiseVolume: texture_3d<f32>;
@group(0) @binding(8) var noiseSampler: sampler;

/**
 * Screen-space footprint of the disk noise for one layer, in noise units per
 * pixel. MUST be called from uniform control flow: it takes derivatives, which
 * are undefined inside the `isHit` branches, so both layers are measured for
 * every pixel and the results are only *used* on hits.
 */
fn diskFootprint(g: GBufferSample) -> f32 {
  let angular = max(disk.stretch, 0.05);
  let noiseAngle = g.diskPolar.y - min(shade.time, SHEAR_PERIOD * 0.5) * (disk.speed * 0.55 / pow(g.diskPolar.x, 1.5));
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

/**
 * Active rotation around +Y: takes (0,0,r) to (sin(a)r, 0, cos(a)r), the exact
 * matrix the bake's camera yaw uses. Because the project defines the azimuth as
 * `atan2(z, x)`, it maps `azimuth -> azimuth - a`.
 */
fn rotateY(v: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

/** Wraps an angle back into (-PI, PI], the range `diskPolar.y` is contracted to. */
fn wrapAngle(angle: f32) -> f32 {
  return angle - TAU * floor((angle + PI_CONST) / TAU);
}

/**
 * Re-expresses one baked crossing in the rotated scene.
 *
 * The scene is rotated ACTIVELY by `shade.sceneYaw`, so a sample baked in world
 * space has to be evaluated in the inverse frame: every world vector goes
 * through `R_y(-sceneYaw)` (the minus is passed in by the caller, on purpose —
 * it is the whole sign convention and must stay visible).
 *
 * Position, view direction and ray direction rotate TOGETHER. Rotating only one
 * of them would slide the Doppler lobe or the sky against the disk; rotating all
 * of them keeps every dot product (Doppler beaming, edge-on foreshortening)
 * bit-for-bit equal to the unrotated scene, because the matrix is orthogonal.
 *
 * Invariant, and therefore untouched: the disk radius (`diskPolar.x`,
 * `diskUv.x`), the normal (0, +/-1, 0), `side`, and all three flags.
 */
fn rotateSample(g: GBufferSample, angle: f32) -> GBufferSample {
  var rotated = g;
  rotated.position = rotateY(g.position, angle);
  rotated.viewDirection = rotateY(g.viewDirection, angle);
  rotated.rayDirection = rotateY(g.rayDirection, angle);
  // Equivalent to atan2(rotated.position.z, rotated.position.x), but defined for
  // misses too (their position is exactly (0,0,0), where atan2 is not).
  let azimuth = wrapAngle(g.diskPolar.y - angle);
  rotated.diskPolar = vec2f(g.diskPolar.x, azimuth);
  rotated.diskUv = vec2f(g.diskUv.x, (azimuth + PI_CONST) / TAU);
  return rotated;
}

/** Both crossings, moved into the rotated scene by the same transform. */
fn rotateLayers(layers: GBufferLayers, angle: f32) -> GBufferLayers {
  var rotated: GBufferLayers;
  rotated.front = rotateSample(layers.front, angle);
  rotated.back = rotateSample(layers.back, angle);
  return rotated;
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

/** Narkowicz's ACES fit, clamped to the displayable range. */
fn aces(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3f(b))) / (x * (c * x + vec3f(d)) + vec3f(e)), vec3f(0.0), vec3f(1.0));
}

/**
 * Linear HDR -> display. Formerly the whole of composite.wgsl, applied here to a
 * value that is still in a register instead of to a round trip through an
 * rgba16float target.
 *
 * `uv` is the full-screen quad coordinate, i.e. the position on the CANVAS, not
 * on the disk — the vignette is a lens effect and has to stay anchored to the
 * frame. It is the same varying the composite pass received, because that pass
 * sampled the scene 1:1 with no offset, so the vignette lands on exactly the
 * same pixels it always did.
 *
 * Order is load-bearing and unchanged: exposure -> ACES -> vignette -> gamma ->
 * desaturation. The vignette multiplies the TONE MAPPED value (a darkening of
 * the displayed image), and the gamma comes after it.
 */
fn tonemap(linearColor: vec3f, uv: vec2f) -> vec3f {
  var color = aces(linearColor * EXPOSURE);

  // Subtle cinematic vignette.
  let centered = uv - vec2f(0.5);
  let vignette = 1.0 - smoothstep(0.55, 1.15, length(centered) * 1.6);
  color *= mix(0.72, 1.0, vignette);

  color = pow(color, vec3f(1.0 / 2.2));

  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  return mix(vec3f(luma), color, SATURATION);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // The camera is frozen by the bake and there is no pointer parallax: one
  // G-buffer texel per pixel, read straight through.
  let dimensions = vec2f(textureDimensions(gHit1, 0));
  let texel = vec2i(clamp(uv * dimensions, vec2f(0.0), dimensions - vec2f(1.0)));

  let baked = decodeGBuffer(
    textureLoad(gHit1, texel, 0).xy,
    textureLoad(gHit2, texel, 0).xy,
    textureLoad(gSky, texel, 0),
    textureLoad(gView, texel, 0),
    shade.diskOuter,
  );

  // Both footprints, in uniform control flow. The second layer sits at a
  // different radius and azimuth, so it needs its own measurement.
  //
  // Measured on the BAKED samples, before the scene rotation. A rigid rotation
  // preserves the magnitude of a derivative, but these estimators take a
  // per-component max (an L-inf norm, not a rotation-invariant one), so
  // measuring after the rotation would make the LOD breathe by up to ~sqrt(2)
  // as the mouse moves. The physical (angular / radial) footprint is invariant,
  // so the pre-rotation measurement is the correct one.
  let frontFootprint = diskFootprint(baked.front);
  let backFootprint = diskFootprint(baked.back);

  // Angular footprint of the LENSED direction map, in cube-face units per pixel
  // (the units `stars.wgsl` measures its point radius in). Also derivatives, so
  // also uniform control flow.
  //
  // Gravitational lensing compresses the whole sky into ever thinner rings as
  // the impact parameter approaches the photon sphere, so `rayDirection` sweeps
  // faster and faster across the screen near the shadow. Past ~1 star cell per
  // pixel, point sampling the star field returns an essentially uncorrelated
  // cell per pixel and the lensed sky collapses into uniform speckle that reads
  // as "unlensed stars" in a band hugging the shadow — the opposite of what
  // should be there. Same class of bug as the disk moire; the fix is to hand the
  // footprint to the sky shader and let it PREFILTER (see `starPrefilterRadius`
  // in stars.wgsl), not to fade the sky out.
  //
  // This used to multiply the stars by `starLod = 1 - smoothstep(STAR_CELL,
  // 4*STAR_CELL, skyFootprint)`, i.e. fade to black wherever a pixel spanned
  // more than one star cell. That is wrong in the limit: radiance is conserved
  // along rays, so a magnified patch of sky gets fainter and wider, never black,
  // and the fade deleted an 88 px ring of sky around the shadow at 720p —
  // exactly the annulus where the lensed images pile up, so the Einstein ring
  // was the one thing guaranteed not to render. Prefiltering with flux
  // conservation kills the speckle just as well and keeps the light.
  // Also measured on the baked direction, for the same reason as above.
  //
  // BOTH screen axes are kept, separately: the lensing map is anisotropic (it
  // compresses the sky radially while barely touching it tangentially), so a
  // single scalar footprint — the max over axes and components — is a 3-10x too
  // wide filter along the well-sampled axis and smears every star into a
  // tangential dash. `stars.wgsl` inverts the 2x2 Jacobian these two vectors
  // span and filters in SCREEN space, where a pixel is isotropic by definition.
  // The scalar below is kept only as the debug-view scale.
  let bakedRayDirection = baked.front.rayDirection;
  let skyDdx = dpdx(bakedRayDirection);
  let skyDdy = dpdy(bakedRayDirection);
  let skyFootprint = max(
    max(fwidth(bakedRayDirection.x), fwidth(bakedRayDirection.y)),
    fwidth(bakedRayDirection.z),
  );

  // Everything below this line looks at the ROTATED scene: the mouse turns the
  // world around the hole's spin axis, and the baked G-buffer is still exact
  // because the geometry is axisymmetric (see `Shade.sceneYaw`). Disk and sky
  // are rotated by the same transform, so they never slide against each other,
  // and the debug views show what was actually sampled.
  let layers = rotateLayers(baked, -shade.sceneYaw);
  let g = layers.front;
  // The sky derivatives belong to the same vector as `g.rayDirection`, so they go
  // through the same rotation. `rotateY` is linear, so rotating a difference of
  // directions is exactly the difference of the rotated directions.
  let skyDdxRotated = rotateY(skyDdx, -shade.sceneYaw);
  let skyDdyRotated = rotateY(skyDdy, -shade.sceneYaw);

  var background = vec3f(0.0);
  if (!g.isBlackHole && g.escaped) {
    background = shadeStars(g.rayDirection, stars, shade.time, skyDdxRotated, skyDdyRotated);
  }

  // The same shadeDisk, called twice with two different crossings. disk.wgsl
  // shades one layer at a time and never has to know which one it is looking at.
  var backSample = emptyDiskSample();
  var frontSample = emptyDiskSample();
  if (layers.back.isHit && shade.diskLayers > 1.5) {
    backSample = shadeDisk(layers.back, disk, shade.time, backFootprint, noiseVolume, noiseSampler);
  }
  if (layers.front.isHit) {
    frontSample = shadeDisk(layers.front, disk, shade.time, frontFootprint, noiseVolume, noiseSampler);
  }

  // Back to front. Both composites are unconditional: an empty layer has
  // alpha = 0 and leaves `color` bit-for-bit untouched, so a pixel with a single
  // crossing produces exactly what the single-layer version produced.
  var color = background;
  color = compositeDisk(color, backSample);
  color = compositeDisk(color, frontSample);

  // Debug visualisations of the baked G-buffer (lil-gui "debug view").
  //
  // THEY RETURN BEFORE `tonemap`, ON PURPOSE: these channels carry data, not
  // radiance, and ACES + gamma + desaturation would make them unreadable. This
  // early-return placement is the whole reason the debug bypass survived the
  // removal of the composite pass — do not move the tone map above this block.
  //
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
  // Sky prefilter diagnostic. R = star cells crossed per pixel / 16 (so 255 means
  // 16+ cells per pixel, i.e. hopeless undersampling for a point sample),
  // G = `starPrefilterRatio` — the LINEAR attenuation the prefilter applies
  // (1 = the star already covers a pixel and keeps full brightness, -> 0 = the
  // star is smeared over the footprint and dimmed by the square of this),
  // B = 1 on pixels that sample the star field at all. Unlike the `starLod` this
  // replaced, G going to 0 no longer means "no sky here": the flux is still
  // there, spread out.
  if (mode == 6) {
    return vec4f(
      skyFootprint / (STAR_CELL * 16.0),
      starPrefilterRatio(g.rayDirection, skyDdxRotated, skyDdyRotated),
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

  // Display-referred output, written straight to the swap chain: the linear HDR
  // value above never touches memory.
  return vec4f(tonemap(color, uv), 1.0);
}
