// BAKE PASS — runs once per camera/geometry change, never per frame.
//
// Traces one geodesic per pixel through the Schwarzschild-like field and stores
// the *result* of the ray in a G-buffer, so the per-frame pass only has to shade
// it. Because this is a one-shot cost we can afford a much finer integration
// than the old per-frame raymarch (768 steps, ~4x smaller step size), and the
// accretion disk is resolved as a HARD analytic surface (the y=0 annulus between
// ISCO and diskOuter) with an exact plane-crossing solve instead of a volume.
//
// The ray is NOT terminated at the disk: it keeps going, and it records the
// first TWO crossings of the annulus. A geodesic that grazes the hole crosses
// the disk plane more than once, so the front band hides a second, lensed image
// of the disk behind/below it; recording only the first crossing threw that
// light away. After the second hit the ray still continues to the horizon or to
// infinity, so the G-buffer also keeps the background (stars / black) both
// layers are composited against.

struct Bake {
  resolution: vec2f,
  yaw: f32,
  pitch: f32,
  orbitRadius: f32,
  diskOuter: f32,
  fov: f32,
  centerY: f32,
}

@group(0) @binding(0) var<uniform> bake: Bake;

const HORIZON: f32 = 1.0;
const ISCO: f32 = 3.0;
const MAX_STEPS: i32 = 768;

/**
 * sky.w bit 0 — the ray is SHADOW: it ended inside the event horizon, or it was
 * still orbiting when MAX_STEPS ran out (see the classification at the end of
 * fs_main). Both cases mean "no sky here".
 */
const FLAG_HOLE: f32 = 1.0;
/**
 * sky.w bit 1 — the ray really did reach `escapeRadius` moving outwards, so
 * `sky.xyz` is its asymptotic direction and can be used to sample the sky.
 */
const FLAG_ESCAPED: f32 = 2.0;

// G-BUFFER LAYOUT — 4 attachments, 32 bytes per sample. See gbuffer.md.
//
// The byte budget is the whole reason this is packed rather than simply
// duplicated: WebGPU only guarantees maxColorAttachmentBytesPerSample = 32, and
// the previous single-hit layout (rgba32float + 2x rgba16float) already spent
// exactly 32. Adding a second hit therefore had to come out of redundancy, of
// which there was plenty:
//
//   * the normalized disk radius was stored even though it is just
//     (|plane| - ISCO) / (diskOuter - ISCO) — dropped, recomputed on read;
//   * `side` was stored even though a photon that hits the top face is by
//     definition travelling downward — dropped, recovered as -sign(dir.y);
//   * the hit direction was stored as a full vec3 even though it is a unit
//     vector — now 2 numbers (y and the azimuth of xz), which is also *more*
//     accurate near edge-on than three f16s were.
//
// That frees exactly enough room for a second hit at the same 32 bytes, with
// the f32 precision on the hit positions preserved (f16 quantizes to ~0.6 px at
// r ~ 15 and visibly contours the disk noise).
//
// hit1: xy = FIRST  disk crossing, position in the y=0 plane (world x, z)
// hit2: xy = SECOND disk crossing, same encoding; only written if hit1 exists
//       For both: no crossing is encoded as (0, 0) — the annulus starts at
//       ISCO, so |xy| < ISCO unambiguously means "no hit" and costs no flag.
// sky:  xyz = final lensed ray direction (used to sample the star field)
//       w   = flags: FLAG_HOLE | FLAG_ESCAPED
// view: xy = direction at the first crossing  (y, azimuth of xz)
//       zw = direction at the second crossing (y, azimuth of xz)
struct GBuffer {
  @location(0) hit1: vec2f,
  @location(1) hit2: vec2f,
  @location(2) sky: vec4f,
  @location(3) view: vec4f,
}

/**
 * Packs a unit direction into 2 floats: y, plus the azimuth of the xz part.
 * Lossless enough that f16 storage beats the old 3x f16 cartesian form, and it
 * keeps the sign of y exact, which is what `side` is reconstructed from.
 */
fn encodeDirection(direction: vec3f) -> vec2f {
  return vec2f(direction.y, atan2(direction.z, direction.x));
}

fn geodesicAcceleration(position: vec3f, velocity: vec3f) -> vec3f {
  let r2 = max(dot(position, position), 0.0001);
  let angularMomentum = cross(position, velocity);
  let h2 = dot(angularMomentum, angularMomentum);
  return -1.5 * h2 * position / (r2 * r2 * sqrt(r2));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> GBuffer {
  let aspect = bake.resolution.x / max(bake.resolution.y, 1.0);
  // ORIENTATION — vgpu's generated fullscreen vertex shader emits uv (0,0) at the
  // TOP-LEFT of the target and (1,1) at the bottom-right (the WebGPU texture
  // convention). Camera space is +Y up, so uv.y MUST be flipped here; feeding
  // `uv.y * 2 - 1` straight into `up` renders the whole scene upside down.
  // Every other pass is a 1:1 pass-through (shade textureLoads uv*dims, composite
  // samples uv), so this is the single place the convention is converted, and it
  // fixes the browser and the node harness at once. See gbuffer.md.
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  // centerY shifts the image vertically, in NDC units: positive moves the black
  // hole UP on screen. Kept at 0 now that the canvas covers the whole hero.
  let screen = (ndc - vec2f(0.0, bake.centerY)) * vec2f(aspect, 1.0);

  let yaw = bake.yaw;
  let pitch = clamp(bake.pitch, -1.319, 1.319);
  let orbitRadius = bake.orbitRadius;
  let cameraPosition = vec3f(
    sin(yaw) * cos(pitch) * orbitRadius,
    sin(pitch) * orbitRadius,
    cos(yaw) * cos(pitch) * orbitRadius,
  );
  let forward = normalize(vec3f(0.0) - cameraPosition);
  let right = normalize(cross(forward, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, forward);

  var position = cameraPosition;
  var velocity = normalize(forward * bake.fov + right * screen.x + up * screen.y);

  var hit1Plane = vec2f(0.0);
  var hit1Direction = vec2f(0.0);
  var hit2Plane = vec2f(0.0);
  var hit2Direction = vec2f(0.0);
  var hitCount = 0;
  var swallowed = 0.0;
  var escaped = 0.0;
  // Where the ray is declared to have reached infinity. Pushed out from 30 to
  // 120 r_s: the deflection is already converged at 30 (raising it to 120 moves
  // the outgoing direction by 0.002 deg at b = 3), but the far field is where
  // the adaptive step below buys its budget back, so a farther cutoff costs
  // almost no extra steps and makes the direction unambiguously asymptotic.
  let escapeRadius = max(120.0, orbitRadius + 8.0);

  for (var stepIndex = 0; stepIndex < MAX_STEPS; stepIndex++) {
    let radius = length(position);
    if (radius < HORIZON * 1.004) {
      swallowed = 1.0;
      break;
    }
    if (radius > escapeRadius && dot(position, velocity) > 0.0) {
      escaped = 1.0;
      break;
    }

    // Adaptive to gravity: finer near the horizon where the geodesic curves
    // hardest. Much finer than the live version could afford (one-shot cost).
    //
    // The ceiling grows LINEARLY with radius past r = 6 instead of staying
    // pinned at 0.075. The acceleration falls off as h^2 / r^5, so out there a
    // 0.075 step resolves a straight line 20x more finely than needed and the
    // fixed cap was burning ~20% of MAX_STEPS on the flight in and out. Inside
    // r = 6 the factor is exactly 1, so the strong-field part of every geodesic
    // — everything that produces the deflection, the shadow edge and the disk
    // crossings — integrates bit-for-bit as before. Measured effect of the
    // relaxation (evidence/geo3.mjs): deflection unchanged to <= 0.03 deg, and
    // the freed budget shrinks the out-of-steps band from 8.6 px to 2.3 px at
    // 720p.
    let stepSize = clamp((radius - HORIZON) * 0.035, 0.0045, 0.075 * max(1.0, radius / 6.0));

    let previousPosition = position;
    let previousVelocity = velocity;

    // Velocity-Verlet style integration of the light geodesic.
    let acceleration0 = geodesicAcceleration(position, velocity);
    velocity += acceleration0 * (0.5 * stepSize);
    position += velocity * stepSize;
    let acceleration1 = geodesicAcceleration(position, velocity);
    velocity += acceleration1 * (0.5 * stepSize);
    velocity = normalize(velocity);

    // Hard disk: exact intersection with the y=0 annulus. No slab, no volume,
    // no oversampling heuristics -> no concentric ring aliasing either.
    //
    // The crossing test is a strict side change rather than `prevY * y <= 0`:
    // now that two hits are recorded, a step that lands exactly on y = 0 would
    // otherwise satisfy the product test twice and register the same crossing
    // as both hits. Folding y == 0 into the positive side makes every sign flip
    // fire exactly once, and keeps the interpolation denominator non-zero.
    if (hitCount < 2) {
      let previousSide = select(-1.0, 1.0, previousPosition.y >= 0.0);
      let currentSide = select(-1.0, 1.0, position.y >= 0.0);
      if (previousSide != currentSide) {
        let t = clamp(previousPosition.y / (previousPosition.y - position.y), 0.0, 1.0);
        let crossing = mix(previousPosition, position, t);
        let planeRadius = length(crossing.xz);
        if (planeRadius >= ISCO && planeRadius <= bake.diskOuter) {
          let direction = encodeDirection(normalize(mix(previousVelocity, velocity, t)));
          if (hitCount == 0) {
            hit1Plane = crossing.xz;
            hit1Direction = direction;
          } else {
            hit2Plane = crossing.xz;
            hit2Direction = direction;
          }
          hitCount += 1;
        }
      }
    }
  }

  // OUT-OF-STEPS RAYS ARE SHADOW, NOT SKY.
  //
  // This used to be `if (swallowed < 0.5) { escaped = 1.0; }`, i.e. anything
  // that did not fall in was declared to have reached infinity — including the
  // rays that simply exhausted MAX_STEPS. Those are the ones with an impact
  // parameter just above b_crit = 3*sqrt(3)/2: they wind around the photon
  // sphere many times, and when the loop gives up, `velocity` is a direction
  // half way through that winding (measured: 117 deg of deflection instead of
  // the true 252 deg at b = 2.62). Writing it as an escaped direction feeds the
  // star field an essentially random point on the sky, which is exactly the
  // speckle Fix 1 would otherwise uncover once `starLod` stops fading it out.
  //
  // A photon still orbiting after 768 steps has passed the photon sphere far
  // more slowly than any escaping ray: black is a much better approximation of
  // its (infinitely thin, infinitely wound) contribution than a truncated
  // direction, so it is folded into the shadow. With the relaxed far-field step
  // above this band is ~2.3 px at 720p, just outside the shadow edge.
  //
  // The loop can only end three ways — fell in, escaped, ran out of steps — so
  // "neither flag set" identifies the third case exactly, and after this the
  // G-buffer never contains a sample with both flags clear.
  if (swallowed < 0.5 && escaped < 0.5) {
    swallowed = 1.0;
  }

  return GBuffer(
    hit1Plane,
    hit2Plane,
    vec4f(velocity, swallowed * FLAG_HOLE + escaped * FLAG_ESCAPED),
    vec4f(hit1Direction, hit2Direction),
  );
}
